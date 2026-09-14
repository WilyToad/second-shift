import { expect, test } from "bun:test";
import type { ActionName } from "@companion/interfaces";
import { DigestSchema, PrototypesSchema } from "@companion/interfaces";
import { encodeBlueprintString } from "./blueprint";
import { Agent, compactHistory, fallbackChart, needsWorldTools, wantsChart, type GameActions } from "./agent";
import type { ServerMessage } from "./messages";
import type { ChatMessage, ChatModel, StreamOptions, StreamResult } from "./model";

/** Scripted model: each call pops the next response (text or tool calls). */
function fakeModel(script: ({ text: string } | { tool: string; args?: object })[]): ChatModel & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async stream(messages: ChatMessage[], opts?: StreamOptions): Promise<StreamResult> {
      seen.push(messages);
      const next = script.shift() ?? { text: "done" };
      if ("tool" in next) return { text: "", toolCalls: [{ id: `c${seen.length}`, type: "function", function: { name: next.tool, arguments: JSON.stringify(next.args ?? {}) } }], totalMs: 1 };
      opts?.onToken?.(next.text);
      return { text: next.text, toolCalls: [], totalMs: 1 };
    },
  };
}

function fakeGame(entities = [{ name: "straight-rail", x: 13, y: -7 }, { name: "straight-rail", x: 15, y: -7 }]) {
  const calls: { action: ActionName; args: any }[] = [];
  const game: GameActions = {
    latest: () => undefined,
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "find_entities") return { surface: "gleba", center: { x: 9, y: 0 }, direction: args.direction, radius: args.radius, area: { left_top: { x: 9, y: -32 }, right_bottom: { x: 41, y: 32 } }, count: entities.length, by_name: { "straight-rail": entities.length }, not_visible: 0, entities, truncated: false };
      if (action === "highlight") return { drawn: args.entities.length, seconds: args.seconds };
      if (action === "mark_deconstruction") return { done: args.entities.length, rejected: {}, undo_items: 100 };
      throw new Error(`unexpected ${action}`);
    },
  };
  return { game, calls };
}

function setup(script: Parameters<typeof fakeModel>[0], game = fakeGame()) {
  const events: ServerMessage[] = [];
  const model = fakeModel(script);
  const agent = new Agent({ model, game: game.game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m) });
  return { agent, events, model, calls: game.calls };
}

test("find runs immediately, highlights, and the result is summarized for the model", async () => {
  const { agent, events, model, calls } = setup([{ tool: "find_entities", args: { what: "rails", direction: "right" } }, { text: "2 rails to your right." }]);
  await agent.ask("how many rails are near me on the right?");
  expect(calls.map((c) => c.action)).toEqual(["find_entities", "highlight"]);
  expect(calls[0]!.args.types).toContain("straight-rail");
  const toolMsg = model.seen[1]!.at(-1)!;
  expect(toolMsg.role).toBe("tool");
  expect(toolMsg.content).toContain("Found 2 rails within 32 tiles to the right (east) of the player on gleba");
  expect(events.some((e) => e.type === "done")).toBe(true);
});

test("marking asks for approval and sends nothing to the game until confirmed", async () => {
  const { agent, events, calls } = setup([
    { tool: "find_entities", args: { what: "rails", direction: "right" } }, { text: "2 rails." },
    { tool: "mark_deconstruction" }, { text: "Please confirm in the app." },
  ]);
  await agent.ask("how many rails to my right?");
  await agent.ask("mark them for deconstruction");
  const card = events.find((e) => e.type === "approval") as Extract<ServerMessage, { type: "approval" }>;
  expect(card.title).toBe("Mark 2 rails for deconstruction?");
  expect(calls.some((c) => c.action === "mark_deconstruction")).toBe(false);

  await agent.approve(card.id);
  const mark = calls.find((c) => c.action === "mark_deconstruction")!;
  expect(mark.args.entities).toEqual([{ name: "straight-rail", x: 13, y: -7 }, { name: "straight-rail", x: 15, y: -7 }]);
  expect(events.at(-1)).toMatchObject({ type: "approval_result", status: "done", message: "Marked 2 entities." });
});

test("declining changes nothing and the outcome reaches the model on the next turn", async () => {
  const { agent, events, model, calls } = setup([
    { tool: "find_entities", args: { what: "rails" } }, { tool: "mark_deconstruction" }, { text: "Confirm in the app." }, { text: "ok" },
  ]);
  await agent.ask("mark the rails around me for deconstruction");
  const card = events.find((e) => e.type === "approval") as Extract<ServerMessage, { type: "approval" }>;
  agent.decline(card.id);
  await agent.ask("did it work?");
  expect(calls.some((c) => c.action === "mark_deconstruction")).toBe(false);
  expect(model.seen.at(-1)!.at(-1)!.content).toStartWith('[since your last reply: player declined "Mark 2 rails for deconstruction?"; nothing was changed]');
  await agent.approve(card.id); // stale card
  expect(events.at(-1)).toMatchObject({ type: "approval_result", status: "expired" });
});

