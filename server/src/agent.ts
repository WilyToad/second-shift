// The agent loop: retrieval + snapshot → model → tools → answer, with approvals for map changes.
// Looks run immediately; map changes wait for the player to confirm a card in the web page.
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ActionArgs, ActionData, ActionName, Digest, EntityRef, FindEntitiesResult, Prototypes } from "@companion/interfaces";
import { summarizePasted } from "./blueprint-review";
import { blueprintsIn, decodeBlueprintString, encodeBlueprintString, type Blueprint } from "./blueprint";
import { describeRow, productionRow, type RowBuild } from "./blueprint-template";
import type { BlueprintCard } from "./messages";
import { ChartBlockFilter, stripChartBlocks } from "./stream-filter";
import { pruneShots, waitForShot } from "./screenshots";
import { resolveEntityFilter, resolveEntityFilterInText } from "./entities";
import type { Snapshot } from "./game";
import type { ServerMessage } from "./messages";
import type { ChatMessage, ChatModel, ToolCall, ToolSpec } from "./model";
import { buildMessages, formatSnapshot, userTurn } from "./prompt";
import { formatPlan, Planner, type Plan } from "./planner";
import type { RecipeRetriever } from "./retrieval";

export interface GameActions {
  call<A extends ActionName>(action: A, args?: ActionArgs<A>): Promise<ActionData<A>>;
  latest(): Snapshot | undefined;
}

/** A card waiting for the player: `run` does the work and returns the outcome message. */
type Pending = { id: string; title: string; run: () => Promise<string> };
type LastResult = { refs: EntityRef[]; label: string; count: number; at: number; where: string };

/** One answered question, for latency analysis (FC-080). Section sizes are characters. */
export type TurnRecord = {
  at: string;
  question: string;
  world: boolean;
  chart: boolean;
  chars: { system: number; history: number; question: number; retrieved: number; snapshot: number };
  rounds: { promptTokens?: number; cachedTokens?: number; serverTtftS?: number; completionTokens?: number; ms: number; toolCalls: number }[];
  visibleTtftMs?: number;
  totalMs: number;
};

const MAX_TOOL_ROUNDS = 3;
export type TranscriptItem = { kind: "user" | "agent"; text: string };
export type SessionData = { savedAt: string; history: ChatMessage[]; transcript: TranscriptItem[] };
export type SessionStore = { load(): SessionData | null; save(data: SessionData): void; clear(): void };
const MAX_TRANSCRIPT = 60;

/** The conversation as one JSON file, rewritten after each answer (FC-063). Unreadable files start a fresh conversation. */
export function fileSession(path: string): SessionStore {
  return {
    load() {
      try {
        const data = JSON.parse(readFileSync(path, "utf8")) as SessionData;
        return Array.isArray(data.history) && Array.isArray(data.transcript) ? data : null;
      } catch {
        return null;
      }
    },
    save(data) {
      void Bun.write(path, JSON.stringify(data));
    },
    clear() {
      rmSync(path, { force: true });
    },
  };
}

/** Estimated history size that triggers compaction (FC-076). ~2.8 characters per token measured. */
const HISTORY_BUDGET_TOKENS = 8000;
const KEEP_RECENT_TURNS = 2;
const CHARS_PER_TOKEN = 2.8;
const TAIL_MARKERS = ["\n\n[recipes and technologies from this save]", "\n\n[game state", "\n\n(Answer from the data provided", "\n\n(Review from the checked summary"];

/** A user turn without its bulky, now-stale data: retrieved lines, snapshot and guidance notes. */
export function compactUserContent(content: string): string {
  const cut = Math.min(...TAIL_MARKERS.map((m) => content.indexOf(m)).filter((i) => i >= 0), content.length);
  return content.slice(0, cut);
}

/**
 * Compacts all but the most recent turns once history passes the budget. Older user turns keep only
 * the question; older tool results keep their first sentence. Returns null when nothing needs doing.
 */
export function compactHistory(history: ChatMessage[], budgetTokens = HISTORY_BUDGET_TOKENS, keepTurns = KEEP_RECENT_TURNS): { history: ChatMessage[]; beforeTokens: number; afterTokens: number } | null {
  const size = (msgs: ChatMessage[]) => Math.round(msgs.reduce((n, m) => n + m.content.length, 0) / CHARS_PER_TOKEN);
  const beforeTokens = size(history);
  if (beforeTokens <= budgetTokens) return null;
  const userIdx = history.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const keepFrom = userIdx.length > keepTurns ? userIdx[userIdx.length - keepTurns]! : 0;
  if (keepFrom === 0) return null;
  const older = history.slice(0, keepFrom).map((m): ChatMessage => {
    if (m.role === "user") return { ...m, content: compactUserContent(m.content) };
    if (m.role === "tool") return { ...m, content: m.content.split(/(?<=\.)\s/)[0] ?? m.content };
    return m;
  });
  const alreadyNoted = older[0]?.role === "user" && older[0].content.startsWith("[earlier turns compacted");
  const note: ChatMessage[] = alreadyNoted ? [] : [{ role: "user", content: "[earlier turns compacted: recipe lines and game state removed to keep the conversation fast]" }, { role: "assistant", content: "Understood." }];
  const next = [...note, ...older, ...history.slice(keepFrom)];
  const afterTokens = size(next);
  // Already compacted and the recent turns alone exceed the budget: nothing to gain, and rewriting would only break the cache.
  if (afterTokens >= beforeTokens) return null;
  return { history: next, beforeTokens, afterTokens };
}
const RESULT_TTL_MS = 10 * 60_000;
const HIGHLIGHT_SECONDS = 60;

