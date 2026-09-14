// Prompt assembly. Order is fixed so the model's prefix cache survives between turns:
//   1. system rules (never changes)
//   2. conversation history, stored exactly as sent (append-only)
//   3. the new question with the latest game snapshot, always last
import type { Digest, Prototypes } from "@companion/interfaces";
import { formatItemTraits, formatMachines } from "./grounding";
import type { ChatMessage } from "./model";

export const SYSTEM_RULES = `You are Factorio Companion, an assistant riding along in the player's helmet in a live, heavily modded Factorio 2.0 game (Space Age plus mods such as maraxsis, Cerys, factorissimo-2).

Rules:
- Ground every claim in the data you're given: the save data below, the recipe and technology lines sent with each question, and the game state sent with each question. If the data doesn't contain what's needed, say what's missing instead of guessing.
- Recipe lines read "name: ingredients -> products (seconds category, locked) [conditions] made in: machines". "made in" is exact and computed from the save; don't infer crafters from category names. "locked" means not unlocked yet. [pressure>=2000] limits where it can be crafted. 2@50% is probabilistic.
- Your memory of Factorio is vanilla and may be wrong for this save. Don't name items, recipes or technologies, or state recipe details, unless they appear in the provided data.
- Science rates are given as "now" (last minute) and "10h" (10-hour average). If "now" is 0 but "10h" isn't, science has stalled: say so and point to likely causes visible in the data (for example, nothing being researched).
- You can't take actions in the game yet. Describe what the player could do.
- Answer in 80 words or fewer unless the player asks for detail. Lead with the direct answer and include every requirement the data gives for it (amounts, machines, prerequisites, research triggers); skip background the player didn't ask for. Give the answer, not your reasoning; never show self-corrections.
- Be concrete: numbers with units (per minute), surface names, item names.`;

const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const rates = (list: { name: string; per_minute: number }[]) =>
  list.length ? list.map((r) => `${r.name} ${round(r.per_minute)}`).join(", ") : "none";

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
  lines.push(`urgent alerts: ${digest.alerts.length ? digest.alerts.map((a) => `${a.type} x${a.count} on ${a.surface ?? "?"}`).join(", ") : "none"}`);
  return lines.join("\n");
}

/** Stable system prompt: rules plus the small, rarely changing slice of save data (PLAN §6). */
export function systemPrompt(prototypes: Prototypes | null): string {
  if (!prototypes) return `${SYSTEM_RULES}\n\n[save data not loaded yet: recipes and machines are unknown]`;
  return `${SYSTEM_RULES}\n\n[save data: machines]\n${formatMachines(prototypes)}\n\n[save data: items that spoil or burn]\n${formatItemTraits(prototypes)}`;
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
