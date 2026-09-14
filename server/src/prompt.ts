// Prompt assembly. Order is fixed so the model's prefix cache survives between turns:
//   1. system rules (never changes; padded to a cache block boundary)
//   2. conversation history (append-only; each past question stored compacted, without its recipe
//      lines and snapshot, so follow-ups re-read little)
//   3. the new question with its retrieved lines and the latest game snapshot, always last
import type { Digest, Prototypes } from "@companion/interfaces";
import { formatItemTraits } from "./grounding";
import type { ChatMessage } from "./model";

export const SYSTEM_RULES = `You are Factorio Companion, an assistant riding along in the player's helmet in a live, heavily modded Factorio 2.0 game (Space Age plus mods such as maraxsis, Cerys, factorissimo-2).

Rules:
- Ground every claim in the data you're given: the save data below, the recipe and technology lines sent with each question, and the game state sent with each question. If the data doesn't contain what's needed, say what's missing instead of guessing.
- Recipe lines read "name: ingredients -> products (seconds category, locked) [conditions] made in: machines". "made in" is exact and computed from the save; don't infer crafters from category names. "locked" means not unlocked yet. [pressure>=2000] limits where it can be crafted. 2@50% is probabilistic.
- Your memory of Factorio is vanilla and may be wrong for this save. Don't name items, recipes or technologies, or state recipe details, unless they appear in the provided data.
- Science rates are given as "now" (last minute) and "10h" (10-hour average). If "now" is 0 but "10h" isn't, science has stalled: say so and point to likely causes visible in the data (for example, nothing being researched).
- You act only through your tools, and only as the player could: same reach, same tools, same cost. There is no instant deletion, teleporting, item spawning or cheating; if asked, say so and offer what a player could do (for example, marking for deconstruction).
- Use tools only for things placed in the world near the player ("how many rails to my right?"). Recipe, item, machine and research questions are answered from the data you're given, with no tool call.
- find_entities searches near the player where they can currently see; right = east, up = north. Say what you searched (what, direction, radius) and the count. Its results are highlighted in-game and remembered, so "them" means the last result.
- Diagnosis hints are computed from live machine status. Lead with a "root cause" hint when one is given; symptoms explain what it causes.
- Stuck machine lines read "recipe stuck/total (status counts)". "item ingredient shortage" or "no ingredients" means inputs aren't arriving; "full output" or "waiting for space in destination" means output isn't being taken away. Name the status and the likely upstream or downstream cause. find_stuck_machines lists and highlights them.
- mark_deconstruction and cancel_deconstruction only ask for approval: after calling one, tell the player to confirm the card in the app. Never say it's done until a message reports the outcome.
- Answer in 60 words or fewer unless the player asks for detail. Lead with the direct answer and include every requirement the data gives for it (amounts, machines, prerequisites, research triggers); skip background the player didn't ask for. Give the answer, not your reasoning; never show self-corrections.
- Be concrete: numbers with units (per minute), surface names, item names.
- When the player asks how a rate is trending, or asks for a chart, add a chart block after your answer, using exact item and surface names from the game state:
\`\`\`rate_chart
item=agricultural-science-pack surface=gleba window=30m
\`\`\`
The app draws it from recorded history, so never write chart numbers yourself. Only chart items listed in the game state (produced or science).`;

const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const rates = (list: { name: string; per_minute: number }[]) =>
  list.length ? list.map((r) => `${r.name} ${round(r.per_minute)}`).join(", ") : "none";

const OUTPUT_BLOCKED = new Set(["full_output", "waiting_for_space_in_destination", "not_enough_space_in_output", "full_burnt_result_output"]);
const INPUT_STARVED = new Set(["no_ingredients", "item_ingredient_shortage", "fluid_ingredient_shortage", "no_input_fluid", "missing_required_fluid", "missing_science_packs", "no_minable_resources"]);

