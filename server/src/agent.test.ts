import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionName } from "@companion/interfaces";
import { DigestSchema, PrototypesSchema } from "@companion/interfaces";
import { encodeBlueprintString } from "./blueprint";
import { RecipeRetriever } from "./retrieval";
import { Agent, anchorFor, anchorSpot, compactHistory, fallbackChart, needsWorldTools, parseTarget, targetRate, wantsBlueprint, wantsChart, type GameActions, type SessionData, type SessionStore } from "./agent";
import { rowPrototypes } from "./fixtures/row-prototypes";
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

test("a science question with no item named charts the busiest science pack", () => {
  const digest = DigestSchema.parse({
    tick: 1, player: { name: "p", surface: "nauvis", position: { x: 0, y: 0 } }, research: { progress: 0, queue: {} }, alerts: {},
    surfaces: [{ name: "nauvis", produced: {}, consumed: {}, science: [
      { name: "automation-science-pack", per_minute: 2, per_minute_10h: 15.6 },
      { name: "chemical-science-pack", per_minute: 0, per_minute_10h: 16.5 },
    ], age_ticks: 0 }],
  });
  expect(fallbackChart("How is my science doing? Show me a chart.", [], digest)).toContain("item=chemical-science-pack surface=nauvis");
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
  // The page gets a sketch with the original string to copy back (FC-044).
  const card = events.find((e) => e.type === "blueprint");
  if (card?.type !== "blueprint") throw new Error("no sketch card");
  expect(card.blueprint).toMatchObject({ label: "smelter", string: raw, summary: "2 entities · pasted", width: 9.5, height: 9.5 });
  expect(card.blueprint.sketch.map((e) => [e.name, e.x, e.y, e.w])).toEqual([["assembling-machine-3", 0, 0, 3], ["quantum-widget", 8.5, 8.5, 1]]);
});

test("planning tools: explicit research runs now, unprompted becomes a card, pastes and upgrades need approval", async () => {
  const prototypes = PrototypesSchema.parse({
    recipes: { "fast-transport-belt": { category: "crafting", energy: 0.5, enabled: false, maximum_productivity: 3, ingredients: [], products: [{ type: "item", name: "fast-transport-belt", amount: 1 }] } },
    items: { "fast-transport-belt": { type: "item", stack_size: 100, place_result: "fast-transport-belt" } }, fluids: {},
    technologies: { logistics: { prerequisites: [], unlocks: ["fast-transport-belt"], count: 10, ingredients: [], seconds_per_unit: 5, researched: false } },
    machines: {}, entities: {},
  });
  const retriever = new RecipeRetriever(prototypes);
  const calls: { action: string; args: any }[] = [];
  const game: GameActions = {
    latest: () => ({ receivedAt: 0, digest: DigestSchema.parse({ tick: 1, player: { name: "p", surface: "nauvis", position: { x: 5, y: 6 } }, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {} }) }),
    async call(action: any, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "queue_research") return { queued: args.technology, queue: [args.technology] };
      if (action === "research_options") return { options: [{ name: "logistics", count: 10, packs: ["automation-science-pack"] }], available: 1, queue: [] };
      if (action === "place_blueprint") return { placed: 3, expected: 3, x: args.x, y: args.y, undo_items: 1 };
      throw new Error(`unexpected ${action}`);
    },
  };
  const events: ServerMessage[] = [];
  const model = fakeModel([
    { tool: "queue_research", args: { technology: "fast belts" } }, { text: "Queued." },
    { tool: "queue_research", args: { technology: "logistics" } }, { text: "Want me to queue it?" },
    { text: "Looks fine." },
    { tool: "place_blueprint" }, { text: "Confirm in the app." },
  ]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => retriever, prototypes: () => prototypes, emit: (m) => events.push(m) });

  await agent.ask("queue the research for fast belts");
  const acts = () => calls.filter((c) => c.action !== "research_options"); // research turns also fetch the options list
  expect(acts()).toEqual([{ action: "queue_research", args: { technology: "logistics" } }]);
  expect(model.seen[0]!.at(-1)!.content).toContain("researchable now (1, cheapest first): logistics 10×automation");

  await agent.ask("what should I work on next?"); // model suggests research unprompted
  expect(acts().length).toBe(1);
  expect((events.filter((e) => e.type === "approval").at(-1) as any).title).toBe("Queue research: logistics?");

  const raw = encodeBlueprintString({ blueprint: { item: "blueprint", entities: [{ entity_number: 1, name: "fast-transport-belt", position: { x: 0.5, y: 0.5 } }] } });
  await agent.ask(`review this ${raw}`);
  await agent.ask("paste it here");
  const card = events.filter((e) => e.type === "approval").at(-1) as any;
  expect(card.title).toBe("Paste the blueprint at your position (5, 6)?");
  expect(calls.some((c) => c.action === "place_blueprint")).toBe(false);
  await agent.approve(card.id);
  expect(calls.at(-1)).toEqual({ action: "place_blueprint", args: { blueprint: raw, x: 5, y: 6 } });
  expect(events.at(-1)).toMatchObject({ type: "approval_result", status: "done", message: "Placed 3 of 3 ghosts at (5, 6)." });
});

