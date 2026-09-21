import type { Interrupted } from "@companion/interfaces";
// The agent loop: retrieval + snapshot → model → tools → answer, with approvals for map changes.
// Looks run immediately; map changes wait for the player to confirm a card in the web page.
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ActionArgs, ActionData, ActionName, Digest, EntityRef, FindEntitiesResult, Prototypes } from "@companion/interfaces";
import { summarizePasted } from "./blueprint-review";
import { blueprintsIn, decodeBlueprintString, encodeBlueprintString, type Blueprint } from "./blueprint";
import { describeRow, productionRow, type RowBuild } from "./blueprint-template";
import { stageFor, stageLines, tookAThrowback } from "./stages";
import { materialCorrections, nameCorrections } from "./names";
import { actionClaims } from "./claims";
import { renamedNote, resolveListItems } from "./list-items";
import type { Decisions } from "./decisions";
import { remarkDue, turnNotes } from "./guidance";
import { REFERENCE, SELECTED, SPATIAL, bareFollowUp, needsWorldTools, ASKS_FOR, askedFor, parseTarget, anchorFor, wantsBlueprint, plainAnswer, wantsBuild, wantsChart } from "./intent";
export { bareFollowUp, needsWorldTools, PICTURE, ASKS_FOR, askedFor, parseTarget, targetRate, anchorFor, SELECTED_PREFIX, wantsBlueprint, plainAnswer, wantsBuild, wantsChart } from "./intent";
import type { BlueprintCard } from "./messages";
import { HiddenBlockFilter, LIST_REPORT, RepeatFilter, TailCutFilter, stripChartBlocks } from "./stream-filter";
import { pruneShots, waitForShot } from "./screenshots";
import { resolveEntityFilter, resolveEntityFilterInText } from "./entities";
import type { Snapshot } from "./game";
import type { ServerMessage } from "./messages";
import type { ChatMessage, ChatModel, StreamResult, ToolCall, ToolSpec } from "./model";
import { buildMessages, formatSnapshot, userTurn } from "./prompt";
import { formatPlan, Planner, type Plan } from "./planner";
import type { RecipeRetriever } from "./retrieval";
import { entityFacts } from "./grounding";
import { Lists, type Checklist, type ListsData } from "./lists";
import { arithmeticCorrections } from "./numbers";
import { check, essentials, parseNeed, readiness, slots, type Need } from "./packing";
import { acceptedOffer, contentsTarget, correctedRequest, bearing, formatContents, formatMachineOutput, formatPointedAt, formatSpidertrons, formatStock, formatNetwork, wantsStock, wantsReady, wantsListTalk, wantsPackingList, wantsBotsToFill, wantsRequestsCleared, wantsContents, wantsMeasuredOutput, wantsPointedAt, wantsSpidertronSent, wantsStop, claimCorrections, craftableRecipes, formatPlayerStatus, lootNote, formatSurroundings, wantsPlayerStatus, wantsStartAdvice, wantsSurroundings } from "./player";

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
  chars: { system: number; history: number; question: number; retrieved: number; player?: number; snapshot: number };
  rounds: { promptTokens?: number; cachedTokens?: number; serverTtftS?: number; completionTokens?: number; ms: number; toolCalls: number; tools?: string[] }[];
  visibleTtftMs?: number;
  /** Corrections added for counts or builds the answer got wrong (FC-140). */
  corrected?: number;
  /** The answer started over and was cut to one copy (FC-130). */
  repeated?: boolean;
  /** A list report was cut off the end (FC-219). */
  listCut?: boolean;
  /** How many of the turn's judgement calls Jev answered, and how many fell to the code (FC-244). */
  decisions?: { jev: number; local: number };
  /** Tool calls dropped because the player didn't ask for them (FC-126). */
  dropped?: number;
  totalMs: number;
};

const MAX_TOOL_ROUNDS = 3;
export type TranscriptItem = { kind: "user" | "agent"; text: string };
export type SessionData = { savedAt: string; history: ChatMessage[]; transcript: TranscriptItem[]; lists?: ListsData; throwbacks?: number; interruptions?: number; remarkedAt?: number };
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

/**
 * One conversation per map, in `dir` (FC-137). The first map ever seen adopts the conversation saved
 * before maps had ids (`legacyPath`), so an upgrade doesn't lose the thread.
 */
export function mapSession(dir: string, mapId: string, legacyPath?: string): SessionStore {
  const path = join(dir, `${mapId.replace(/[^\w-]/g, "_")}.json`);
  const firstMap = !existsSync(dir) || readdirSync(dir).length === 0;
  if (legacyPath && firstMap && existsSync(legacyPath)) {
    mkdirSync(dir, { recursive: true });
    renameSync(legacyPath, path);
  }
  return fileSession(path);
}