/** Root-cause hints worked out in code from machine status (FC-085), so the model doesn't have to chain surfaces. */
export function diagnose(digest: Digest): string[] {
  const m = digest.machines;
  if (!m) return [];
  const hints: string[] = [];
  const all = m.stuck.flatMap((s) => s.recipes.map((r) => ({ surface: s.surface, ...r })));
  const idleLabs = all.filter((r) => r.recipe === "(research)").reduce((n, r) => n + (r.statuses.no_research_in_progress ?? 0), 0);
  const fullScience = all.filter((r) => r.recipe.endsWith("science-pack") && Object.keys(r.statuses).some((st) => OUTPUT_BLOCKED.has(st)));
  if (idleLabs > 0 && !digest.research.current) {
    hints.push(`root cause: research has stopped: ${idleLabs} labs are idle with nothing queued${fullScience.length ? `, so science assemblers (${fullScience.map((r) => `${r.recipe} on ${r.surface}`).join(", ")}) have full output and everything upstream backs up` : ""}`);
  }
  for (const s of m.stuck) {
    let blocked = 0, starved = 0, stuck = 0;
    for (const r of s.recipes) for (const [st, n] of Object.entries(r.statuses)) { stuck += n; if (OUTPUT_BLOCKED.has(st)) blocked += n; if (INPUT_STARVED.has(st)) starved += n; }
    if (stuck >= 10 && blocked / stuck >= 0.6) hints.push(`symptom on ${s.surface}: most stuck machines are output-blocked (${blocked} of ${stuck}): products aren't being taken away downstream`);
    else if (stuck >= 10 && starved / stuck >= 0.6) hints.push(`symptom on ${s.surface}: most stuck machines are starved of inputs (${starved} of ${stuck})`);
  }
  return hints;
}

const MACHINE_QUESTION = /\b(slow|stuck|bottleneck\w*|why|problem\w*|broken|idle|starv\w*|backed up|back(ing)? up|not working|blocked|jam\w*|full)\b/i;
const RATE_QUESTION = /\b(rate|rates|per minute|\/min|output|throughput|production|produc\w*|making|consum\w*|science|bottleneck|slow|stalled|how much|how many)\b/i;

/**
 * Compact text form of a digest; kept small because it's the uncached tail of every prompt.
 * Production lines are included only when the question is about rates or names an item the
 * digest tracks (`items`: prototype names matched in the question). Pass no options for everything.
 */
export function formatSnapshot(digest: Digest, ageMs: number, relevance?: { question: string; items: string[] }): string {
  const wantsRates = !relevance || RATE_QUESTION.test(relevance.question);
  const mentioned = new Set(relevance?.items ?? []);
  const lines = [`[game state at tick ${digest.tick}, ${Math.round(ageMs / 1000)} s old]`];
  if (digest.player) lines.push(`player: ${digest.player.name} on ${digest.player.surface} at (${digest.player.position.x}, ${digest.player.position.y})`);
  const r = digest.research;
  lines.push(`research: ${r.current ? `${r.current} ${Math.round(r.progress * 100)}%` : "nothing researching"}${r.queue.length > 1 ? `; queued: ${r.queue.slice(1).join(", ")}` : ""}`);
  let omitted = false;
  for (const s of digest.surfaces) {
    const label = s.platform ? `${s.name} (platform ${s.platform})` : s.name;
    if (wantsRates) {
      lines.push(`${label} produced/min: ${rates(s.produced)}`);
      lines.push(`${label} consumed/min: ${rates(s.consumed)}`);
      if (s.science.length) lines.push(`${label} science/min (now | 10h avg): ${s.science.map((x) => `${x.name} ${round(x.per_minute)} | ${round(x.per_minute_10h)}`).join(", ")}`);
      continue;
    }
    const hits = [...s.produced, ...s.consumed].filter((r) => mentioned.has(r.name));
    if (hits.length) lines.push(`${label} rates/min for items asked about: ${[...new Map(hits.map((h) => [h.name, h])).values()].map((r) => `${r.name} ${round(r.per_minute)}`).join(", ")}`);
    else omitted = true;
  }
  if (omitted) lines.push("(production rates omitted: not relevant to this question)");

  // Machine status from the mod's registry (FC-085): only for slowness/rate questions, filtered to asked-about items.
  const m = digest.machines;
  if (m && (!relevance || MACHINE_QUESTION.test(relevance.question) || RATE_QUESTION.test(relevance.question))) {
    // A question naming a surface ("factory floor", "gleba") only gets that surface's lines. When both
    // "nauvis" and "nauvis-factory-floor" match, the more specific one wins.
    const q = relevance?.question.toLowerCase().replace(/[-_]/g, " ") ?? "";
    const matched = m.stuck.map((s) => s.surface).filter((name) => q.includes(name.replace(/-/g, " ")));
    const named = matched.filter((name) => !matched.some((other) => other !== name && other.startsWith(`${name}-`)));
    const surfaceWanted = (name: string) => named.length === 0 || named.includes(name);
    const related = (label: string) => [...mentioned].some((item) => label === item || label === `mining ${item}` || label.startsWith(`${item}`));
    for (const s of m.stuck.filter((x) => surfaceWanted(x.surface))) {
      const rows = mentioned.size ? s.recipes.filter((r) => related(r.recipe)) : s.recipes.slice(0, 4);
      if (!rows.length) continue;
      lines.push(`${s.surface} stuck machines (stuck/total by recipe): ${rows.map((r) => `${r.recipe} ${r.stuck}/${r.total} (${Object.entries(r.statuses).map(([st, n]) => `${st.replace(/_/g, " ")} ${n}`).join(", ")})`).join("; ")}`);
    }
    const hints = diagnose(digest).filter((h) => h.startsWith("root cause") || !named.length || named.some((n) => h.startsWith(`symptom on ${n}:`)));
    if (hints.length) lines.push(`diagnosis hints (computed from machine status): ${hints.join("; ")}`);
    lines.push(`(machine status covers ${m.progress.machines} machines, refreshed every ${Math.round(m.progress.refresh_ticks / 60)} s${m.progress.scanned ? "" : "; still scanning, counts incomplete"})`);
  }
  lines.push(`urgent alerts: ${digest.alerts.length ? digest.alerts.map((a) => `${a.type} x${a.count} on ${a.surface ?? "?"}`).join(", ") : "none"}`);
  return lines.join("\n");
}