test("target rates are parsed per minute", () => {
  expect(targetRate("how many assemblers for 60 gears per minute?")).toBe(60);
  expect(targetRate("I want 2/s electronic circuits")).toBe(120);
  expect(targetRate("45 a minute of plastic")).toBe(45);
  expect(targetRate("what's the recipe for plastic?")).toBeNull();
});

test("the planned item is the one next to the number, not the machine being counted", () => {
  expect(parseTarget("How many biochambers for 60 bioflux per minute?")).toEqual({ perMinute: 60, phrase: "bioflux" });
  expect(parseTarget("How many chemical plants for 120 plastic bars per minute?")).toEqual({ perMinute: 120, phrase: "plastic bars" });
});

test("a blueprint request is built in code: the page gets a card, the model gets a summary, and it can be pasted", async () => {
  const prototypes = PrototypesSchema.parse(rowPrototypes);
  const events: ServerMessage[] = [];
  const model = fakeModel([{ text: "Here's a row of 3 assemblers." }, { tool: "place_blueprint" }, { text: "Confirm in the card." }]);
  const game = fakeGame();
  game.game.latest = () => ({ digest: DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {}, player: { name: "p", surface: "nauvis", position: { x: 10, y: 20 } } }), receivedAt: Date.now() });
  const agent = new Agent({ model, game: game.game, system: () => "rules", retriever: () => new RecipeRetriever(prototypes), prototypes: () => prototypes, emit: (m) => events.push(m) });
  await agent.ask("Make me a blueprint for 200 iron gear wheels per minute");
  const card = events.find((e) => e.type === "blueprint");
  if (card?.type !== "blueprint") throw new Error("no blueprint card");
  expect(card.blueprint.summary).toContain("3 assembling-machine-2");
  expect(card.blueprint.sketch.filter((e) => e.kind === "assembling-machine")).toHaveLength(3);
  const prompt = model.seen[0]!.at(-1)!.content;
  expect(prompt).toContain("[generated blueprint: 3 assembling-machine-2 making iron-gear-wheel at 270/min");
  expect(prompt).not.toContain(card.blueprint.string);
  expect(events.some((e) => e.type === "plan")).toBe(false);

  await agent.ask("Paste it here please");
  const approval = events.find((e) => e.type === "approval");
  if (approval?.type !== "approval") throw new Error("no approval card");
  expect(approval.title).toContain("Paste the blueprint at your position");
});

test("blueprint requests are told apart from plans", () => {
  expect(wantsBlueprint("Make me a blueprint for 120 gears per minute")).toBe(true);
  expect(wantsBlueprint("a layout for 2 circuits per second")).toBe(true);
  expect(wantsBlueprint("How many assemblers for 120 gears per minute?")).toBe(false);
  expect(wantsBlueprint("Review this blueprint")).toBe(false);
});