/** Estimated history size that triggers compaction (FC-076). ~2.8 characters per token measured. */
const HISTORY_BUDGET_TOKENS = 8000;
const KEEP_RECENT_TURNS = 2;
const CHARS_PER_TOKEN = 2.8;
const TAIL_MARKERS = ["\n\n[recipes and technologies from this save]", "\n\n[the player right now]", "\n\n[game state", "\n\n(Answer in ", "\n\n(Answer from the data provided", "\n\n(Review from the checked summary"];

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
      name: "update_list",
      description: "Change one of the player's lists when they ask: start one, add or remove items, tick items off, rename or clear it. The player can't edit lists themselves, so every change comes through here. One call can do several changes.",
      parameters: {
        type: "object",
        properties: {
          list: { type: "string", description: "Which list, in the player's words (\"packing\", \"repairs\"). Left out means the one they're already working on." },
          kind: { type: "string", enum: ["plain", "packing"], description: "\"packing\" for a list of items to take on a build run: it ticks itself off against what the player carries." },
          add: { type: "array", items: { type: "string" }, description: "Items to add, one string each, with the count first: \"20 stone furnace\"." },
          set: { type: "array", items: { type: "string" }, description: "Items whose count changes, written in full: \"30 stone furnace\" when 20 were on the list. Never add the difference as another item." },
          done: { type: "array", items: { type: "string" }, description: "Items to tick off, as the player named them." },
          undone: { type: "array", items: { type: "string" }, description: "Items to put back." },
          remove: { type: "array", items: { type: "string" }, description: "Items to take off the list." },
          rename: { type: "string", description: "A new name for the list." },
          clear: { type: "boolean", description: "Empty the list but keep it." },
        },
      },
    },
  },
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
      name: "set_train_stop",
      description: "Ask the player to approve setting the train stops in the last result: train limit (-1 for none), priority 0-255, or name. Nothing happens until they confirm.",
      parameters: { type: "object", properties: { limit: { type: "number" }, priority: { type: "number" }, name: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "show_the_way",
      description: "Point the player toward the nearest thing they can see (within 128 tiles): an arrow at their character and a mark on their map, for 30 s.",
      parameters: { type: "object", properties: { what: { type: "string", description: "What to point to, as the player said it: copper ore, the nearest lab, ..." }, at: { type: "string", enum: ["nearest", "last_result"] } }, required: ["what"] },
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

/** The spot and surface for an anchor, from the digest; the note says which one was used when they differ. */
export function anchorSpot(digest: Digest | undefined, from: "character" | "view"): { x: number; y: number; surface?: string; note: string } | null {
  const p = digest?.player;
  if (!p) return null;
  const view = { x: p.position.x, y: p.position.y, surface: p.surface };
  const character = p.character_position ? { x: p.character_position.x, y: p.character_position.y, surface: p.character_surface ?? p.surface } : view;
  const apart = p.remote_view && (character.surface !== view.surface || Math.hypot(character.x - view.x, character.y - view.y) > 16);
  const note = !apart ? "" : from === "character" ? " (you're in map view: used your character's spot, not the map view)" : " (you're in map view: used the spot you're looking at, not your character)";
  return { ...(from === "character" ? character : view), note };
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
  /** The player's lists: the companion owns them, the player asks for changes (FC-163). */
  readonly lists: Lists;
  private readonly shown: TranscriptItem[] = [];
  private lastResult: LastResult | null = null;
  private lastBlueprint: { raw: string; at: number } | null = null;
  private planner: { source: Prototypes; planner: Planner } | null = null;
  private currentQuestion = "";
  /** The question plus any offer it said yes to: what the player asked for this turn (FC-126). */
  private currentIntent = "";
  private pending = new Map<string, Pending>();
  private notes: string[] = [];
  /** Throwbacks to his own past already spent this conversation (FC-182): one, and never on an urgent turn. */
  private throwbacks = 0;
  /** Times the player has spoken over an answer, and at which of them he last remarked on it (FC-241). */
  private interruptions = 0;
  private remarkedAt = 0;

  constructor(
    private readonly deps: {
      model: ChatModel;
      game: GameActions;
      system: () => string;
      retriever: () => RecipeRetriever | null;
      prototypes: () => Prototypes | null;
      fallbackSnapshot?: () => Snapshot | undefined;
      emit: (m: ServerMessage) => void;
      /** Typed decisions (FC-244), with every question's local answer as its fallback. */
      decisions?: Decisions;
      /** One line per finished answer, so the server log shows what he said (FC-243). */
      log?: (line: string) => void;
      now?: () => number;
      /** Appends a JSON line per answered question (FC-080). */
      turnLog?: string;
      /** Where the conversation is kept between server runs (FC-063). */
      session?: SessionStore;
      /** The game's script-output directory, where screenshots land (FC-049). */
      scriptOutput?: string;
    },
  ) {
    this.lists = new Lists(() => this.now());
    this.session = deps.session;
    this.restore();
  }

  private session: SessionStore | undefined;

  private restore(): void {
    const saved = this.session?.load();
    if (saved) {
      this.history.push(...saved.history);
      this.shown.push(...saved.transcript);
      this.lists.load(saved.lists);
      this.throwbacks = saved.throwbacks ?? 0;
      this.interruptions = saved.interruptions ?? 0;
      this.remarkedAt = saved.remarkedAt ?? 0;
      this.showLists();
    }
  }

  /** The console shows every list; the active one also goes to the game's panel (FC-164). */
  private listsShown = false;

  private showLists(): void {
    // Nothing to show and nothing shown before: stay quiet, so a conversation without lists is unchanged.
    if (!this.lists.all().length && !this.listsShown) return;
    this.listsShown = this.lists.all().length > 0;
    this.deps.emit({ type: "lists", lists: this.lists.all(), active: this.lists.active()?.name });
    void this.deps.game.call("set_list", {
      name: this.lists.active()?.name ?? "",
      items: (this.lists.active()?.items ?? []).map((i) => ({ text: i.text, done: i.done, ...(i.note ? { note: i.note } : {}), ...(i.untracked ? { untracked: true } : {}) })),
    }).catch(() => {}); // an older mod or no game: the console still shows it
  }

  /**
   * Switches to another conversation store, for a different map (FC-137): the current conversation
   * stays saved in its own store, and pages are told to show the other one.
   */
  useSession(store: SessionStore): void {
    this.history.length = 0;
    this.shown.length = 0;
    this.lists.clear();
    this.lastResult = null;
    this.lastBlueprint = null;
    this.pending.clear();
    this.notes = [];
    this.session = store;
    this.restore();
    this.deps.emit({ type: "reset" });
    if (this.shown.length) this.deps.emit({ type: "transcript", items: this.transcript() });
  }

  /** What the page showed in this conversation, for pages that connect later. */
  transcript(): TranscriptItem[] {
    return [...this.shown];
  }

  private saveSession(): void {
    this.session?.save({ savedAt: new Date(this.now()).toISOString(), history: this.history, transcript: this.shown.slice(-MAX_TRANSCRIPT), lists: this.lists.save(), throwbacks: this.throwbacks, interruptions: this.interruptions, remarkedAt: this.remarkedAt });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  reset(): void {
    this.history.length = 0;
    this.shown.length = 0;
    this.session?.clear();
    this.lastResult = null;
    this.pending.clear();
    this.notes = [];
    this.throwbacks = 0; // a new conversation is a new shift
    this.interruptions = 0;
    this.remarkedAt = 0;
    // Lists are part of this conversation's state, so clearing it clears them (FC-163): a stale packing list
    // outliving the conversation it was made in confused both the answers and the evals.
    this.lists.clear();
    this.showLists();
    this.deps.emit({ type: "reset" });
  }

  async ask(rawQuestion: string, thinking = false, spoken = false, interrupted?: Interrupted): Promise<void> {
    const started = performance.now();
    const decisionsBefore = { ...(this.deps.decisions?.counts ?? { jev: 0, local: 0 }) };
    // Spoken over the answer (FC-241): he may remark on it once in a few; a bare "stop" with no remark due is just
    // that — the reading has stopped, nothing to answer, no model call.
    let cutIn: { during: string; stopOnly: boolean; remark: boolean } | undefined;
    if (interrupted) {
      this.interruptions++;
      const remark = remarkDue(this.interruptions, this.remarkedAt);
      if (remark) this.remarkedAt = this.interruptions;
      cutIn = { ...interrupted, remark };
      if (interrupted.stopOnly && !remark) {
        this.deps.emit({ type: "user", text: rawQuestion });
        this.shown.push({ kind: "user", text: rawQuestion });
        this.saveSession();
        this.deps.emit({ type: "done", ttftMs: 0, totalMs: performance.now() - started });
        return;
      }
    }
    // Pasted blueprint strings never reach the model: they become checked summaries.
    const pasted = summarizePasted(rawQuestion, this.deps.prototypes());
    const question = pasted.question;
    this.currentQuestion = question;
    if (pasted.raws.length) this.lastBlueprint = { raw: pasted.raws.at(-1)!, at: this.now() };
    const snap = this.deps.game.latest() ?? this.deps.fallbackSnapshot?.();
    let found = this.deps.retriever()?.retrieve(question);
    // "What do I use these for?" names nothing: it means what the last turn was about (FC-153).
    const referred = found && !found.items.length && REFERENCE.test(question) ? this.referredItems() : [];
    if (referred.length) found = this.deps.retriever()?.retrieve(`${question} ${referred.join(" ")}`);
    const plannedTarget = parseTarget(question) !== null;
    // "yeah" after "Want me to look around?" is classified as the offer it accepts (S22).
    const offer = acceptedOffer(question, this.history.findLast((m) => m.role === "assistant" && m.content)?.content);
    // "I meant the rocket silo" keeps the last question's request (FC-154).
    const corrected = offer ? null : correctedRequest(question, this.history.findLast((m) => m.role === "user")?.content);
    const intent = offer ? `${offer} ${question}` : corrected ? `${corrected} ${question}` : question;
    this.currentIntent = intent;
    const world = needsWorldTools(intent, this.lastResult !== null);
    const snapshot = snap ? formatSnapshot(snap.digest, this.now() - snap.receivedAt, { question: intent, items: found?.items ?? [], planned: plannedTarget }) : null;
    // Outcomes of approvals since the last turn go in front of the question, keeping history append-only.
    const withBlueprints = pasted.summaries.length ? `${question}\n\n${pasted.summaries.join("\n\n")}` : question;
    const noted = this.notes.length ? `[since your last reply: ${this.notes.join("; ")}]\n\n${withBlueprints}` : withBlueprints;
    this.notes = [];
    // Turn guidance decided in code, kept in the uncached tail so the system prompt stays stable.
    // A pasted blueprint isn't running yet, so "is anything holding it back?" is about the design, not a trend.
    const chart = !pasted.summaries.length && wantsChart(question);
    // A new "how many / where" question is a new search: earlier results may be for another spot (FC-092 follow-up:
    // "how many belts are here?" after "…near me?" reused the character's result instead of searching the view).
    const searchAgain = world && /\b(how many|find|where (are|is)|count|search|look for|any \w+ (here|near))\b/i.test(question);
    // A follow-up that names nothing of its own means the last thing looked for, and nothing else (FC-187).
    const bare = !pasted.summaries.length && bareFollowUp(question);
    const carryOver = bare ? this.lastResult : null;
    // The player's own situation, fetched only when the question is about it (S22).
    const start = !pasted.summaries.length && wantsStartAdvice(intent);
    const [status, around, pointed] = pasted.summaries.length ? [null, null, null] : await Promise.all([
      wantsPlayerStatus(intent) ? this.lookup("player_status") : null,
      wantsSurroundings(intent) ? this.lookup("surroundings", { resource_radius: 96 }) : null,
      wantsPointedAt(question) ? this.lookup("pointed_at") : null,
    ]);
    // "What's in this chest?": what the player points at, has open or just hovered, else a single thing just found (FC-152).
    const lastOne = this.lastResult && this.lastResult.count === 1 && this.now() - this.lastResult.at <= RESULT_TTL_MS ? this.lastResult.refs[0] : null;
    // The player's own spidertron, and sending it: decided in code, confirmed in a card (FC-144).
    const aboutSpider = !pasted.summaries.length && (wantsSpidertronSent(question) || /\bspider(tron)?\b/i.test(question));
    const spiders = aboutSpider ? await this.lookup("spidertrons") : null;
    const spiderLines = spiders ? formatSpidertrons(spiders) : [];
    const sendLine = wantsSpidertronSent(question) ? await this.proposeSpidertron(spiders, question) : null;
    // "Stop" takes it back at once: the player asked, so it doesn't wait for a card (FC-051).
    const stopLine = !pasted.summaries.length && wantsStop(question) ? await this.stopControl() : null;
    // A packing list keeps itself in step with what the player carries, and answers "am I ready?" (FC-166).
    const packing = this.lists.active()?.kind === "packing" ? this.lists.active()! : null;
    const askedReady = Boolean(packing) && wantsReady(question);
    // "Where are my 200 steel?": what the player carries plus the containers they can see (FC-165).
    const askedStock = !pasted.summaries.length && (wantsStock(question) || askedReady || (Boolean(packing) && wantsListTalk(question)));
    const stock = askedStock ? await this.lookup("stock", { radius: 48 }) : null;
    const stockLines = stock && !packing ? formatStock(stock, found?.items ?? []) : [];
    const packingLines = packing && stock ? this.checkPacking(packing, stock, status, askedReady) : [];
    // "Get the bots to fill it": the companion's own request section, behind a card (FC-168).
    const askedFill = Boolean(packing) && wantsBotsToFill(question);
    const network = askedFill || (packing && wantsReady(question)) ? await this.lookup("logistic_network") : null;
    const networkLines = network ? formatNetwork(network) : [];
    const fillLine = askedFill ? await this.proposeRequests(packing!, network) : null;
    const clearLine = !pasted.summaries.length && wantsRequestsCleared(question) ? await this.clearRequests(false) : null;
    const askedContents = !pasted.summaries.length && wantsContents(question);
    const target = askedContents ? contentsTarget(pointed, lastOne) : null;
    const contentsLine = target ? await this.contentsOf(target) : askedContents ? "no container is under the mouse, open or just hovered, so its contents weren't looked at: ask the player to hover over it" : null;
    // "Is this hitting 150 a minute?": measured in the player's own game from the machines' craft counts (FC-162).
    const protos = this.deps.prototypes();
    const measuredLine = !pasted.summaries.length && wantsMeasuredOutput(question) ? await this.measuredOutput() : null;
    const askedBuild = !pasted.summaries.length && wantsBuild(question);
    // Where they are in the game and what to push for there (FC-180's authored table, FC-181). Only on a "what
    // should I do" turn, and only the matched row: the whole table is ~2,650 tokens and the cached prefix has no
    // room for it. Costs nothing on every other turn.
    const stage = stageFor(protos, snap?.digest ?? null);
    // The list is in front of the model only on turns about it: with it in view every turn, "do you ever miss
    // flying?" got a "3 of 11 ticked" report on the end, live, with the note asking it not to (FC-219).
    const aboutList = askedReady || askedStock || askedFill || Boolean(clearLine) || wantsListTalk(question) || wantsPackingList(question) || askedBuild;
    const playerLines = [
      ...(status ? formatPlayerStatus(status, { builds: start || /\b(buil\w*|plac\w*|made)\b/i.test(intent) }) : []),
      ...(around ? formatSurroundings(around) : []),
      ...(pointed ? formatPointedAt(pointed, (name) => (protos ? entityFacts(name, protos) : null)) : []),
      ...(contentsLine ? [contentsLine] : []),
      ...(measuredLine ? [measuredLine] : []),
      ...(start ? stageLines(stage) : []),
      ...stockLines,
      ...(aboutList ? this.lists.format() : []),
      ...packingLines,
      ...networkLines,
      ...(fillLine ? [fillLine] : []),
      ...(clearLine ? [clearLine] : []),
      ...spiderLines,
      ...(sendLine ? [sendLine] : []),
      ...(stopLine ? [stopLine] : []),
    ];
    // Tools are ruled out only when the retrieved data answers the question; a question nothing matched
    // gets no note, so "I just built something" is free to look (S22).
    const answeredFromData = Boolean(found?.lines.length || playerLines.length);
    // Register, decided in code (FC-179): flat on anything the player is about to act on, dry everywhere else.
    const plain = plainAnswer(question, {
      // Retrieved recipe lines are not a count: treating them as one made every recipe-grounded answer flat, and the
      // player's build description came back as "Numbers, flat: 20 furnaces at 12.5 plates/min…" (FC-212).
      counted: Boolean(carryOver) || (world && SPATIAL.test(question)), measured: Boolean(measuredLine), ready: askedReady,
      card: Boolean(sendLine?.startsWith("An approval card")), stopped: Boolean(stopLine), pointed: Boolean(pointed),
      stock: stockLines.length > 0, packing: Boolean(packing),
    });
    const notes = turnNotes({
      interrupted: cutIn,
      question, plain, measured: Boolean(measuredLine), world, answeredFromData, around: Boolean(around), searchAgain, loot: lootNote(status, around), chart,
      carryOver: carryOver ? { label: carryOver.label, where: carryOver.where } : null, bare, start,
      playerLines: playerLines.length > 0, character: Boolean(status?.character), recipeLines: Boolean(found?.lines.length),
      craftable: craftableRecipes(status).length > 0, describingBuild: wantsPackingList(question) && !packing, spoken, askedBuild,
      stage: { id: stage.row.id, register: stage.row.register }, throwbackSpent: this.throwbacks > 0, askedReady,
      packing: Boolean(packing), listActive: this.lists.all().length > 0,
      aboutList,
      stock: stockLines.length > 0, cardUp: Boolean(sendLine?.startsWith("An approval card")),
      stopped: Boolean(stopLine), pointed: Boolean(pointed), referred, referenceWord: referred.length ? REFERENCE.exec(question)![0] : "",
    });
    // Blueprint requests are built in code; the model only explains the result (S14).
    const requested = !pasted.summaries.length && wantsBlueprint(question) ? this.blueprintFor(question, found?.items ?? []) : null;
    // Rate targets get an exact plan computed in code; the model narrates it (S09).
    const plan = requested ? null : this.planFor(question, found?.items ?? []);
    const top = plan?.steps[0];
    const guided = requested
      ? `${noted}\n\n(${requested.build
        // A request that already says "paste it here" is asked: the old "don't paste until they ask" made the model offer instead (FC-126).
        ? ASKS_FOR.place_blueprint!.test(intent)
          ? "A blueprint was built in code from the save's data and the player sees it with a copy button. They asked to paste it: call place_blueprint now, then in 60 words or fewer, using only the numbers in the generated blueprint line, say what it makes, what to feed it on the input belt, that a pole must connect it to power, and that they confirm the paste in the card; no other calculations; never write a blueprint string; no chart."
          : "A blueprint was built in code from the save's data and the player sees it with a copy button. In 60 words or fewer, using only the numbers in the generated blueprint line: what it makes, what to feed it on the input belt, that a pole must connect it to power, and that you can paste it as ghosts if they ask; no other calculations; no tool call (don't paste it until they ask); never write a blueprint string; no chart."
        : "The blueprint couldn't be built; in 40 words or fewer give the reason from the data and what request would work; no chart."})`
      : pasted.summaries.length
      ? `${noted}\n\n(Review from the checked summary in 90 words or fewer: lead with the total entity count and the main counts, then list every problem the checks found, or say they found none; for rates or bottlenecks use the throughput line's numbers; ${SELECTED.test(question) ? "it's already built in their game, so don't offer to paste it" : "it isn't built, so offer no actions on its entities"}; no tool call or chart.)`
      : top && notes.length
      // The plan's own headline number goes in the guidance: answers sometimes listed inputs but skipped it (FC-114).
      ? `${noted}\n\n(Answer from the computed plan in 80 words or fewer: start with ${top.machines}× ${top.machine} for ${plan!.perMinute}/min ${top.item}, then the inputs; ${notes.join(", ")}.)`
      // "from the data provided" kept recipe answers grounded (tool calls rose without it), but was echoed back
      // as "the data provided doesn't list…" when nothing matched, so it's only used with recipe lines (S22).
      : notes.length ? `${noted}\n\n(${found?.lines.length && !playerLines.length ? "Answer from the data provided in" : "Answer in"} ${start ? 80 : 60} words or fewer; ${notes.join(", ")}.)` : noted;
    // Research questions get the live list of what can be queued right now (decided in code, not guessed).
    const researchLines = start || /\b(research\w*|tech\w*|unlock\w*|queue)\b/i.test(question) ? await this.researchOptions() : [];
    const planLines = plan ? [formatPlan(plan)] : requested ? [requested.line] : [];
    // What the player can hand-craft comes with its recipes: answers stated ingredients from memory (FC-139).
    // What's pointed at or held comes with its recipe, so "what is this, what's it for?" has save data (FC-151).
    const pointedNames = pointed ? [pointed.selected?.name, pointed.hand?.name, pointed.opened?.entity?.name, pointed.last_hovered?.name].filter((n): n is string => Boolean(n)) : [];
    const craftLines = this.deps.retriever()?.recipeLines([...new Set([...pointedNames, ...craftableRecipes(status)])]) ?? [];
    const unknown = pasted.summaries.length ? null : this.deps.retriever()?.unknownName(question);
    const unknownLines = unknown ? [`[save data: no item, fluid, recipe or building in this save is named "${unknown}"; if it's a nickname, ask which item they mean]`] : [];
    const recipeBlock = [...unknownLines, ...planLines, ...researchLines, ...(found?.lines ?? []), ...craftLines.filter((l) => !found?.lines.includes(l))];
    const working: ChatMessage[] = [userTurn(guided, { recipes: recipeBlock, player: playerLines, snapshot })];
    const record: TurnRecord = {
      at: new Date(this.now()).toISOString(), question, world, chart, rounds: [], totalMs: 0,
      chars: {
        system: this.deps.system().length,
        history: this.history.reduce((n, m) => n + m.content.length, 0),
        question: guided.length,
        retrieved: recipeBlock.join("\n").length,
        player: playerLines.join("\n").length,
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
    // Text the model wrote in rounds that also called tools: the page showed it, so the transcript keeps it (FC-127).
    const earlier: string[] = [];
    try {
      for (let round = 0; ; round++) {
        const tools = round < MAX_TOOL_ROUNDS ? TOOLS : undefined;
        // Turns without charts drop any chart block the model writes anyway (FC-111); a tool call written as text is
        // dropped on every turn (FC-184, FC-202).
        const filter = new HiddenBlockFilter({ charts: chart });
        const show = (text: string) => {
          if (!text) return;
          ttftMs ??= performance.now() - started;
          this.deps.emit({ type: "token", text });
        };
        // An answer that starts over is cut to one copy and the stream stopped (FC-130). With a list up and a question
        // that isn't about it, a paragraph reporting the list is cut the same way (FC-219).
        const repeat = new RepeatFilter();
        const tailCut = this.lists.all().length > 0 && !aboutList ? new TailCutFilter(LIST_REPORT) : null;
        const pass = (text: string) => (tailCut ? tailCut.push(text) : text);
        const stop = new AbortController();
        const roundStarted = performance.now();
        let result: StreamResult;
        try {
          result = await this.deps.model.stream(buildMessages(this.deps.system(), [...this.history, ...working.slice(0, -1)], working.at(-1)!), {
            thinking,
            tools,
            signal: stop.signal,
            onToken: (text) => {
              show(repeat.push(pass(filter.push(text))));
              if ((repeat.repeated || tailCut?.cut) && !stop.signal.aborted) stop.abort();
            },
          });
        } catch (e) {
          if (!repeat.repeated && !tailCut?.cut) throw e;
          result = { text: repeat.text(), toolCalls: [], totalMs: performance.now() - roundStarted };
        }
        if (!repeat.repeated && !tailCut?.cut) show(repeat.push(pass(filter.end()) + (tailCut?.end() ?? "")));
        show(repeat.end());
        if (repeat.repeated || tailCut?.cut) {
          if (repeat.repeated) record.repeated = true;
          if (tailCut?.cut) { record.listCut = true; this.deps.log?.("Cut a list report off the end of an answer that wasn't about the list (FC-219)."); }
          result = { ...result, text: repeat.text(), toolCalls: [] };
        }
        record.rounds.push({
          promptTokens: result.usage?.prompt_tokens, cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens,
          serverTtftS: result.usage?.time_to_first_token, completionTokens: result.usage?.completion_tokens,
          ms: result.totalMs, toolCalls: result.toolCalls.length,
          ...(result.toolCalls.length ? { tools: result.toolCalls.map((c) => c.function.name) } : {}),
        });
        // Actions and pictures nobody asked for are dropped (FC-126, FC-127): the round's answer stands without them.
        const calls = result.toolCalls.filter((c) => askedFor(c.function.name, intent));
        const dropped = result.toolCalls.length - calls.length;
        if (dropped) record.dropped = (record.dropped ?? 0) + dropped;
        if (calls.length === 0 && result.toolCalls.length && !result.text.trim()) {
          working.push({ role: "assistant", content: "", tool_calls: result.toolCalls });
          for (const call of result.toolCalls) working.push({ role: "tool", tool_call_id: call.id, content: "Not run: the player hasn't asked for this yet. Answer their question. If it would help, offer it in one short question. Don't say it was done, and don't mention cards, confirmations or that anything was held back." });
          continue;
        }
        if (calls.length === 0) {
          let text = chart ? result.text : stripChartBlocks(result.text);
          if (chart && !text.includes("```rate_chart")) {
            const block = fallbackChart(question, found?.items ?? [], snap?.digest);
            if (block) { text += block; this.deps.emit({ type: "token", text: block }); }
          }
          // What the answer says the player has or built, checked against their data (FC-140).
          // Spend the session's one throwback only if he actually took it (FC-182).
          if (!plain && this.throwbacks === 0 && tookAThrowback(text)) this.throwbacks++;
          // A name this save doesn't have, said with confidence (FC-171), and sums the answer did in its head (FC-153).
          // "The 6 are highlighted in-game" on a turn with no tool call (FC-229): an action it says it took.
          const toolsRun = record.rounds.flatMap((r) => r.tools ?? []);
          const corrections = [...(await this.checkClaims(text, status)), ...arithmeticCorrections(text), ...nameCorrections(text, protos), ...materialCorrections(text, protos), ...actionClaims(text, toolsRun)];
          if (corrections.length) {
            const add = `\n\n${corrections.join(" ")}`;
            text += add;
            this.deps.emit({ type: "token", text: add });
            record.corrected = corrections.length;
          }
          working.push({ role: "assistant", content: text });
          // Store the question without its bulky retrieved lines and snapshot: the next turn re-reads the
          // previous turn anyway (it sits past the last cache block), so a short version is much cheaper (S08).
          this.history.push(...working.map((m, i) => (i === 0 && m.role === "user" ? { ...m, content: compactUserContent(m.content) } : m)));
          const full = [...earlier, text].filter((t) => t.trim()).join("\n\n");
          this.shown.push({ kind: "agent", text: full });
          this.deps.log?.(`Answer (${result.usage?.completion_tokens ?? "?"} tok, ${Math.round(performance.now() - started)} ms): ${full.replace(/\s*\n+\s*/g, " | ")}`);
          record.visibleTtftMs = ttftMs;
          record.totalMs = performance.now() - started;
          // Which path answered this turn's judgement calls, so a session says plainly whether Jev was up, how
          // often it declined, and what it was asked (FC-244).
          const counts = this.deps.decisions?.counts;
          if (counts) {
            const jev = counts.jev - decisionsBefore.jev;
            const local = counts.local - decisionsBefore.local;
            if (jev || local) record.decisions = { jev, local };
          }
          this.logTurn(record);
          await this.compactIfNeeded();
          this.saveSession();
          this.deps.emit({
            type: "done", ttftMs, totalMs: performance.now() - started,
            promptTokens: result.usage?.prompt_tokens, cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens, completionTokens: result.usage?.completion_tokens,
          });
          return;
        }
        if (result.text.trim()) earlier.push(chart ? result.text : stripChartBlocks(result.text));
        working.push({ role: "assistant", content: result.text, tool_calls: calls });
        for (const call of calls) working.push({ role: "tool", tool_call_id: call.id, content: await this.runTool(call) });
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

  /** Corrections for counts and builds the answer got wrong; fetches the player's data only when the answer makes such a claim. */
  /** Items the last exchange was about: named in the last question, else the first ones the last answer named. */
  private referredItems(): string[] {
    const retriever = this.deps.retriever();
    if (!retriever) return [];
    const lastQuestion = compactUserContent(this.history.findLast((m) => m.role === "user")?.content ?? "");
    const lastAnswer = this.history.findLast((m) => m.role === "assistant" && m.content)?.content ?? "";
    const asked = lastQuestion ? retriever.retrieve(lastQuestion).items : [];
    return (asked.length ? asked : lastAnswer ? retriever.retrieve(lastAnswer).items : []).slice(0, 2);
  }

  private async checkClaims(text: string, status: ActionData<"player_status"> | null): Promise<string[]> {
    if (!/\b(you|your inventory|inventory:)\b/i.test(text) || !/\d|\b(built|placed)\b/.test(text)) return [];
    const protos = this.deps.prototypes();
    const known = new Set([...Object.keys(protos?.items ?? {}), ...(status?.items.map((i) => i.name) ?? [])]);
    const quick = status ?? { character: true, surface: "", x: 0, y: 0, items: [], total_items: 0, craftable: [], more_craftable: false, crafting_queue: [], recent_builds: [] };
    // Without this turn's data, fetch it only if the answer would need correcting against an empty inventory.
    const inventoryTurn = Boolean(status);
    if (!status && !claimCorrections(text, quick, known, { inventoryTurn }).length) return [];
    const data = status ?? (await this.lookup("player_status"));
    if (!data?.character) return [];
    for (const i of data.items) known.add(i.name);
    for (const b of data.recent_builds) known.add(b.name);
    return claimCorrections(text, data, known, { inventoryTurn });
  }

  /** A look the player could make themselves; null when the game can't answer (not connected, older mod). */
  /**
   * "Send my spidertron to the copper patch": resolve the spot from the player's own words, then put up a card.
   * Character control, so it never runs without a confirm, and the stop key cancels it (FC-051, FC-144).
   */
  private async proposeSpidertron(spiders: ActionData<"spidertrons"> | null, question: string): Promise<string | null> {
    if (!spiders) return "the game couldn't say what spidertrons the player has, so nothing was proposed";
    if (!spiders.spidertrons.length) return `no spidertron of the player's is on ${spiders.surface}, so there's nothing to send`;
    if (!spiders.has_remote) return "the player carries no spidertron remote, so sending one isn't something they could do: say so instead of offering";
    const spider = spiders.spidertrons.find((s) => !s.driver) ?? spiders.spidertrons[0]!;
    if (spider.driver) return `someone is driving the ${spider.name}, so it can't be sent`;
    const spot = await this.spidertronTarget(question);
    if (!spot) return "the spot to send it to wasn't clear from the question: ask the player where to send it (a thing to walk to, or \"to me\")";
    const away = Math.round(Math.hypot(spot.x - spider.x, spot.y - spider.y));
    return this.card(`Send the ${spider.name} to ${spot.label} at (${Math.floor(spot.x)}, ${Math.floor(spot.y)})?`,
      `${away} tiles away on ${spiders.surface}. It walks there with its own autopilot; Alt+X, "stop", driving it or using your own remote cancels it.`,
      async () => {
        const r = await this.deps.game.call("send_spidertron", { x: spot.x, y: spot.y, unit_number: spider.unit_number });
        const message = `The ${r.name} is walking to (${r.x}, ${r.y}), ${r.distance} tiles away. Alt+X or "stop" takes it back.`;
        this.deps.emit({ type: "tool", summary: message });
        return message;
      });
  }

  /** Where the player means: a thing named in the question, or themselves. */
  private async spidertronTarget(question: string): Promise<{ x: number; y: number; label: string } | null> {
    const digest = this.deps.game.latest()?.digest;
    const player = digest?.player;
    if (/\b(to|over) (me|my (position|spot|place)|here)\b|\bhere\b/i.test(question) && player) {
      const at = player.character_position ?? player.position;
      return { x: at.x, y: at.y, label: "the player" };
    }
    const coordinates = /\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?/.exec(question.replace(/\b(spidertron|spider)\b/gi, ""));
    if (coordinates) return { x: Number(coordinates[1]), y: Number(coordinates[2]), label: "that spot" };
    // Only the destination names the target: "send the spidertron to the ore patch" resolved "spidertron" as the
    // entity and sent it to itself, zero tiles, card and all (FC-225, the player's session 2026-09-18).
    const stripped = question.replace(/\b(spidertron|spider)\b/gi, " ");
    const destination = /\b(?:to|towards?|toward|over to|up to|down to|at)\s+(.+)$/i.exec(stripped)?.[1] ?? stripped;
    const filter = resolveEntityFilterInText(destination, this.deps.prototypes());
    if (!filter) return null;
    try {
      const r = await this.deps.game.call("find_entities", { types: filter.types, names: filter.names, direction: "around", radius: 128, from: "character" });
      if (!r.entities.length) return null;
      const c = r.center;
      const nearest = r.entities.reduce((best, e) => (Math.hypot(e.x - c.x, e.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? e : best));
      return { x: nearest.x, y: nearest.y, label: `the nearest ${nearest.name}` };
    } catch {
      return null;
    }
  }

  /** Takes back whatever the companion set moving, the same as the stop key. */
  private async stopControl(): Promise<string | null> {
    try {
      const r = await this.deps.game.call("stop_control");
      return r.stopped ? `stopped the ${r.entity ?? r.control ?? "order"} in the game, as asked` : "nothing the companion started was moving, so there was nothing to stop";
    } catch {
      return null;
    }
  }

  /**
   * Keeps a packing list honest (FC-166, FC-167): adds what the save's data proves the build also needs, ticks
   * items off against what the player can reach, and answers "am I ready?" with the load's slot count.
   */
  /**
   * "Get the bots to bring the rest": the shortfall goes in the companion's own section of the player's requests,
   * behind a card, so their own requests are untouched and the section can simply be switched off (FC-168).
   */
  private async proposeRequests(list: Checklist, network: ActionData<"logistic_network"> | null): Promise<string> {
    if (!network?.in_range) return "the player isn't in range of their logistic network, so there's nothing to request: say so";
    const protos = this.deps.prototypes();
    const stock = await this.lookup("stock", { radius: 48 });
    const needs = list.items.map((i) => parseNeed(i.text, protos)).filter((n): n is Need => n !== null);
    const states = check(needs, stock, []);
    const short = states.filter((s) => s.missing > 0);
    if (!short.length) return "nothing on the list is missing, so there's nothing for the bots to bring";
    const items = short.map((s) => ({ name: s.need.item, count: s.need.count }));
    const canBring = short.filter((s) => (network.items.find((i) => i.name === s.need.item)?.count ?? 0) > 0);
    const detail = `Its own request section, so your own requests stay as they are. ${canBring.length} of ${short.length} are in the network now; switching the section off (or "stop requesting") ends the deliveries.`;
    return this.card(`Ask the bots for ${short.map((s) => `${s.need.count} ${s.need.item}`).join(", ")}?`, detail, async () => {
      const r = await this.deps.game.call("set_requests", { items });
      const short2 = r.short.length ? `; the network can't cover ${r.short.map((x) => `${x.name} (${x.reason})`).join(", ")}` : "";
      const message = `Requested ${r.set.map((x) => `${x.count} ${x.name}`).join(", ")} in the "${r.group}" section of your requests (${r.robots} robots free)${short2}.`;
      this.deps.emit({ type: "tool", summary: message });
      return message;
    });
  }

  /** Switches the companion's request section off, or removes it when the list itself is gone (FC-168). */
  private async clearRequests(remove: boolean): Promise<string | null> {
    try {
      const r = await this.deps.game.call("clear_requests", remove ? { remove: true } : {});
      if (!r.found) return "the companion had no request section, so there was nothing to stop";
      return remove ? "removed the companion's request section from the player's requests" : `switched the companion's request section off, leaving its ${r.slots ?? 0} slots in place to switch on again`;
    } catch {
      return null;
    }
  }

  /** The same check, run from the list tool: it fetches the stock itself. */
  private async checkPackingNow(list: Checklist): Promise<string[]> {
    const stock = await this.lookup("stock", { radius: 48 });
    return stock ? this.checkPacking(list, stock, null, false) : [];
  }

  private checkPacking(list: Checklist, stock: ActionData<"stock">, status: ActionData<"player_status"> | null, asked: boolean): string[] {
    const protos = this.deps.prototypes();
    const parsed = list.items.map((i) => ({ item: i, need: parseNeed(i.text, protos) }));
    const needs = parsed.map((p) => p.need).filter((n): n is Need => n !== null);
    const lines: string[] = [];
    // Words that name nothing in this save can never be ticked, so they don't count towards the total (FC-246).
    // Without this the list stops at "3 of 11" for ever and the player is never told why.
    const untracked = parsed.filter((p) => !p.need).map((p) => p.item.text);
    for (const text of untracked) this.lists.update(list.name, text, { untracked: true });
    for (const p of parsed) if (p.need && p.item.untracked) this.lists.update(list.name, p.item.text, { untracked: false });
    if (untracked.length) lines.push(`not counted, because nothing in this save is called that: ${untracked.join(", ")} — ask the player which item they meant`);
    // What the data says is missing goes on the list once, with its reason as the note.
    const additions = essentials(needs, protos, stock).filter((a) => a.text);
    const added = this.lists.addFromRule(list.name, additions.map((a) => ({ text: a.text, note: a.reason })));
    if (added.length) lines.push(`added to the list from the save's data: ${additions.filter((a) => added.includes(a.text)).map((a) => `${a.text} (${a.reason})`).join("; ")}`);
    // Tick off what they already have, and note the rest, so the panel and the answer agree.
    const states = check(needs, stock, status?.craftable ?? []);
    const ticked: string[] = [];
    for (const state of states) {
      const done = state.missing === 0;
      const note = done
        ? `have ${state.have}${state.carried < state.have ? ` (${state.carried} carried)` : ""}`
        : `${state.have} of ${state.need.count} in reach`;
      if (this.lists.update(list.name, state.need.text, { done, note }) && done) ticked.push(state.need.item);
    }
    if (ticked.length) lines.push(`ticked off now that the player has them: ${ticked.join(", ")}`);
    if (added.length || ticked.length) this.showLists();
    // Everything in reach: the deliveries have done their job, so the section goes quiet but stays (FC-168).
    if (states.length && states.every((s) => s.missing === 0) && ticked.length) {
      void this.clearRequests(false);
      lines.push("the list is complete, so the companion's request section was switched off (it stays, to switch on again)");
    }
    if (asked) lines.push(...readiness(states, slots(needs, protos, stock.free_slots)));
    return lines;
  }

  /** Measured output of the machines the player just searched for, else the ones around them. */
  private async measuredOutput(): Promise<string | null> {
    const last = this.lastResult && this.now() - this.lastResult.at <= RESULT_TTL_MS ? this.lastResult : null;
    const entities = last?.refs.length ? last.refs.slice(0, 500) : undefined;
    try {
      const r = await this.deps.game.call("machine_output", entities ? { entities } : { radius: 32 });
      return formatMachineOutput(r, entities ? `the ${last!.label} from the last search` : "32 tiles around the player");
    } catch {
      return null; // an older mod or no game: the rest of the turn still answers
    }
  }

  private async contentsOf(target: { name: string; x: number; y: number }): Promise<string> {
    try {
      return formatContents(await this.deps.game.call("container_contents", { name: target.name, x: target.x, y: target.y }));
    } catch (e) {
      return `couldn't look inside the ${target.name} at (${Math.floor(target.x)}, ${Math.floor(target.y)}): ${(e as Error).message}`;
    }
  }

  private async lookup<A extends "player_status" | "surroundings" | "pointed_at" | "spidertrons" | "stock" | "logistic_network">(action: A, args?: ActionArgs<A>): Promise<ActionData<A> | null> {
    try {
      return await this.deps.game.call(action, args);
    } catch {
      return null;
    }
  }

  private async researchOptions(): Promise<string[]> {
    try {
      const r = await this.deps.game.call("research_options");
      const packs = (p: string[]) => p.map((n) => n.replace(/-science-pack$/, "")).join("+");
      const lines = [r.options.length
        ? `researchable now (${r.available}, cheapest first): ${r.options.map((o) => `${o.name} ${o.count}×${packs(o.packs)}`).join(", ")}${r.queue.length ? ` | queue: ${r.queue.join(", ")}` : " | queue: empty"}`
        : `researchable now: nothing (${r.available} available)`];
      // Early technologies unlock by doing something, not in labs (S22).
      if (r.triggers?.length) lines.push(`unlocked by doing, no labs needed: ${r.triggers.map((t) => `${t.name} (${t.trigger})`).join(", ")}`);
      return lines;
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
        case "set_train_stop":
          return this.proposeTrainStop(args);
        case "update_list": {
          // The player's words become this save's names before the list exists (FC-246), so the packing check can
          // match them against what they carry. Lexical first, Jev only for what that misses.
          const protos = this.deps.prototypes();
          const adds = Array.isArray(args.add) ? args.add.map(String) : [];
          const sets = Array.isArray(args.set) ? args.set.map(String) : [];
          const resolved = await resolveListItems([...adds, ...sets], protos, this.deps.decisions);
          const renamed = renamedNote(resolved);
          const listText = (text: string) => resolved.find((r) => r.text === text)?.listText ?? text;
          const message = this.lists.apply({
            ...(typeof args.list === "string" ? { list: args.list } : {}),
            // A build the player is about to go and make is a packing list whether or not the model says so: it
            // forgot the kind and the list then never ticked itself off (FC-166).
            ...(args.kind === "packing" || args.kind === "plain" ? { kind: args.kind } : wantsPackingList(this.currentQuestion) ? { kind: "packing" as const } : {}),
            ...(adds.length ? { add: adds.map(listText) } : {}),
            ...(sets.length ? { set: sets.map(listText) } : {}),
            ...(Array.isArray(args.done) ? { done: args.done.map(String) } : {}),
            ...(Array.isArray(args.undone) ? { undone: args.undone.map(String) } : {}),
            ...(Array.isArray(args.remove) ? { remove: args.remove.map(String) } : {}),
            ...(typeof args.rename === "string" ? { rename: args.rename } : {}),
            ...(args.clear === true ? { clear: true } : {}),
          });
          // A packing list is checked straight away, so the same answer can say what the data added and what the
          // player already has — waiting for the next turn made the first answer miss both (FC-166).
          const list = this.lists.active();
          // The list is gone or empty: take the companion's request section out with it (FC-168).
          if (args.clear === true || !list) void this.clearRequests(true);
          const extra = list?.kind === "packing" ? await this.checkPackingNow(list) : [];
          this.showLists();
          const full = [message, ...(renamed ? [renamed] : []), ...extra].join(" ");
          this.deps.emit({ type: "tool", summary: full });
          return full;
        }
        case "show_the_way":
          return await this.showTheWay(String(args.what ?? ""), args.at === "last_result");
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
    const from = anchorFor(this.currentQuestion, "search");
    const r: FindEntitiesResult = await this.deps.game.call("find_entities", { types: filter.types, names: filter.names, direction, radius, from });
    const compass = { right: "east", left: "west", up: "north", down: "south", around: "all directions" }[direction];
    const note = anchorSpot(this.deps.game.latest()?.digest, from)?.note ?? "";
    const where = `within ${radius} tiles ${direction === "around" ? "around" : `to the ${direction} (${compass}) of`} the player on ${r.surface}${note}`;
    this.lastResult = { refs: r.entities, label: what, count: r.count, at: this.now(), where };
    if (r.count > 0) await this.deps.game.call("highlight", { entities: r.entities, seconds: HIGHLIGHT_SECONDS });
    const kinds = Object.entries(r.by_name).map(([n, c]) => `${n} ${c}`).join(", ");
    const c = r.center;
    const nearest = r.entities.length ? r.entities.reduce((best, e) => (Math.hypot(e.x - c.x, e.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? e : best)) : null;
    // Measured like the surroundings line, so both give the same direction and position (FC-157).
    const nearestNote = nearest ? ` Nearest: ${nearest.name} ${bearing(c, nearest)} at (${Math.floor(nearest.x)}, ${Math.floor(nearest.y)}).` : "";
    const summary = `Found ${r.count} ${what} ${where}${kinds ? ` (${kinds})` : ""}.${nearestNote}`;
    this.deps.emit({ type: "tool", summary: `${summary}${r.count ? ` Highlighted in-game for ${HIGHLIGHT_SECONDS} s (not marked on the map).` : ""}` });
    return [
      summary,
      r.truncated ? `Only the first ${r.entities.length} are remembered.` : "",
      r.count ? `They are highlighted in-game for ${HIGHLIGHT_SECONDS} s and remembered as the last result.` : "",
      // After "0 found" an answer still placed "the big patch 82 tiles south-west" (FC-139).
      r.count ? "" : "None are there, so don't say where one is; only lines that list it can place it.",
    ].filter(Boolean).join(" ");
  }

  /** FC-143: an arrow toward the nearest thing the player can see. A look they asked for, so it runs now. */
  private async showTheWay(what: string, atLast: boolean): Promise<string> {
    let refs: EntityRef[] = [];
    let center: { x: number; y: number } | null = null;
    let label = what;
    const last = this.lastResult;
    if (atLast && last && this.now() - last.at <= RESULT_TTL_MS) {
      refs = last.refs;
      label = last.label;
      const p = this.deps.game.latest()?.digest.player;
      center = p ? (p.character_position ?? p.position) : null;
    } else {
      const filter = resolveEntityFilterInText(this.currentQuestion, this.deps.prototypes()) ?? resolveEntityFilter(what, this.deps.prototypes());
      if (!filter) return `I don't know what "${what}" refers to in this save, so nothing was pointed at.`;
      const r = await this.deps.game.call("find_entities", { types: filter.types, names: filter.names, direction: "around", radius: 128, from: "character" });
      refs = r.entities;
      center = r.center;
    }
    if (!refs.length || !center) return `No ${label} within 128 tiles where the player can see, so nothing was pointed at. Say so; don't guess a direction.`;
    const c = center;
    const nearest = refs.reduce((best, e) => (Math.hypot(e.x - c.x, e.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? e : best));
    try {
      const r = await this.deps.game.call("point_to", { x: nearest.x, y: nearest.y, label: nearest.name, seconds: 30 });
      const message = `Pointing to the nearest ${nearest.name}: ${bearing(c, nearest)} at (${Math.floor(r.x)}, ${Math.floor(r.y)}). An arrow at the player's character faces it and it's circled on their map for ${r.seconds} s.`;
      this.deps.emit({ type: "tool", summary: message });
      return message;
    } catch (e) {
      return `Couldn't point to it: ${(e as Error).message}`;
    }
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
      parts.push(`${r.count} ${c.recipe} machines not working on ${c.surface}${statuses ? ` (${statuses})` : ""}${r.not_visible ? `, and ${r.not_visible} more elsewhere in their own factory, out of view (not highlighted)` : ""}${r.same_surface ? "" : " (not highlighted: the player is on another surface)"}`);
      if (r.same_surface) refs = [...refs, ...r.entities];
    }
    if (refs.length) {
      await this.deps.game.call("highlight", { entities: refs.slice(0, 1000), seconds: HIGHLIGHT_SECONDS });
      this.lastResult = { refs, label: `stuck ${what}`, count: refs.length, at: this.now(), where: `on ${here}` };
    }
    const summary = `${parts.join("; ")}.${refs.length ? ` Highlighted in-game for ${HIGHLIGHT_SECONDS} s (not marked on the map).` : ""}`;
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
    const from = anchorFor(this.currentQuestion, "place");
    const r = await this.deps.game.call("screenshot", { ...(spot ?? { from }), size: 1024, zoom: 0.5 });
    const name = await waitForShot(dir, r.path);
    pruneShots(join(dir, "companion"));
    const where = `${Math.round(r.tiles)} tiles across around (${Math.round(r.x)}, ${Math.round(r.y)}) on ${r.surface}`;
    this.deps.emit({ type: "image", url: `/shots/${name}`, caption: `${spot ? this.lastResult!.label : from === "character" ? "Your character" : "Your view"}: ${where}` });
    return `A screenshot is now shown to the player: ${where}. You can't see it; don't describe its contents.`;
  }

  private proposeRecipe(what: string): string {
    const last = this.lastResult;
    if (!last || this.now() - last.at > RESULT_TTL_MS) return "Error: there is no recent search result to act on. Use find_entities first.";
    if (last.refs.length === 0) return `Error: the last search found no ${last.label}, so there's nothing to act on.`;
    const recipe = this.resolveRecipe(what);
    if (!recipe) return `Error: no recipe matching "${what}" in this save. Nothing was changed.`;
    const entities = last.refs;
    return this.card(`Set ${entities.length} ${last.label} to make ${recipe}?`, `The ${last.label} found ${last.where}, highlighted in-game. Leftover ingredients go to your inventory for machines within your reach; the rest spill next to their machine, marked for your robots to collect.`, async () => {
      const r = await this.deps.game.call("set_recipe", { entities, recipe });
      const refused = Object.entries(r.rejected).map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`).join(", ");
      const parts = [r.to_inventory ? `${r.to_inventory} leftover ingredients to your inventory` : "", r.spilled ? `${r.spilled} spilled next to the machines for your robots to collect` : ""].filter(Boolean);
      const items = parts.length ? `; ${parts.join(", ")}` : "";
      return `Set ${plural(r.done, "machine")} to ${recipe}${items}${refused ? `; refused: ${refused}` : ""}.`;
    });
  }

  /** FC-109: train stop settings on the last search, through a card like a recipe change. */
  private proposeTrainStop(args: Record<string, unknown>): string {
    const last = this.lastResult;
    if (!last || this.now() - last.at > RESULT_TTL_MS) return "Error: there is no recent search result to act on. Use find_entities first.";
    const entities = last.refs.filter((r) => r.name.includes("train-stop") || r.name.includes("station"));
    if (entities.length === 0) return `Error: the last search found no train stops, so there's nothing to set. Search for train stops first.`;
    const limit = args.limit === undefined || args.limit === null ? undefined : Math.round(Number(args.limit));
    const priority = args.priority === undefined || args.priority === null ? undefined : Math.round(Number(args.priority));
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 200) : undefined;
    if (limit === undefined && priority === undefined && name === undefined) return "Error: say what to set: a train limit, a priority or a name.";
    if (limit !== undefined && (!Number.isFinite(limit) || limit < -1)) return "Error: the train limit is a whole number, or -1 for no limit.";
    if (priority !== undefined && (!Number.isFinite(priority) || priority < 0 || priority > 255)) return "Error: priority is a whole number from 0 to 255.";
    const what = [limit !== undefined ? (limit < 0 ? "no train limit" : `train limit ${limit}`) : "", priority !== undefined ? `priority ${priority}` : "", name ? `name "${name}"` : ""].filter(Boolean).join(", ");
    return this.card(`Set ${plural(entities.length, "train stop")}: ${what}?`, `The train stops found ${last.where}, highlighted in-game. Stops whose limit or priority a circuit signal sets are left alone.`, async () => {
      const r = await this.deps.game.call("set_train_stop", { entities, ...(limit !== undefined ? { limit } : {}), ...(priority !== undefined ? { priority } : {}), ...(name ? { name } : {}) });
      const refused = Object.entries(r.rejected).map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`).join(", ");
      return `Set ${plural(r.done, "train stop")} (${what})${refused ? `; refused: ${refused}` : ""}.`;
    });
  }

  /** Small requests run right away only when the player's own words asked for them; otherwise they need a card. */
  private asked(pattern: RegExp): boolean {
    return pattern.test(this.currentIntent);
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
    if (!this.asked(ASKS_FOR.queue_research!)) return this.card(`Queue research: ${candidates[0]}?`, "Adds it to the research queue.", run);
    const message = await run();
    this.deps.emit({ type: "tool", summary: message });
    return message;
  }

  private async mapAction(args: Record<string, unknown>): Promise<string> {
    const kind = args.kind === "camera" ? "camera" : "tag";
    const digest = this.deps.game.latest()?.digest;
    const atLast = args.at === "last_result" && this.lastResult?.refs[0];
    const here = anchorSpot(digest, anchorFor(this.currentQuestion, "place"));
    const spot = atLast ? { x: this.lastResult!.refs[0]!.x, y: this.lastResult!.refs[0]!.y } : here ? { x: here.x, y: here.y, ...(here.surface ? { surface: here.surface } : {}) } : null;
    if (!spot) return "Error: the player's position isn't known yet.";
    const run = async (): Promise<string> => {
      if (kind === "camera") {
        const r = await this.deps.game.call("camera_to", spot);
        return `Camera moved to (${r.x}, ${r.y}) on ${r.surface}. Press Esc in-game to return.${atLast ? "" : here?.note ?? ""}`;
      }
      const r = await this.deps.game.call("add_map_tag", { ...spot, text: String(args.text ?? "companion") });
      return `Map tag "${r.text}" added at (${r.x}, ${r.y}).${atLast ? "" : here?.note ?? ""}`;
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
    const digest = this.deps.game.latest()?.digest;
    const from = anchorFor(this.currentQuestion, "place");
    const position = anchorSpot(digest, from);
    if (!position) return "Error: the player's position isn't known yet.";
    // A paste lands on the surface the player is looking at, like pasting by hand.
    if (from === "character" && position.surface !== digest?.player?.surface) return `Error: the player's character is on ${position.surface} but they're viewing ${digest?.player?.surface}; a paste can only go where they're looking. Ask them to go back to their character or say "paste it here".`;
    // Name the spot the way the player sees it: in map view, "here" is the map view, not where they stand (FC-129).
    const where = from === "character" ? "your character" : digest?.player?.remote_view ? "the map view" : "your position";
    return this.card(`Paste the blueprint at ${where} (${position.x}, ${position.y})?`, `Placed as ghosts, like pasting it yourself; construction robots build it and Ctrl+Z undoes it.${position.note}`, async () => {
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
    if (!p) {
      this.deps.emit({ type: "approval_result", id, status: "expired", message: "This request is no longer pending." });
      return;
    }
    this.pending.delete(id);
    this.notes.push(`player declined "${p.title}"; nothing was changed`);
    this.deps.emit({ type: "approval_result", id, status: "declined", message: "Cancelled. Nothing was changed." });
  }
}