export const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "find_entities",
      description: "Count and locate things near the player, only where the player can currently see. Results are highlighted in-game and remembered as the last result.",
      parameters: {
        type: "object",
        properties: {
          what: { type: "string", description: "What to look for, as the player said it: rails, belts, inserters, trees, biochambers, ..." },
          direction: { type: "string", enum: ["right", "left", "up", "down", "around"], description: "Screen direction from the player: right = east, up = north. Default around." },
          radius: { type: "number", description: "Tiles from the player, 1-128. Default 32." },
        },
        required: ["what"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_stuck_machines",
      description: "List and highlight machines that aren't working for a recipe or item (from the live status registry). Use when the player asks which machines are stuck or wants to see them.",
      parameters: {
        type: "object",
        properties: {
          what: { type: "string", description: "Recipe or item as the player said it: iron gear wheels, bioflux, iron ore (for drills), ..." },
          surface: { type: "string", description: "Surface name if not the player's current one." },
        },
        required: ["what"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_deconstruction",
      description: "Ask the player to approve marking the last result for deconstruction (like a deconstruction planner drag; robots do the work; Ctrl+Z undoes it). Nothing happens until they confirm.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_upgrade",
      description: "Ask the player to approve marking the last result for upgrade (like an upgrade planner). Nothing happens until they confirm.",
      parameters: { type: "object", properties: { to: { type: "string", description: "Target entity, e.g. fast belts. Default: next tier." } } },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Show the player a picture of their spot or of the last result (only where they can see).",
      parameters: { type: "object", properties: { at: { type: "string", enum: ["here", "last_result"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "set_recipe",
      description: "Ask the player to approve changing the recipe of the assembling machines in the last result. Nothing happens until they confirm.",
      parameters: { type: "object", properties: { recipe: { type: "string", description: "What they should make, as the player said it." } }, required: ["recipe"] },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_research",
      description: "Add a technology to the research queue.",
      parameters: { type: "object", properties: { technology: { type: "string", description: "Technology or the item it unlocks, as the player said it." } }, required: ["technology"] },
    },
  },
  {
    type: "function",
    function: {
      name: "map_action",
      description: "Put a map tag, or move the camera (remote view), at the player's position or the last result.",
      parameters: {
        type: "object",
        properties: { kind: { type: "string", enum: ["tag", "camera"] }, at: { type: "string", enum: ["here", "last_result"] }, text: { type: "string", description: "Tag text." } },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_blueprint",
      description: "Ask the player to approve pasting the last blueprint they pasted into chat or you built for them, as ghosts at their position.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_deconstruction",
      description: "Ask the player to approve cancelling deconstruction marks on the last result. Nothing happens until they confirm.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/**
 * Does this question need a look at (or action in) the world near the player? Decided in code because
 * the model otherwise calls find_entities on recipe questions, adding a slow round trip. Tools stay in
 * the prompt either way (removing them changes the cached prefix); non-world turns get a note instead.
 */
export function needsWorldTools(question: string, hasLastResult: boolean): boolean {
  const q = question.toLowerCase();
  if (/\b(near|nearby|around me|next to me|close to me|here|to my|on my|of me|in view|on screen|visible)\b/.test(q)) return true;
  if (/\b(find|search|look for|highlight|show me|where are|count|which)\b/.test(q)) return true;
  if (/\b(mark|unmark|deconstruct\w*|remove|delete|clear|cancel|upgrade\w*|queue|start research\w*|research it|tag|pin|camera|jump|take me|paste|place|build it)\b/.test(q)) return true;
  if (/\b(set|switch|change)\b.*\b(to|recipe)\b/.test(q)) return true;
  if (/\b(screenshot|picture|photo|what does .+ look like)\b/.test(q)) return true;
  if (/\bhow many\b/.test(q) && !/\b(need|needs|take|takes|require|requires|make|makes|per)\b/.test(q)) return true;
  if (hasLastResult && /\b(them|those|these|it|that)\b/.test(q)) return true;
  return false;
}

/** A production target in the question ("60 bioflux per minute", "2/s") as items per minute, plus the words naming what. */
export function parseTarget(question: string): { perMinute: number; phrase: string } | null {
  // Up to four words may sit between the number and the unit: "60 electronic circuits per minute".
  const m = /(\d+(?:\.\d+)?)\s*((?:[a-z-]+\s+){0,4}?)(?:\/\s*|per\s+|an?\s+|each\s+|every\s+)(minute|min|m|second|sec|s)\b/i.exec(question);
  if (!m) return null;
  const n = Number(m[1]);
  return { perMinute: /^s/i.test(m[3]!) ? n * 60 : n, phrase: m[2]!.trim() };
}

export function targetRate(question: string): number | null {
  return parseTarget(question)?.perMinute ?? null;
}

/** The question the server asks for the player when they select a build with the in-game tool (main.ts). */
export const SELECTED_PREFIX = "Review the build I just selected:";
const SELECTED = /^Review the build I just selected:/;

/** Is the player asking for a blueprint built to a rate ("a blueprint for 120 gears per minute")? */
export function wantsBlueprint(question: string): boolean {
  return /\b(blueprints?|layouts?|schematics?)\b/i.test(question) && parseTarget(question) !== null;
}

const MAX_SKETCH_ENTITIES = 4000;

/** Top-down sketch of a blueprint, in tiles from its top-left corner; big blueprints keep their first entities. */
export function sketchBlueprint(bp: Blueprint, footprints: Record<string, { type: string; size: [number, number] }>, meta: { label: string; string: string; summary: string }): BlueprintCard {
  const parts = bp.entities.slice(0, MAX_SKETCH_ENTITIES).map((e) => {
    const [w, h] = footprints[e.name]?.size ?? [1, 1];
    return { name: e.name, kind: footprints[e.name]?.type ?? "entity", x: e.position.x - w / 2, y: e.position.y - h / 2, w, h, ...(e.direction !== undefined ? { direction: e.direction } : {}) };
  });
  const minX = parts.length ? Math.min(...parts.map((p) => p.x)) : 0;
  const minY = parts.length ? Math.min(...parts.map((p) => p.y)) : 0;
  const sketch = parts.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY }));
  return { ...meta, width: Math.max(1, ...sketch.map((p) => p.x + p.w)), height: Math.max(1, ...sketch.map((p) => p.y + p.h)), sketch };
}

/** The card for a blueprint built in code. */
export function blueprintCard(build: RowBuild, footprints: Record<string, { type: string; size: [number, number] }>): BlueprintCard {
  return sketchBlueprint(build.blueprint, footprints, {
    label: build.blueprint.label ?? build.item,
    string: encodeBlueprintString({ blueprint: build.blueprint }),
    summary: `${build.machines} ${build.machine} · ${build.inputs.map((i) => `${Math.round(i.perMinute)}/min ${i.name}`).join(" + ")} in · ${build.belt}, ${build.inserter}, ${build.pole}`,
  });
}

/** Is the player asking about a trend over time, where a rate_chart helps? */
export function wantsChart(question: string): boolean {
  return /\b(chart|graph|plot|trend\w*|over time|history|holding|steady|stable|drop\w*|fall\w*|ris\w*|increas\w*|decreas\w*|slow\w* down|how('s| is) .+ doing)\b/i.test(question);
}

/**
 * A rate_chart block for a trend question whose answer didn't include one: the first asked-about item
 * the digest tracks, on the surface named in the question, else the player's, else the busiest.
 */
export function fallbackChart(question: string, items: string[], digest: Digest | undefined): string | null {
  if (!digest) return null;
  const q = question.toLowerCase().replace(/[-_]/g, " ");
  // "How is my science doing?" names no item: chart the pack with the most long-run production.
  const science = /\bscience\b/.test(q)
    ? digest.surfaces.flatMap((s) => s.science).sort((a, b) => b.per_minute_10h - a.per_minute_10h).map((r) => r.name)
    : [];
  for (const item of [...items, ...science]) {
    const surfaces = digest.surfaces
      .map((s) => ({ s, rate: [...s.produced, ...s.science].find((r) => r.name === item)?.per_minute }))
      .filter((x) => x.rate !== undefined);
    if (!surfaces.length) continue;
    const named = surfaces.filter((x) => q.includes(x.s.name.replace(/-/g, " ")) || (x.s.name.endsWith("factory-floor") && q.includes("factory floor")));
    const pick = named[0] ?? surfaces.find((x) => x.s.name === digest.player?.surface) ?? surfaces.sort((a, b) => b.rate! - a.rate!)[0]!;
    return `\n\n\`\`\`rate_chart\nitem=${item} surface=${pick.s.name} window=30m\n\`\`\``;
  }
  return null;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;

export class Agent {
  readonly history: ChatMessage[] = [];
  private readonly shown: TranscriptItem[] = [];
  private lastResult: LastResult | null = null;
  private lastBlueprint: { raw: string; at: number } | null = null;
  private planner: { source: Prototypes; planner: Planner } | null = null;
  private currentQuestion = "";
  private pending = new Map<string, Pending>();
  private notes: string[] = [];

  constructor(
    private readonly deps: {
      model: ChatModel;
      game: GameActions;
      system: () => string;
      retriever: () => RecipeRetriever | null;
      prototypes: () => Prototypes | null;
      fallbackSnapshot?: () => Snapshot | undefined;
      emit: (m: ServerMessage) => void;
      now?: () => number;
      /** Appends a JSON line per answered question (FC-080). */
      turnLog?: string;
      /** Where the conversation is kept between server runs (FC-063). */
      session?: SessionStore;
      /** The game's script-output directory, where screenshots land (FC-049). */
      scriptOutput?: string;
    },
  ) {
    const saved = deps.session?.load();
    if (saved) {
      this.history.push(...saved.history);
      this.shown.push(...saved.transcript);
    }
  }

  /** What the page showed in this conversation, for pages that connect later. */
  transcript(): TranscriptItem[] {
    return [...this.shown];
  }

  private saveSession(): void {
    this.deps.session?.save({ savedAt: new Date(this.now()).toISOString(), history: this.history, transcript: this.shown.slice(-MAX_TRANSCRIPT) });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  reset(): void {
    this.history.length = 0;
    this.shown.length = 0;
    this.deps.session?.clear();
    this.lastResult = null;
    this.pending.clear();
    this.notes = [];
    this.deps.emit({ type: "reset" });
  }

  async ask(rawQuestion: string, thinking = false): Promise<void> {
    const started = performance.now();
    // Pasted blueprint strings never reach the model: they become checked summaries.
    const pasted = summarizePasted(rawQuestion, this.deps.prototypes());
    const question = pasted.question;
    this.currentQuestion = question;
    if (pasted.raws.length) this.lastBlueprint = { raw: pasted.raws.at(-1)!, at: this.now() };
    const snap = this.deps.game.latest() ?? this.deps.fallbackSnapshot?.();
    const found = this.deps.retriever()?.retrieve(question);
    const plannedTarget = parseTarget(question) !== null;
    const snapshot = snap ? formatSnapshot(snap.digest, this.now() - snap.receivedAt, { question, items: found?.items ?? [], planned: plannedTarget }) : null;
    // Outcomes of approvals since the last turn go in front of the question, keeping history append-only.
    const withBlueprints = pasted.summaries.length ? `${question}\n\n${pasted.summaries.join("\n\n")}` : question;
    const noted = this.notes.length ? `[since your last reply: ${this.notes.join("; ")}]\n\n${withBlueprints}` : withBlueprints;
    this.notes = [];
    // Turn guidance decided in code, kept in the uncached tail so the system prompt stays stable.
    const world = needsWorldTools(question, this.lastResult !== null);
    // A pasted blueprint isn't running yet, so "is anything holding it back?" is about the design, not a trend.
    const chart = !pasted.summaries.length && wantsChart(question);
    const notes = [world ? "" : "no tool call is needed", chart ? "" : "no chart block"].filter(Boolean);
    // Blueprint requests are built in code; the model only explains the result (S14).
    const requested = !pasted.summaries.length && wantsBlueprint(question) ? this.blueprintFor(question, found?.items ?? []) : null;
    // Rate targets get an exact plan computed in code; the model narrates it (S09).
    const plan = requested ? null : this.planFor(question, found?.items ?? []);
    const top = plan?.steps[0];
    const guided = requested
      ? `${noted}\n\n(${requested.build
        ? "A blueprint was built in code from the save's data and the player sees it with a copy button. In 60 words or fewer, using only the numbers in the generated blueprint line: what it makes, what to feed it on the input belt, that a pole must connect it to power, and that you can paste it as ghosts if they ask; no other calculations; no tool call (don't paste it until they ask); never write a blueprint string; no chart."
        : "The blueprint couldn't be built; in 40 words or fewer give the reason from the data and what request would work; no chart."})`
      : pasted.summaries.length
      ? `${noted}\n\n(Review from the checked summary in 90 words or fewer: lead with the total entity count and the main counts, then list every problem the checks found, or say they found none; for rates or bottlenecks use the throughput line's numbers; ${SELECTED.test(question) ? "it's already built in their game, so don't offer to paste it" : "it isn't built, so offer no actions on its entities"}; no tool call or chart.)`
      : top && notes.length
      // The plan's own headline number goes in the guidance: answers sometimes listed inputs but skipped it (FC-114).
      ? `${noted}\n\n(Answer from the computed plan in 80 words or fewer: start with ${top.machines}× ${top.machine} for ${plan!.perMinute}/min ${top.item}, then the inputs; ${notes.join(", ")}.)`
      : notes.length ? `${noted}\n\n(Answer from the data provided in 60 words or fewer; ${notes.join(", ")}.)` : noted;
    // Research questions get the live list of what can be queued right now (decided in code, not guessed).
    const researchLines = /\b(research\w*|tech\w*|unlock\w*|queue)\b/i.test(question) ? await this.researchOptions() : [];
    const planLines = plan ? [formatPlan(plan)] : requested ? [requested.line] : [];
    const unknown = pasted.summaries.length ? null : this.deps.retriever()?.unknownName(question);
    const unknownLines = unknown ? [`[save data: no item, fluid, recipe or building in this save is named "${unknown}"; if it's a nickname, ask which item they mean]`] : [];
    const working: ChatMessage[] = [userTurn(guided, { recipes: [...unknownLines, ...planLines, ...researchLines, ...(found?.lines ?? [])], snapshot })];
    const record: TurnRecord = {
      at: new Date(this.now()).toISOString(), question, world, chart, rounds: [], totalMs: 0,
      chars: {
        system: this.deps.system().length,
        history: this.history.reduce((n, m) => n + m.content.length, 0),
        question: guided.length,
        retrieved: (found?.lines ?? []).join("\n").length,
        snapshot: snapshot?.length ?? 0,
      },
    };
    this.deps.emit({ type: "user", text: pasted.display });
    this.shown.push({ kind: "user", text: pasted.display });
    if (plan) this.deps.emit({ type: "plan", plan });
    // Pasted blueprints get the same sketch card, with the player's original string to copy back (FC-044).
    const protosForSketch = this.deps.prototypes();
    if (protosForSketch) {
      for (const raw of pasted.raws) {
        try {
          const first = blueprintsIn(decodeBlueprintString(raw))[0];
          if (!first) continue;
          const bp = first.blueprint;
          this.deps.emit({ type: "blueprint", blueprint: sketchBlueprint(bp, protosForSketch.entities, { label: first.path || "pasted blueprint", string: raw, summary: `${bp.entities.length} entities${bp.entities.length > MAX_SKETCH_ENTITIES ? ` (first ${MAX_SKETCH_ENTITIES} drawn)` : ""} · pasted` }) });
        } catch {
          // The summary already says it couldn't be read.
        }
      }
    }
    if (requested?.build) {
      const card = blueprintCard(requested.build, this.deps.prototypes()!.entities);
      this.lastBlueprint = { raw: card.string, at: this.now() };
      this.deps.emit({ type: "blueprint", blueprint: card });
    }

    let ttftMs: number | undefined;
    try {
      for (let round = 0; ; round++) {
        const tools = round < MAX_TOOL_ROUNDS ? TOOLS : undefined;
        // Turns without charts drop any chart block the model writes anyway (FC-111).
        const filter = chart ? null : new ChartBlockFilter();
        const show = (text: string) => {
          if (!text) return;
          ttftMs ??= performance.now() - started;
          this.deps.emit({ type: "token", text });
        };
        const result = await this.deps.model.stream(buildMessages(this.deps.system(), [...this.history, ...working.slice(0, -1)], working.at(-1)!), {
          thinking,
          tools,
          onToken: (text) => show(filter ? filter.push(text) : text),
        });
        if (filter) show(filter.end());
        record.rounds.push({
          promptTokens: result.usage?.prompt_tokens, cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens,
          serverTtftS: result.usage?.time_to_first_token, completionTokens: result.usage?.completion_tokens,
          ms: result.totalMs, toolCalls: result.toolCalls.length,
        });
        if (result.toolCalls.length === 0) {
          let text = chart ? result.text : stripChartBlocks(result.text);
          if (chart && !text.includes("```rate_chart")) {
            const block = fallbackChart(question, found?.items ?? [], snap?.digest);
            if (block) { text += block; this.deps.emit({ type: "token", text: block }); }
          }
          working.push({ role: "assistant", content: text });
          // Store the question without its bulky retrieved lines and snapshot: the next turn re-reads the
          // previous turn anyway (it sits past the last cache block), so a short version is much cheaper (S08).
          this.history.push(...working.map((m, i) => (i === 0 && m.role === "user" ? { ...m, content: compactUserContent(m.content) } : m)));
          this.shown.push({ kind: "agent", text });
          record.visibleTtftMs = ttftMs;
          record.totalMs = performance.now() - started;
          this.logTurn(record);
          await this.compactIfNeeded();
          this.saveSession();
          this.deps.emit({
            type: "done", ttftMs, totalMs: performance.now() - started,
            promptTokens: result.usage?.prompt_tokens, cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens, completionTokens: result.usage?.completion_tokens,
          });
          return;
        }
        working.push({ role: "assistant", content: result.text, tool_calls: result.toolCalls });
        for (const call of result.toolCalls) working.push({ role: "tool", tool_call_id: call.id, content: await this.runTool(call) });
      }
    } catch (e) {
      this.deps.emit({ type: "error", message: (e as Error).message });
    }
  }

  /** Trims old turns past the budget, then re-warms the cache so the next question doesn't pay for it. */
  private async compactIfNeeded(): Promise<void> {
    const result = compactHistory(this.history);
    if (!result) return;
    this.history.splice(0, this.history.length, ...result.history);
    const started = performance.now();
    try {
      await this.deps.model.stream(buildMessages(this.deps.system(), this.history, userTurn("Reply with OK.")), { maxTokens: 1, tools: TOOLS });
    } catch {
      // Warming is an optimization; the next question just pays the prefill instead.
    }
    this.logLine({ kind: "compaction", at: new Date(this.now()).toISOString(), beforeTokens: result.beforeTokens, afterTokens: result.afterTokens, warmMs: performance.now() - started });
  }

  /** The item next to the rate, built as a production row; the line tells the model what came out. */
  private blueprintFor(question: string, items: string[]): { line: string; build?: RowBuild } | null {
    const target = parseTarget(question);
    const protos = this.deps.prototypes();
    if (!target || !protos) return null;
    const producible = (i: string) => Object.values(protos.recipes).some((r) => r.products.some((p) => p.name === i));
    const named = target.phrase ? (this.deps.retriever()?.match(target.phrase) ?? []).map((e) => e.name) : [];
    const item = named.find(producible) ?? items.find((i) => producible(i) && !protos.machines[i]);
    if (!item) return { line: `[blueprint not built: couldn't tell which item "${target.phrase}" means]` };
    const r = productionRow(protos, { item, perMinute: target.perMinute });
    return r.ok ? { line: describeRow(r.build), build: r.build } : { line: `[blueprint not built for ${item} at ${target.perMinute}/min: ${r.reason}]` };
  }

  private planFor(question: string, items: string[]): Plan | null {
    const target = parseTarget(question);
    const protos = this.deps.prototypes();
    if (!target || !protos) return null;
    const rate = target.perMinute;
    const producible = (i: string) => Object.values(protos.recipes).some((r) => r.products.some((p) => p.name === i));
    // The thing next to the number is what to make ("60 bioflux per minute"); machine words elsewhere
    // ("how many biochambers") are what to count, not what to plan.
    const named = target.phrase ? (this.deps.retriever()?.match(target.phrase) ?? []).map((e) => e.name) : [];
    const item = named.find(producible) ?? items.find((i) => producible(i) && !protos.machines[i]);
    if (!item) return null;
    if (this.planner?.source !== protos) this.planner = { source: protos, planner: new Planner(protos) };
    const plan = this.planner.planner.plan(item, rate);
    return plan.steps.length ? plan : null;
  }

  private async researchOptions(): Promise<string[]> {
    try {
      const r = await this.deps.game.call("research_options");
      if (!r.options.length) return [`researchable now: nothing (${r.available} available)`];
      const packs = (p: string[]) => p.map((n) => n.replace(/-science-pack$/, "")).join("+");
      return [`researchable now (${r.available}, cheapest first): ${r.options.map((o) => `${o.name} ${o.count}×${packs(o.packs)}`).join(", ")}${r.queue.length ? ` | queue: ${r.queue.join(", ")}` : " | queue: empty"}`];
    } catch {
      return [];
    }
  }

  private logTurn(record: TurnRecord): void {
    this.logLine(record);
  }

  private logLine(record: object): void {
    if (!this.deps.turnLog) return;
    try {
      mkdirSync(dirname(this.deps.turnLog), { recursive: true });
      appendFileSync(this.deps.turnLog, JSON.stringify(record) + "\n");
    } catch {
      // Logging must never break answering.
    }
  }

  private async runTool(call: ToolCall): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return `Error: arguments for ${call.function.name} weren't valid JSON.`;
    }
    try {
      switch (call.function.name) {
        case "find_entities":
          return await this.find(args);
        case "find_stuck_machines":
          return await this.findStuck(args);
        case "mark_deconstruction":
        case "cancel_deconstruction":
          return this.proposeOnLastResult(call.function.name);
        case "mark_upgrade":
          return this.proposeOnLastResult("mark_upgrade", args.to ? String(args.to) : undefined);
        case "screenshot":
          return await this.screenshot(args.at === "last_result" ? "last_result" : "here");
        case "set_recipe":
          return this.proposeRecipe(String(args.recipe ?? ""));
        case "queue_research":
          return await this.queueResearch(String(args.technology ?? ""));
        case "map_action":
          return await this.mapAction(args);
        case "place_blueprint":
          return this.proposeBlueprint();
        default:
          return `Error: there is no tool named ${call.function.name}. You can only use: ${TOOLS.map((t) => t.function.name).join(", ")}.`;
      }
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }

  private async find(args: Record<string, unknown>): Promise<string> {
    // The player's own words win over the model's paraphrase (it once turned "yellow belts" into "fast transport belts").
    const fromQuestion = resolveEntityFilterInText(this.currentQuestion, this.deps.prototypes());
    const filter = fromQuestion ?? resolveEntityFilter(String(args.what ?? ""), this.deps.prototypes());
    const said = String(args.what ?? "");
    const what = fromQuestion?.names ? fromQuestion.names.join(", ") : said || fromQuestion?.label || "";
    if (!filter) return `I don't know what "${what}" refers to in this save. Nothing was searched.`;
    const direction = (["right", "left", "up", "down", "around"] as const).find((d) => d === args.direction) ?? "around";
    const radius = Math.min(Math.max(Number(args.radius) || 32, 1), 128);
    const r: FindEntitiesResult = await this.deps.game.call("find_entities", { types: filter.types, names: filter.names, direction, radius });
    const compass = { right: "east", left: "west", up: "north", down: "south", around: "all directions" }[direction];
    const where = `within ${radius} tiles ${direction === "around" ? "around" : `to the ${direction} (${compass}) of`} the player on ${r.surface}`;
    this.lastResult = { refs: r.entities, label: what, count: r.count, at: this.now(), where };
    if (r.count > 0) await this.deps.game.call("highlight", { entities: r.entities, seconds: HIGHLIGHT_SECONDS });
    const kinds = Object.entries(r.by_name).map(([n, c]) => `${n} ${c}`).join(", ");
    const summary = `Found ${r.count} ${what} ${where}${kinds ? ` (${kinds})` : ""}.`;
    this.deps.emit({ type: "tool", summary: `${summary}${r.count ? ` Highlighted in-game for ${HIGHLIGHT_SECONDS} s.` : ""}` });
    return [
      summary,
      r.not_visible ? `${r.not_visible} more are in chunks the player can't see right now and weren't counted.` : "",
      r.truncated ? `Only the first ${r.entities.length} are remembered.` : "",
      r.count ? `They are highlighted in-game for ${HIGHLIGHT_SECONDS} s and remembered as the last result.` : "",
    ].filter(Boolean).join(" ");
  }

  private async findStuck(args: Record<string, unknown>): Promise<string> {
    const what = String(args.what ?? "");
    const digest = this.deps.game.latest()?.digest;
    if (!digest?.machines) return "Machine status isn't available yet (the game isn't connected or the registry is still starting).";
    const names = new Set(this.deps.retriever()?.match(what).map((e) => e.name) ?? []);
    const wanted = String(args.surface ?? "");
    const candidates = digest.machines.stuck
      .filter((s) => !wanted || s.surface === wanted)
      .flatMap((s) => s.recipes.map((r) => ({ surface: s.surface, recipe: r.recipe })))
      .filter((c) => [...names].some((n) => c.recipe === n || c.recipe === `mining ${n}`) || c.recipe.replace(/-/g, " ").includes(what.toLowerCase().replace(/s$/, "")));
    if (!candidates.length) return `No stuck machines for "${what}" in the current status data${wanted ? ` on ${wanted}` : ""}.`;
    // Prefer the player's surface, where results can be highlighted.
    const here = digest.player?.surface;
    candidates.sort((a, b) => Number(b.surface === here) - Number(a.surface === here));
    const parts: string[] = [];
    let refs: EntityRef[] = [];
    for (const c of candidates.slice(0, 2)) {
      const r = await this.deps.game.call("find_machines", { recipe: c.recipe, surface: c.surface });
      const statuses = Object.entries(r.by_status).map(([st, n]) => `${st.replace(/_/g, " ")} ${n}`).join(", ");
      parts.push(`${r.count} ${c.recipe} machines not working on ${c.surface}${statuses ? ` (${statuses})` : ""}${r.not_visible ? `, ${r.not_visible} more in chunks the player can't see` : ""}${r.same_surface ? "" : " (not highlighted: the player is on another surface)"}`);
      if (r.same_surface) refs = [...refs, ...r.entities];
    }
    if (refs.length) {
      await this.deps.game.call("highlight", { entities: refs.slice(0, 1000), seconds: HIGHLIGHT_SECONDS });
      this.lastResult = { refs, label: `stuck ${what}`, count: refs.length, at: this.now(), where: `on ${here}` };
    }
    const summary = `${parts.join("; ")}.${refs.length ? ` Highlighted in-game for ${HIGHLIGHT_SECONDS} s.` : ""}`;
    this.deps.emit({ type: "tool", summary });
    return summary;
  }

  private card(title: string, detail: string, run: () => Promise<string>): string {
    const id = crypto.randomUUID();
    this.pending.set(id, { id, title, run });
    this.deps.emit({ type: "approval", id, title, detail });
    return "An approval card is now shown to the player. Nothing has been done yet: tell them to confirm or cancel in the app. The outcome will arrive with their next message.";
  }

  private proposeOnLastResult(action: "mark_deconstruction" | "cancel_deconstruction" | "mark_upgrade", to?: string): string {
    const last = this.lastResult;
    if (!last || this.now() - last.at > RESULT_TTL_MS) return "Error: there is no recent search result to act on. Use find_entities first.";
    if (last.refs.length === 0) return `Error: the last search found no ${last.label}, so there's nothing to act on.`;
    const n = last.refs.length;
    const entities = last.refs;
    const applied = (verb: string) => async () => {
      const target = action === "mark_upgrade" && to ? resolveEntityFilter(to, this.deps.prototypes())?.names?.[0] : undefined;
      const r = action === "mark_upgrade"
        ? await this.deps.game.call("mark_upgrade", { entities, ...(target ? { target } : {}) })
        : await this.deps.game.call(action, { entities });
      const refused = Object.entries(r.rejected).map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`).join(", ");
      return `${verb} ${plural(r.done, "entity")}${refused ? `; refused: ${refused}` : ""}.`;
    };
    if (action === "mark_deconstruction") return this.card(`Mark ${n} ${last.label} for deconstruction?`, `The ${last.label} found ${last.where}, highlighted in-game. Construction robots remove them; Ctrl+Z in-game undoes the marks.`, applied("Marked"));
    if (action === "cancel_deconstruction") return this.card(`Cancel deconstruction marks on ${n} ${last.label}?`, `Removes deconstruction marks from the ${last.label} found ${last.where}.`, applied("Unmarked"));
    return this.card(`Mark ${n} ${last.label} for upgrade${to ? ` to ${to}` : ""}?`, `The ${last.label} found ${last.where}, like an upgrade planner. Robots swap them when the items are available; Ctrl+Z undoes the marks.`, applied("Marked for upgrade"));
  }

  /** The recipe a player means by "gears" or "iron gear wheels": a recipe of that name, else the usual recipe for that item. */
  private resolveRecipe(text: string): string | null {
    const protos = this.deps.prototypes();
    if (!protos) return null;
    if (protos.recipes[text]) return text;
    if (this.planner?.source !== protos) this.planner = { source: protos, planner: new Planner(protos) };
    for (const e of this.deps.retriever()?.match(text) ?? []) {
      if (protos.recipes[e.name] && e.kind !== "technology") return e.name;
      const usual = e.kind === "item" || e.kind === "fluid" ? this.planner.planner.recipeFor(e.name) : null;
      if (usual) return usual;
    }
    return null;
  }

  /** Look: a picture of the player's spot or the last result, shown on the page (not sent to the model). */
  private async screenshot(at: "here" | "last_result"): Promise<string> {
    const dir = this.deps.scriptOutput;
    if (!dir) return "Error: screenshots aren't available (the game's output folder isn't known).";
    const last = at === "last_result" && this.lastResult && this.now() - this.lastResult.at <= RESULT_TTL_MS ? this.lastResult.refs : null;
    const spot = last?.length
      ? { x: last.reduce((n, r) => n + r.x, 0) / last.length, y: last.reduce((n, r) => n + r.y, 0) / last.length }
      : undefined;
    const r = await this.deps.game.call("screenshot", { ...(spot ?? {}), size: 1024, zoom: 0.5 });
    const name = await waitForShot(dir, r.path);
    pruneShots(join(dir, "companion"));
    const where = `${Math.round(r.tiles)} tiles across around (${Math.round(r.x)}, ${Math.round(r.y)}) on ${r.surface}`;
    this.deps.emit({ type: "image", url: `/shots/${name}`, caption: `${spot ? this.lastResult!.label : "Your spot"}: ${where}` });
    return `A screenshot is now shown to the player: ${where}. You can't see it; don't describe its contents.`;
  }

  private proposeRecipe(what: string): string {
    const last = this.lastResult;
    if (!last || this.now() - last.at > RESULT_TTL_MS) return "Error: there is no recent search result to act on. Use find_entities first.";
    if (last.refs.length === 0) return `Error: the last search found no ${last.label}, so there's nothing to act on.`;
    const recipe = this.resolveRecipe(what);
    if (!recipe) return `Error: no recipe matching "${what}" in this save. Nothing was changed.`;
    const entities = last.refs;
    return this.card(`Set ${entities.length} ${last.label} to make ${recipe}?`, `The ${last.label} found ${last.where}, highlighted in-game. Ingredients inside them go to your inventory; anything that doesn't fit spills next to the machine.`, async () => {
      const r = await this.deps.game.call("set_recipe", { entities, recipe });
      const refused = Object.entries(r.rejected).map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`).join(", ");
      const items = r.returned || r.spilled ? `; ${r.returned} items back to your inventory${r.spilled ? `, ${r.spilled} spilled` : ""}` : "";
      return `Set ${plural(r.done, "machine")} to ${recipe}${items}${refused ? `; refused: ${refused}` : ""}.`;
    });
  }

  /** Small requests run right away only when the player's own words asked for them; otherwise they need a card. */
  private asked(pattern: RegExp): boolean {
    return pattern.test(this.currentQuestion);
  }

  private async queueResearch(what: string): Promise<string> {
    const candidates = this.deps.retriever()?.technologiesFor(what) ?? [];
    if (!candidates.length) return `I couldn't find a technology matching "${what}" in this save.`;
    const run = async (): Promise<string> => {
      const failures: string[] = [];
      for (const technology of candidates.slice(0, 3)) {
        try {
          const r = await this.deps.game.call("queue_research", { technology });
          return `Queued ${r.queued}. Queue: ${r.queue.join(", ")}.`;
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      return `Not queued: ${failures.join(" ")}`;
    };
    if (!this.asked(/\b(queue|research|start)\b/i)) return this.card(`Queue research: ${candidates[0]}?`, "Adds it to the research queue.", run);
    const message = await run();
    this.deps.emit({ type: "tool", summary: message });
    return message;
  }

  private async mapAction(args: Record<string, unknown>): Promise<string> {
    const kind = args.kind === "camera" ? "camera" : "tag";
    const digest = this.deps.game.latest()?.digest;
    const atLast = args.at === "last_result" && this.lastResult?.refs[0];
    const spot = atLast ? { x: this.lastResult!.refs[0]!.x, y: this.lastResult!.refs[0]!.y } : digest?.player ? { x: digest.player.position.x, y: digest.player.position.y } : null;
    if (!spot) return "Error: the player's position isn't known yet.";
    const run = async (): Promise<string> => {
      if (kind === "camera") {
        const r = await this.deps.game.call("camera_to", spot);
        return `Camera moved to (${r.x}, ${r.y}) on ${r.surface}. Press Esc in-game to return.`;
      }
      const r = await this.deps.game.call("add_map_tag", { ...spot, text: String(args.text ?? "companion") });
      return `Map tag "${r.text}" added at (${r.x}, ${r.y}).`;
    };
    const wanted = kind === "camera" ? /\b(camera|jump|show me|take me|go to|look at)\b/i : /\b(tag|pin|label|mark (it )?on (the )?map)\b/i;
    if (!this.asked(wanted)) return this.card(kind === "camera" ? `Move your camera to (${Math.floor(spot.x)}, ${Math.floor(spot.y)})?` : `Add a map tag at (${Math.floor(spot.x)}, ${Math.floor(spot.y)})?`, kind === "camera" ? "Opens remote view there; nothing in the factory changes." : `Tag text: ${String(args.text ?? "companion")}`, run);
    try {
      const message = await run();
      this.deps.emit({ type: "tool", summary: message });
      return message;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }

  private proposeBlueprint(): string {
    const bp = this.lastBlueprint;
    if (!bp || this.now() - bp.at > RESULT_TTL_MS) return "Error: no blueprint has been pasted or built recently. Ask the player to paste one or request one first.";
    const position = this.deps.game.latest()?.digest.player?.position;
    if (!position) return "Error: the player's position isn't known yet.";
    return this.card(`Paste the blueprint at your position (${position.x}, ${position.y})?`, "Placed as ghosts, like pasting it yourself; construction robots build it and Ctrl+Z undoes it.", async () => {
      const r = await this.deps.game.call("place_blueprint", { blueprint: bp.raw, x: position.x, y: position.y });
      return `Placed ${r.placed} of ${r.expected} ghosts at (${r.x}, ${r.y})${r.placed < r.expected ? " (some spots were blocked)" : ""}.`;
    });
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (!p) return this.deps.emit({ type: "approval_result", id, status: "expired", message: "This request is no longer pending." });
    this.pending.delete(id);
    try {
      const message = await p.run();
      this.notes.push(`player approved "${p.title}" → ${message}`);
      this.deps.emit({ type: "approval_result", id, status: "done", message });
    } catch (e) {
      const message = `Couldn't do it: ${(e as Error).message}`;
      this.notes.push(`player approved "${p.title}" but it failed: ${message}`);
      this.deps.emit({ type: "approval_result", id, status: "failed", message });
    }
  }

  decline(id: string): void {
    const p = this.pending.get(id);
    if (!p) return this.deps.emit({ type: "approval_result", id, status: "expired", message: "This request is no longer pending." });
    this.pending.delete(id);
    this.notes.push(`player declined "${p.title}"; nothing was changed`);
    this.deps.emit({ type: "approval_result", id, status: "declined", message: "Cancelled. Nothing was changed." });
  }
}