test("acting without a search, or with an unknown tool, is refused without touching the game", async () => {
  const { agent, model, calls } = setup([{ tool: "mark_deconstruction" }, { tool: "destroy_entities" }, { text: "I can't." }]);
  await agent.ask("delete all the rails instantly");
  expect(calls).toEqual([]);
  const tools = model.seen.at(-1)!.filter((m) => m.role === "tool").map((m) => m.content);
  expect(tools[0]).toContain("no recent search result");
  expect(tools[1]).toContain("there is no tool named destroy_entities");
});

test("world questions are told apart from recipe questions", () => {
  for (const q of ["How many rails are near me on the right?", "Mark them for deconstruction", "find inserters around me", "delete all the rails instantly"]) expect(needsWorldTools(q, true)).toBe(true);
  for (const q of ["What's the recipe for carbon fiber?", "How many copper cables does a green circuit take?", "What do I need before I can research agricultural science?", "How do I craft a quantum widget?"]) expect(needsWorldTools(q, false)).toBe(false);
});

test("trend questions ask for charts; recipe and research questions don't", () => {
  for (const q of ["How is my science doing? Show me a chart.", "Is my iron plate production holding steady?", "has bioflux dropped?"]) expect(wantsChart(q)).toBe(true);
  for (const q of ["What do I need before I can research agricultural science?", "What's the recipe for carbon fiber?"]) expect(wantsChart(q)).toBe(false);
});

test("fallback chart picks the asked-about item on the named surface", () => {
  const digest = DigestSchema.parse({
    tick: 1, player: { name: "p", surface: "gleba", position: { x: 0, y: 0 } }, research: { progress: 0, queue: {} }, alerts: {},
    surfaces: [
      { name: "nauvis", produced: [{ name: "iron-plate", per_minute: 50 }], consumed: {}, science: {}, age_ticks: 0 },
      { name: "nauvis-factory-floor", produced: [{ name: "iron-plate", per_minute: 700 }], consumed: {}, science: {}, age_ticks: 0 },
    ],
  });
  expect(fallbackChart("Is my iron plate production on the factory floor holding steady?", ["iron-plate"], digest)).toContain("item=iron-plate surface=nauvis-factory-floor");
  expect(fallbackChart("is iron plate holding steady?", ["iron-plate"], digest)).toContain("surface=nauvis-factory-floor"); // busiest when not named and not on player's surface
  expect(fallbackChart("is bioflux steady?", ["bioflux"], digest)).toBeNull();
});

test("compaction strips stale data from older turns, keeps recent turns intact, and notes it once", () => {
  const turn = (i: number): ChatMessage[] => [
    { role: "user", content: `question ${i}\n\n[recipes and technologies from this save]\n${"recipe line\n".repeat(200)}\n\n[game state at tick ${i}]\n${"state\n".repeat(100)}` },
    { role: "assistant", content: `answer ${i}` },
  ];
  const history = Array.from({ length: 12 }, (_, i) => turn(i)).flat();
  const result = compactHistory(history, 2000, 2)!;
  expect(result.afterTokens).toBeLessThan(result.beforeTokens / 3);
  expect(result.history[0]!.content).toStartWith("[earlier turns compacted");
  expect(result.history[2]).toEqual({ role: "user", content: "question 0" });
  expect(result.history.at(-4)).toEqual(history.at(-4)); // second-to-last turn untouched
  expect(result.history.at(-2)).toEqual(history.at(-2));
  expect(compactHistory(result.history, 2000, 2)).toBeNull(); // nothing more to do right after
});

test("a pasted blueprint reaches the model only as a checked summary", async () => {
  const prototypes = PrototypesSchema.parse({
    recipes: { bioflux: { category: "organic", energy: 6, enabled: true, maximum_productivity: 3, ingredients: [], products: [] } },
    items: {}, fluids: {}, technologies: {},
    machines: { "assembling-machine-3": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting"] } },
    entities: { "assembling-machine-3": { type: "assembling-machine", size: [3, 3], collision: [-1.2, -1.2, 1.2, 1.2] } },
  });
  const raw = encodeBlueprintString({ blueprint: { item: "blueprint", label: "smelter", entities: [
    { entity_number: 1, name: "assembling-machine-3", position: { x: 1.5, y: 1.5 }, recipe: "bioflux" },
    { entity_number: 2, name: "quantum-widget", position: { x: 9, y: 9 } },
  ] } });
  const events: ServerMessage[] = [];
  const model = fakeModel([{ text: "It has problems." }]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => prototypes, emit: (m) => events.push(m) });
  await agent.ask(`Review this blueprint: ${raw}`);
  const prompt = model.seen[0]!.at(-1)!.content;
  expect(prompt).not.toContain(raw);
  expect(prompt).toStartWith("Review this blueprint: [pasted blueprint 1]");
  expect(prompt).toContain("smelter: 3×3 tiles, 2 entities");
  expect(prompt).toContain("1× quantum-widget doesn't exist in this save");
  expect(prompt).toContain("assembling-machine-3 can't craft bioflux (category organic)");
  expect(events.find((e) => e.type === "user")).toEqual({ type: "user", text: "Review this blueprint: [blueprint 1]" });
  expect(agent.history.some((m) => m.content.includes(raw))).toBe(false);
});