test("changing a recipe goes through a card and names the recipe from the player's words", async () => {
  const prototypes = PrototypesSchema.parse(rowPrototypes);
  const machines = [{ name: "assembling-machine-2", x: 1.5, y: 1.5 }, { name: "assembling-machine-2", x: 4.5, y: 1.5 }];
  const calls: { action: ActionName; args: any }[] = [];
  const game: GameActions = {
    latest: () => undefined,
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "find_entities") return { surface: "nauvis", center: { x: 0, y: 0 }, direction: "around", radius: 32, area: { left_top: { x: -32, y: -32 }, right_bottom: { x: 32, y: 32 } }, count: 2, by_name: { "assembling-machine-2": 2 }, not_visible: 0, entities: machines, truncated: false };
      if (action === "highlight") return { drawn: 2, seconds: 30 };
      if (action === "set_recipe") return { done: 2, rejected: {}, returned: 20, spilled: 0 };
      throw new Error(`unexpected ${action}`);
    },
  };
  const events: ServerMessage[] = [];
  const model = fakeModel([{ tool: "find_entities", args: { what: "assemblers" } }, { tool: "set_recipe", args: { recipe: "iron gear wheels" } }, { text: "Confirm in the card." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => new RecipeRetriever(prototypes), prototypes: () => prototypes, emit: (m) => events.push(m) });
  await agent.ask("Set the assemblers around me to make iron gear wheels");
  const card = events.find((e) => e.type === "approval");
  if (card?.type !== "approval") throw new Error("no card");
  expect(card.title).toBe("Set 2 assemblers to make iron-gear-wheel?");
  expect(calls.some((c) => c.action === "set_recipe")).toBe(false);
  await agent.approve(card.id);
  expect(calls.find((c) => c.action === "set_recipe")?.args).toEqual({ entities: machines, recipe: "iron-gear-wheel" });
  expect(events.at(-1)).toMatchObject({ type: "approval_result", status: "done", message: "Set 2 machines to iron-gear-wheel; 20 items back to your inventory." });
});


test("a chart block on a turn without charts never reaches the page or the history", async () => {
  const { agent, events } = setup([{ text: "Gears take 2 iron plates.\n\n```rate_chart\nitem=iron-gear-wheel surface=nauvis window=30m\n```" }]);
  await agent.ask("What does an iron gear wheel need?");
  const shown = events.filter((e) => e.type === "token").map((e: any) => e.text).join("");
  expect(shown).toBe("Gears take 2 iron plates.\n\n");
  expect(agent.history.at(-1)!.content).toBe("Gears take 2 iron plates.");
});

test("a recipe question about something not in the save gets that as data", async () => {
  const prototypes = PrototypesSchema.parse(rowPrototypes);
  const model = fakeModel([{ text: "There's no quantum widget in this save." }]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => new RecipeRetriever(prototypes), prototypes: () => prototypes, emit: () => {} });
  await agent.ask("How do I craft a quantum widget?");
  expect(model.seen[0]!.at(-1)!.content).toContain('[save data: no item, fluid, recipe or building in this save is named "quantum widget"');
});

test("the conversation is saved after each answer, restored by a new agent, and cleared by a reset", async () => {
  let saved: SessionData | null = null;
  const store: SessionStore = { load: () => saved, save: (d) => { saved = structuredClone(d); }, clear: () => { saved = null; } };
  const events: ServerMessage[] = [];
  const first = new Agent({ model: fakeModel([{ text: "Carbon fiber needs carbon and yumako mash." }]), game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m), session: store });
  await first.ask("What's the recipe for carbon fiber?");
  expect(saved!.transcript).toEqual([{ kind: "user", text: "What's the recipe for carbon fiber?" }, { kind: "agent", text: "Carbon fiber needs carbon and yumako mash." }]);
  expect(saved!.history.map((m) => m.role)).toEqual(["user", "assistant"]);

  // A restarted server: the new agent starts with the saved conversation, and the model sees it.
  const model = fakeModel([{ text: "You asked about carbon fiber." }]);
  const second = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {}, session: store });
  expect(second.transcript()).toHaveLength(2);
  await second.ask("What did I just ask you about?");
  expect(model.seen[0]!.some((m) => m.content.includes("Carbon fiber needs carbon"))).toBe(true);
  expect(saved!.transcript).toHaveLength(4);

  second.reset();
  expect(saved).toBeNull();
  expect(second.transcript()).toEqual([]);
});

