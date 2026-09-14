// The agent loop: retrieval + snapshot → model → tools → answer, with approvals for map changes.
// Looks run immediately; map changes wait for the player to confirm a card in the web page.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ActionArgs, ActionData, ActionName, EntityRef, FindEntitiesResult, Prototypes } from "@companion/interfaces";
import { resolveEntityFilter } from "./entities";
import type { Snapshot } from "./game";
import type { ServerMessage } from "./messages";
import type { ChatMessage, ChatModel, ToolCall, ToolSpec } from "./model";
import { buildMessages, formatSnapshot, userTurn } from "./prompt";
import type { RecipeRetriever } from "./retrieval";

export interface GameActions {
  call<A extends ActionName>(action: A, args?: ActionArgs<A>): Promise<ActionData<A>>;
  latest(): Snapshot | undefined;
}

type MapAction = "mark_deconstruction" | "cancel_deconstruction";
type Pending = { id: string; action: MapAction; entities: EntityRef[]; title: string };
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
      name: "mark_deconstruction",
      description: "Ask the player to approve marking the last result for deconstruction (like a deconstruction planner drag; robots do the work; Ctrl+Z undoes it). Nothing happens until they confirm.",
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
  if (/\b(find|search|look for|highlight|show me|where are|count)\b/.test(q)) return true;
  if (/\b(mark|unmark|deconstruct\w*|remove|delete|clear|cancel)\b/.test(q)) return true;
  if (/\bhow many\b/.test(q) && !/\b(need|needs|take|takes|require|requires|make|makes|per)\b/.test(q)) return true;
  if (hasLastResult && /\b(them|those|these|it|that)\b/.test(q)) return true;
  return false;
}

/** Is the player asking about a trend over time, where a rate_chart helps? */
export function wantsChart(question: string): boolean {
  return /\b(chart|graph|plot|trend\w*|over time|history|holding|steady|stable|drop\w*|fall\w*|ris\w*|increas\w*|decreas\w*|slow\w* down|how('s| is) .+ doing)\b/i.test(question);
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;

export class Agent {
  readonly history: ChatMessage[] = [];
  private lastResult: LastResult | null = null;
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
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  reset(): void {
    this.history.length = 0;
    this.lastResult = null;
    this.pending.clear();
    this.notes = [];
    this.deps.emit({ type: "reset" });
  }

  async ask(question: string, thinking = false): Promise<void> {
    const started = performance.now();
    const snap = this.deps.game.latest() ?? this.deps.fallbackSnapshot?.();
    const found = this.deps.retriever()?.retrieve(question);
    const snapshot = snap ? formatSnapshot(snap.digest, this.now() - snap.receivedAt, { question, items: found?.items ?? [] }) : null;
    // Outcomes of approvals since the last turn go in front of the question, keeping history append-only.
    const noted = this.notes.length ? `[since your last reply: ${this.notes.join("; ")}]\n\n${question}` : question;
    this.notes = [];
    // Turn guidance decided in code, kept in the uncached tail so the system prompt stays stable.
    const world = needsWorldTools(question, this.lastResult !== null);
    const chart = wantsChart(question);
    const notes = [world ? "" : "no tool call is needed", chart ? "" : "no chart block"].filter(Boolean);
    const guided = notes.length ? `${noted}\n\n(Answer from the data provided in 60 words or fewer; ${notes.join(", ")}.)` : noted;
    const working: ChatMessage[] = [userTurn(guided, { recipes: found?.lines ?? [], snapshot })];
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
    this.deps.emit({ type: "user", text: question });

    let ttftMs: number | undefined;
    try {
      for (let round = 0; ; round++) {
        const tools = round < MAX_TOOL_ROUNDS ? TOOLS : undefined;
        const result = await this.deps.model.stream(buildMessages(this.deps.system(), [...this.history, ...working.slice(0, -1)], working.at(-1)!), {
          thinking,
          tools,
          onToken: (text) => {
            ttftMs ??= performance.now() - started;
            this.deps.emit({ type: "token", text });
          },
        });
        record.rounds.push({
          promptTokens: result.usage?.prompt_tokens, cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens,
          serverTtftS: result.usage?.time_to_first_token, completionTokens: result.usage?.completion_tokens,
          ms: result.totalMs, toolCalls: result.toolCalls.length,
        });
        if (result.toolCalls.length === 0) {
          working.push({ role: "assistant", content: result.text });
          this.history.push(...working);
          record.visibleTtftMs = ttftMs;
          record.totalMs = performance.now() - started;
          this.logTurn(record);
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

  private logTurn(record: TurnRecord): void {
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
        case "mark_deconstruction":
        case "cancel_deconstruction":
          return this.propose(call.function.name);
        default:
          return `Error: there is no tool named ${call.function.name}. You can only use: ${TOOLS.map((t) => t.function.name).join(", ")}.`;
      }
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }

  private async find(args: Record<string, unknown>): Promise<string> {
    const what = String(args.what ?? "");
    const filter = resolveEntityFilter(what, this.deps.prototypes());
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

  private propose(action: MapAction): string {
    const last = this.lastResult;
    if (!last || this.now() - last.at > RESULT_TTL_MS) return "Error: there is no recent search result to act on. Use find_entities first.";
    if (last.refs.length === 0) return `Error: the last search found no ${last.label}, so there's nothing to act on.`;
    const id = crypto.randomUUID();
    const n = last.refs.length;
    const title = action === "mark_deconstruction" ? `Mark ${n} ${last.label} for deconstruction?` : `Cancel deconstruction marks on ${n} ${last.label}?`;
    const detail = action === "mark_deconstruction"
      ? `The ${last.label} found ${last.where}, highlighted in-game. Construction robots remove them; Ctrl+Z in-game undoes the marks.`
      : `Removes deconstruction marks from the ${last.label} found ${last.where}.`;
    this.pending.set(id, { id, action, entities: last.refs, title });
    this.deps.emit({ type: "approval", id, title, detail });
    return "An approval card is now shown to the player. Nothing has been done yet: tell them to confirm or cancel in the app. The outcome will arrive with their next message.";
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (!p) return this.deps.emit({ type: "approval_result", id, status: "expired", message: "This request is no longer pending." });
    this.pending.delete(id);
    try {
      const r = await this.deps.game.call(p.action, { entities: p.entities });
      const refused = Object.entries(r.rejected).map(([reason, n]) => `${n} ${reason.replace(/_/g, " ")}`).join(", ");
      const verb = p.action === "mark_deconstruction" ? "Marked" : "Unmarked";
      const message = `${verb} ${plural(r.done, "entity")}${refused ? `; refused: ${refused}` : ""}.`;
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