/** Stable system prompt: rules plus the small, rarely changing slice of save data (PLAN §6). */
export function systemPrompt(prototypes: Prototypes | null): string {
  if (!prototypes) return `${SYSTEM_RULES}\n\n[save data not loaded yet: recipes and machines are unknown]`;
  // Machine details come with each question via retrieval (S08): the full list cost ~2k stable tokens.
  return `${SYSTEM_RULES}\n\n[save data: items that spoil or burn]\n${formatItemTraits(prototypes)}`;
}

export const CACHE_BLOCK_TOKENS = 2048;
const ALIGN_MARGIN_TOKENS = 24;

/**
 * oMLX caches whole 2,048-token blocks, so a stable prefix that ends mid-block gets that block
 * re-read on every new question (measured 2.03 s vs 0.80 s first token, S05). Appends reference
 * lines until the measured prefix just crosses the next block boundary. `measure` returns the prompt
 * token count for a system prompt (with tools), so the template's own tokens are included.
 */
export async function alignToCacheBlock(system: string, referenceLines: string[], measure: (system: string) => Promise<number>, heading = "[save data: recipe categories and what crafts them]"): Promise<{ system: string; tokens: number; target: number }> {
  const base = await measure(system);
  const target = Math.ceil(base / CACHE_BLOCK_TOKENS) * CACHE_BLOCK_TOKENS;
  if (base >= target - CACHE_BLOCK_TOKENS + ALIGN_MARGIN_TOKENS && base <= target - CACHE_BLOCK_TOKENS + ALIGN_MARGIN_TOKENS * 3) return { system, tokens: base, target: target - CACHE_BLOCK_TOKENS }; // already just past a boundary
  // Start from the system prompt's ratio, then learn the reference lines' own ratio from each measured
  // round: they tokenize differently (S08: ~3.2 vs ~2.0 chars/token), and a fixed ratio left the loop short.
  let charsPerToken = system.length / base;
  let candidate = system;
  let tokens = base;
  let used = 0;
  // A few measured rounds: estimate how many lines are needed, then top up if still short.
  // `measure` includes a placeholder user turn (~10 template tokens), so the stable part must clear the
  // boundary by a small margin; stopping right at 4,096 measured left block 2 uncached (S05). Tokens past
  // the margin are re-read on every turn, so stop at the first line that crosses it.
  const goal = target + ALIGN_MARGIN_TOKENS;
  for (let round = 0; round < 10 && tokens < goal && used < referenceLines.length; round++) {
    const missingChars = Math.max(goal - tokens, 1) * charsPerToken;
    let added = 0;
    while (used < referenceLines.length && added < missingChars) {
      const line = referenceLines[used++]!;
      candidate += (used === 1 ? `\n\n${heading}\n` : "\n") + line;
      added += line.length + 1;
    }
    const before = tokens;
    tokens = await measure(candidate);
    if (tokens > before) charsPerToken = added / (tokens - before);
  }
  return { system: candidate, tokens, target };
}

/** The volatile tail, in order: question, retrieved recipe lines, game state last. */
export function userTurn(question: string, { recipes = [], snapshot = null }: { recipes?: string[]; snapshot?: string | null } = {}): ChatMessage {
  const parts = [question];
  if (recipes.length) parts.push(`[recipes and technologies from this save]\n${recipes.join("\n")}`);
  parts.push(snapshot ?? "[game state unavailable: the game isn't connected]");
  return { role: "user", content: parts.join("\n\n") };
}

export function buildMessages(system: string, history: ChatMessage[], nextUser: ChatMessage): ChatMessage[] {
  return [{ role: "system", content: system }, ...history, nextUser];
}