test("a screenshot of the last result is taken where it is, waited for, and shown on the page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-out-"));
  mkdirSync(join(dir, "companion"));
  const rails = [{ name: "straight-rail", x: 10, y: -7 }, { name: "straight-rail", x: 14, y: -7 }];
  const calls: { action: ActionName; args: any }[] = [];
  const game: GameActions = {
    latest: () => undefined,
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "find_entities") return { surface: "gleba", center: { x: 0, y: 0 }, direction: "around", radius: 32, area: { left_top: { x: -32, y: -32 }, right_bottom: { x: 32, y: 32 } }, count: 2, by_name: { "straight-rail": 2 }, not_visible: 0, entities: rails, truncated: false };
      if (action === "highlight") return { drawn: 2, seconds: 30 };
      if (action === "screenshot") {
        writeFileSync(join(dir, "companion", "shot-5-1.jpg"), "jpeg bytes");
        return { path: "companion/shot-5-1.jpg", surface: "gleba", x: args.x, y: args.y, size: 1024, zoom: 0.5, tiles: 64 };
      }
      throw new Error(`unexpected ${action}`);
    },
  };
  const events: ServerMessage[] = [];
  const model = fakeModel([{ tool: "find_entities", args: { what: "rails" } }, { tool: "screenshot", args: { at: "last_result" } }, { text: "There they are." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m), scriptOutput: dir });
  await agent.ask("Find the rails near me and show me a screenshot of them");
  expect(calls.find((c) => c.action === "screenshot")?.args).toEqual({ x: 12, y: -7, size: 1024, zoom: 0.5 });
  expect(events.find((e) => e.type === "image")).toEqual({ type: "image", url: "/shots/shot-5-1.jpg", caption: "rails: 64 tiles across around (12, -7) on gleba" });
  const toolReply = model.seen[2]!.find((m) => m.role === "tool" && m.content.startsWith("A screenshot"));
  expect(toolReply?.content).toContain("don't describe its contents");
});

test("in remote view, 'here' follows the view and 'near me' follows the character (FC-092)", () => {
  expect(anchorFor("How many belts are near me on the right?", "search")).toBe("character");
  expect(anchorFor("What's this spot on screen?", "search")).toBe("view");
  expect(anchorFor("Paste it here", "place")).toBe("view");
  expect(anchorFor("Take a screenshot of where I'm standing", "place")).toBe("character");
  expect(anchorFor("How many assemblers are there?", "search")).toBe("character");
  expect(anchorFor("Put a map tag that says ore", "place")).toBe("view");

  const remote = DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    player: { name: "p", surface: "nauvis", position: { x: 500, y: 0 }, remote_view: true, character_surface: "nauvis", character_position: { x: 0, y: 0 } } });
  expect(anchorSpot(remote, "character")).toEqual({ x: 0, y: 0, surface: "nauvis", note: " (you're in map view: used your character's spot, not the map view)" });
  expect(anchorSpot(remote, "view")).toEqual({ x: 500, y: 0, surface: "nauvis", note: " (you're in map view: used the spot you're looking at, not your character)" });
  const walking = DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    player: { name: "p", surface: "nauvis", position: { x: 3, y: 4 }, remote_view: false, character_surface: "nauvis", character_position: { x: 3, y: 4 } } });
  expect(anchorSpot(walking, "view")?.note).toBe("");
});

test("a paste 'near me' while viewing another surface is refused with a way forward", async () => {
  const { agent, model } = setup([{ tool: "place_blueprint" }, { text: "You're viewing another surface." }]);
  (agent as any).lastBlueprint = { raw: "0eNq", at: Date.now() };
  const game = (agent as any).deps.game as GameActions;
  game.latest = () => ({ receivedAt: 0, digest: DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    player: { name: "p", surface: "vulcanus", position: { x: 9, y: 9 }, remote_view: true, character_surface: "nauvis", character_position: { x: 0, y: 0 } } }) });
  await agent.ask("Paste that blueprint near me");
  const reply = model.seen[1]!.find((m) => m.role === "tool")!.content;
  expect(reply).toContain("character is on nauvis but they're viewing vulcanus");
});

