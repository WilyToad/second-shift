import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionName } from "@companion/interfaces";
import { DigestSchema, PrototypesSchema } from "@companion/interfaces";
import { encodeBlueprintString } from "./blueprint";
import { RecipeRetriever } from "./retrieval";
import { acceptedOffer, correctedRequest } from "./player";
import { Agent, askedFor, fileSession, mapSession, anchorFor, anchorSpot, compactHistory, compactUserContent, fallbackChart, needsWorldTools, parseTarget, targetRate, wantsBlueprint, wantsChart, type GameActions, type SessionData, type SessionStore } from "./agent";
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
  for (const q of ["yeah, look around", "what did I just build?", "I just built something", "what do you see?"]) expect(needsWorldTools(q, false)).toBe(true);
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

test("planning tools: explicit research runs now, unprompted is offered in words and runs on yes, pastes need approval", async () => {
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
    { tool: "queue_research", args: { technology: "logistics" } }, { text: "Logistics is next. Want me to queue it?" },
    { tool: "queue_research", args: { technology: "logistics" } }, { text: "Queued." },
    { text: "Looks fine." },
    { tool: "place_blueprint" }, { text: "Confirm in the app." },
  ]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => retriever, prototypes: () => prototypes, emit: (m) => events.push(m) });

  await agent.ask("queue the research for fast belts");
  const acts = () => calls.filter((c) => c.action !== "research_options"); // research turns also fetch the options list
  expect(acts()).toEqual([{ action: "queue_research", args: { technology: "logistics" } }]);
  expect(model.seen[0]!.at(-1)!.content).toContain("researchable now (1, cheapest first): logistics 10×automation");

  await agent.ask("what should I work on next?"); // model suggests research unprompted: dropped, no card (FC-126)
  expect(acts().length).toBe(1);
  expect(events.some((e) => e.type === "approval")).toBe(false);
  expect(model.seen[3]!.at(-1)!.content).toContain("the player hasn't asked for this yet");
  await agent.ask("yes please"); // a yes to "Want me to queue it?" asks for it
  expect(acts().at(-1)).toEqual({ action: "queue_research", args: { technology: "logistics" } });

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
  expect(prompt).toContain("[generated blueprint: 3 assembling-machine-2 making iron-gear-wheel at about 270/min");
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
      if (action === "set_recipe") return { done: 2, rejected: {}, to_inventory: 20, spilled: 5 };
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
  expect(events.at(-1)).toMatchObject({ type: "approval_result", status: "done", message: "Set 2 machines to iron-gear-wheel; 20 leftover ingredients to your inventory, 5 spilled next to the machines for your robots to collect." });
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


test("in map view, a paste card names the map view as the spot", async () => {
  const { agent, events } = setup([{ tool: "place_blueprint" }, { text: "Confirm in the card." }]);
  (agent as any).lastBlueprint = { raw: "0eNq", at: Date.now() };
  const game = (agent as any).deps.game as GameActions;
  game.latest = () => ({ receivedAt: 0, digest: DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    player: { name: "p", surface: "nauvis", position: { x: 55, y: 40 }, remote_view: true, character_surface: "nauvis", character_position: { x: 55, y: 52 } } }) });
  await agent.ask("Paste it here");
  const card = events.filter((e) => e.type === "approval").at(-1) as any;
  expect(card.title).toBe("Paste the blueprint at the map view (55, 40)?");
});

function firstHourGame() {
  const calls: { action: ActionName; args: any }[] = [];
  const game: GameActions = {
    latest: () => undefined,
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "player_status") return { character: true, surface: "nauvis", x: 0, y: 0, items: [{ name: "iron-plate", count: 8 }], total_items: 1, craftable: [{ name: "iron-gear-wheel", count: 4 }], more_craftable: false, crafting_queue: [], recent_builds: [{ name: "stone-furnace", ghost: false, surface: "nauvis", x: 3, y: 0, age_ticks: 120, still_there: true }] };
      if (action === "surroundings") return { surface: "nauvis", x: 0, y: 0, radius: 32, mine: [{ name: "stone-furnace", count: 1, x: 3, y: 0 }], resources: [{ name: "iron-ore", count: 200, amount: 90000, x: 0, y: -15 }], other: [], trees: 40, rocks: 2, enemies: 0, water_tiles: 0, salvage: [], salvage_containers: 0 };
      if (action === "research_options") return { options: [], available: 0, queue: [], triggers: [{ name: "electronics", trigger: "craft 10 copper-cable" }] };
      throw new Error(`unexpected ${action}`);
    },
  };
  return { game, calls };
}

test("S22: 'yeah' after an offer to look around looks, and the guidance never rules tools out", async () => {
  const { game, calls } = firstHourGame();
  const model = fakeModel([{ text: "Nothing here yet. Want me to look around to see what you built?" }, { text: "A stone furnace 3 tiles east." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("I just finished something over there");
  await agent.ask("yeah");
  expect(calls.map((c) => c.action)).toEqual(["player_status", "surroundings"]);
  const turn = model.seen[1]!.at(-1)!.content;
  expect(turn).toContain("[the player right now]");
  expect(turn).toContain("player's recent builds, newest first: stone-furnace 3 tiles east");
  expect(turn).toContain("- the player's own (built or owned): stone-furnace 1");
  expect(turn).not.toContain("no tool call");
  expect(turn).not.toContain("data provided");
});

test("S22: a question nothing matched gets no 'no tool call' note; a recipe question still does", async () => {
  const { game } = firstHourGame();
  const model = fakeModel([{ text: "ok" }, { text: "ok" }]);
  const prototypes = PrototypesSchema.parse(rowPrototypes);
  const retriever = new RecipeRetriever(prototypes);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => retriever, prototypes: () => prototypes, emit: () => {} });
  await agent.ask("that went well");
  expect(model.seen[0]!.at(-1)!.content).not.toContain("no tool call");
  await agent.ask("what's the recipe for electronic circuits?");
  expect(model.seen[1]!.at(-1)!.content).toContain("no tool call is needed");
});

test("S22: start-of-game advice is grounded on inventory, surroundings and trigger research", async () => {
  const { game, calls } = firstHourGame();
  const model = fakeModel([{ text: "Mine the iron ore 15 tiles north." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("help me... what do I do?");
  expect(new Set(calls.map((c) => c.action))).toEqual(new Set(["player_status", "surroundings", "research_options"]));
  const turn = model.seen[0]!.at(-1)!.content;
  expect(turn).toContain("inventory (1 kinds): iron-plate 8");
  expect(turn).toContain("iron-ore 200 tiles, 90k total (nearest 15 tiles north at (0, -15))");
  expect(turn).toContain("unlocked by doing, no labs needed: electronics (craft 10 copper-cable)");
  expect(turn).toContain("name no item, building or technology that isn't in them");
  // Compacted history keeps only the question.
  expect(compactUserContent(turn)).toBe("help me... what do I do?");
});

test("S22: an older mod without the player actions still answers", async () => {
  const model = fakeModel([{ text: "ok" }]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("what can I craft right now?");
  expect(model.seen[0]!.at(-1)!.content).not.toContain("[the player right now]");
});

test("FC-137: one conversation per map; the first map adopts the conversation from before map ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maps-"));
  const legacy = join(dir, "session.json");
  const sessions = join(dir, "sessions");
  writeFileSync(legacy, JSON.stringify({ savedAt: "", history: [{ role: "user", content: "old question" }, { role: "assistant", content: "old answer" }], transcript: [{ kind: "user", text: "old question" }, { kind: "agent", text: "old answer" }] } satisfies SessionData));
  const events: ServerMessage[] = [];
  const agent = new Agent({ model: fakeModel([{ text: "new answer" }]), game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m), session: fileSession(legacy) });

  agent.useSession(mapSession(sessions, "abc-0", legacy));
  expect(agent.history.map((m) => m.content)).toEqual(["old question", "old answer"]);
  expect(events.map((e) => e.type)).toEqual(["reset", "transcript"]);

  events.length = 0;
  agent.useSession(mapSession(sessions, "def-1", legacy));
  expect(agent.history).toEqual([]);
  expect(agent.transcript()).toEqual([]);
  expect(events.map((e) => e.type)).toEqual(["reset"]);
  await agent.ask("hello on the new map");
  await Bun.sleep(5);

  agent.useSession(mapSession(sessions, "abc-0", legacy));
  expect(agent.history[0]!.content).toBe("old question");
  agent.useSession(mapSession(sessions, "def-1", legacy));
  expect(agent.transcript()[0]!.text).toBe("hello on the new map");
});

test("FC-127: an unasked-for screenshot is dropped and the round's answer stands", async () => {
  const game = fakeGame();
  const model: ChatModel & { seen: ChatMessage[][] } = {
    seen: [],
    async stream(messages, opts) {
      this.seen.push(messages);
      opts?.onToken?.("Yumako spoils in 60 minutes.");
      return { text: "Yumako spoils in 60 minutes.", toolCalls: [{ id: "c1", type: "function", function: { name: "screenshot", arguments: "{}" } }], totalMs: 1 };
    },
  };
  const events: ServerMessage[] = [];
  const agent = new Agent({ model, game: game.game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m) });
  await agent.ask("How long does yumako last before it spoils?");
  expect(model.seen.length).toBe(1);
  expect(game.calls).toEqual([]);
  expect(events.some((e) => e.type === "done")).toBe(true);
  expect(agent.history.at(-1)).toEqual({ role: "assistant", content: "Yumako spoils in 60 minutes." });
});

test("FC-126: actions run or get a card only when the player's words ask for them", () => {
  expect(askedFor("place_blueprint", "Give me a blueprint for 300 electronic circuits a minute")).toBe(false);
  expect(askedFor("place_blueprint", "a blueprint for 300 electronic circuits a minute, paste it here")).toBe(true);
  expect(askedFor("queue_research", "What do I need before I can research agricultural science?")).toBe(false);
  expect(askedFor("queue_research", "queue the research for fast belts")).toBe(true);
  expect(askedFor("queue_research", "research logistics")).toBe(true);
  expect(askedFor("map_action", "help me... what do I do?")).toBe(false);
  expect(askedFor("map_action", "I just built something")).toBe(false);
  expect(askedFor("map_action", "tag this spot as iron")).toBe(true);
  expect(askedFor("mark_deconstruction", "mark them for deconstruction")).toBe(true);
  expect(askedFor("mark_deconstruction", "how many rails are near me?")).toBe(false);
  expect(askedFor("set_recipe", "switch those assemblers to gears")).toBe(true);
  expect(askedFor("find_entities", "anything")).toBe(true);
});

test("FC-130: a doubled answer reaches the page and the history once, and the turn is marked", async () => {
  const answer = "22 entities: 2 assembling-machine-2, 6 inserters and 14 belts. Both inputs keep up at 90/min; nothing looks wrong.";
  const events: ServerMessage[] = [];
  const log = join(mkdtempSync(join(tmpdir(), "turns-")), "turns.jsonl");
  const model: ChatModel = {
    async stream(_messages, opts) {
      const doubled = `${answer}\n\n${answer}`;
      for (let i = 0; i < doubled.length; i += 5) {
        if (opts?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        opts?.onToken?.(doubled.slice(i, i + 5));
      }
      return { text: doubled, toolCalls: [], totalMs: 1 };
    },
  };
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m), turnLog: log });
  await agent.ask("review this build");
  const shown = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("");
  expect(shown.trim()).toBe(answer);
  expect(agent.history.at(-1)).toEqual({ role: "assistant", content: answer });
  expect(agent.transcript().at(-1)).toEqual({ kind: "agent", text: answer });
  expect(JSON.parse(readFileSync(log, "utf8").trim()).repeated).toBe(true);
});

test("helmet: a search result never tells the model what's in chunks the player can't see", async () => {
  const game = fakeGame([]);
  const call = game.game.call.bind(game.game);
  // An older mod still sent the count; the server must not pass it on either (FC-142).
  game.game.call = async (action: any, args?: any) => (action === "find_entities" ? { ...(await call(action, args)), not_visible: 1580 } : call(action, args));
  const { agent, model } = setup([{ tool: "find_entities", args: { what: "rails" } }, { text: "None nearby." }], game);
  await agent.ask("any rails near me?");
  const toolMsg = model.seen[1]!.at(-1)!.content;
  expect(toolMsg).toContain("Found 0 rails");
  expect(toolMsg).not.toContain("1580");
  expect(toolMsg).not.toContain("can't see");
});

test("FC-142: own stuck machines out of view are counted as elsewhere in the factory, never as 'chunks you can't see'", async () => {
  const digest = DigestSchema.parse({
    tick: 1, player: { name: "p", surface: "nauvis", position: { x: 0, y: 0 } }, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    machines: { progress: { machines: 42, scanned: true, refresh_ticks: 1 }, stuck: [{ surface: "nauvis", recipes: [{ recipe: "iron-gear-wheel", total: 42, stuck: 42, statuses: { item_ingredient_shortage: 42 } }] }] },
  });
  const game: GameActions = {
    latest: () => ({ digest, receivedAt: 0 }),
    async call(action: any): Promise<any> {
      if (action === "find_machines") return { surface: "nauvis", recipe: "iron-gear-wheel", count: 12, not_visible: 30, same_surface: true, by_status: { item_ingredient_shortage: 12 }, entities: [{ name: "assembling-machine-2", x: 1, y: 1 }] };
      if (action === "highlight") return { drawn: 1, seconds: 10 };
      throw new Error(`unexpected ${action}`);
    },
  };
  const model = fakeModel([{ tool: "find_stuck_machines", args: { what: "iron gear wheel" } }, { text: "12 here, 30 more elsewhere." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("show me the stuck iron gear wheel assemblers");
  const toolMsg = model.seen[1]!.at(-1)!.content;
  expect(toolMsg).toContain("12 iron-gear-wheel machines not working on nauvis");
  expect(toolMsg).toContain("30 more elsewhere in their own factory, out of view");
  expect(toolMsg).not.toContain("can't see");
});

test("FC-143: 'show me the way to copper' points to the nearest one it found, and only when asked", async () => {
  const calls: { action: string; args: any }[] = [];
  const game: GameActions = {
    latest: () => undefined,
    async call(action: any, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "find_entities") return { surface: "nauvis", center: { x: 0, y: 0 }, direction: "around", radius: 128, area: { left_top: { x: -128, y: -128 }, right_bottom: { x: 128, y: 128 } }, count: 3, by_name: { "copper-ore": 3 }, entities: [{ name: "copper-ore", x: 60.5, y: -10.5 }, { name: "copper-ore", x: 40.5, y: 0.5 }, { name: "copper-ore", x: 90.5, y: 5.5 }], truncated: false };
      if (action === "point_to") return { surface: "nauvis", x: args.x, y: args.y, distance: 40, seconds: 30 };
      throw new Error(`unexpected ${action}`);
    },
  };
  const prototypes = PrototypesSchema.parse({ recipes: {}, items: { "copper-ore": { type: "item", stack_size: 50 } }, fluids: {}, technologies: {}, machines: {}, raw_resources: ["copper-ore"] });
  const model = fakeModel([{ tool: "show_the_way", args: { what: "copper ore" } }, { text: "Head east, 40 tiles." }, { tool: "show_the_way", args: { what: "copper ore" } }, { text: "Copper is east." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => new RecipeRetriever(prototypes), prototypes: () => prototypes, emit: () => {} });
  await agent.ask("show me the way to the nearest copper ore");
  expect(calls.find((c) => c.action === "find_entities")!.args).toMatchObject({ names: ["copper-ore"], radius: 128, from: "character" });
  expect(calls.find((c) => c.action === "point_to")!.args).toEqual({ x: 40.5, y: 0.5, label: "copper-ore", seconds: 30 });
  expect(model.seen[1]!.at(-1)!.content).toContain("Pointing to the nearest copper-ore: 40 tiles east at (40, 0)");
  calls.length = 0;
  await agent.ask("is there copper around?"); // a question, not a request to be pointed: dropped (FC-126)
  expect(calls.some((c) => c.action === "point_to")).toBe(false);
});

test("FC-109: train stop limits go through a card on the last search, and only when asked", async () => {
  const stops = [{ name: "train-stop", x: 10, y: 3 }, { name: "train-stop", x: 30, y: 3 }];
  const { agent, events, calls } = setup([
    { tool: "find_entities", args: { what: "train stops" } }, { text: "2 train stops." },
    { tool: "set_train_stop", args: { limit: 2 } }, { text: "Confirm in the app." },
  ], fakeGame(stops));
  await agent.ask("how many train stops are near me?");
  await agent.ask("set their train limit to 2");
  const card = events.find((e) => e.type === "approval") as Extract<ServerMessage, { type: "approval" }>;
  expect(card.title).toBe("Set 2 train stops: train limit 2?");
  expect(calls.some((c) => c.action === "set_train_stop")).toBe(false);
  expect(askedFor("set_train_stop", "how many train stops are near me?")).toBe(false);
  expect(askedFor("set_train_stop", "rename them to Iron Drop")).toBe(true);
});

test("FC-155: offers in the model's own wording count as asked once the player says yes", () => {
  const yes = (offer: string, tool: string) => askedFor(tool, `${acceptedOffer("Yes please", offer)} Yes please`);
  expect(yes("I can't place the arrow right now. Want me to try marking it on your map?", "map_action")).toBe(true);
  expect(yes("Want me to drop a map tag on the copper patch?", "map_action")).toBe(true);
  expect(yes("Want me to drop a marker there?", "map_action")).toBe(true);
  expect(yes("Want me to point you toward the iron ore?", "show_the_way")).toBe(true);
  expect(yes("Want me to point out the nearest ore patch?", "show_the_way")).toBe(true);
  expect(yes("Want me to point you at the wreckage?", "show_the_way")).toBe(true);
  expect(yes("Want me to ghost it at your spot?", "place_blueprint")).toBe(true);
  expect(yes("Want me to research agricultural science?", "queue_research")).toBe(true);
  expect(yes("Want me to queue it?", "queue_research")).toBe(true);
  expect(yes("Want me to mark the wrecks for deconstruction?", "mark_deconstruction")).toBe(true);
  // Still not asked without an offer or a request.
  expect(askedFor("map_action", "where is the rocket silo?")).toBe(false);
  expect(askedFor("show_the_way", "how many radars are near me?")).toBe(false);
  expect(askedFor("queue_research", "What do I need before I can research agricultural science?")).toBe(false);
});

test("FC-154: a correction carries the request into the turn", () => {
  const intent = `${correctedRequest("I meant the rocket silo", "Where is the rocket salad can you point it out to me")} I meant the rocket silo`;
  expect(askedFor("show_the_way", intent)).toBe(true);
});

test("FC-151 FC-152: 'what's in this chest' looks at what's under the mouse and inside it", async () => {
  const calls: { action: ActionName; args: any }[] = [];
  const chest = { name: "iron-chest", ghost: false, type: "container", surface: "nauvis", x: 4, y: -2, own: true };
  const game: GameActions = {
    latest: () => undefined,
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "pointed_at") return { selected: chest, hand: { name: "transport-belt", count: 50 } };
      if (action === "container_contents") return { entity: chest, items: [{ name: "iron-plate", count: 400 }], total_kinds: 1, fluids: [] };
      throw new Error(`unexpected ${action}`);
    },
  };
  const model = fakeModel([{ text: "400 iron plates." }, { text: "Nothing." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("what's in this chest?");
  expect(calls.find((c) => c.action === "container_contents")?.args).toEqual({ name: "iron-chest", x: 4, y: -2 });
  const turn = model.seen[0]!.at(-1)!.content;
  expect(turn).toContain("under the mouse now: iron-chest at (4, -2)");
  expect(turn).toContain("inside the iron-chest at (4, -2): iron-plate 400");
  calls.length = 0;
  await agent.ask("what do I have in my inventory?");
  expect(calls.map((c) => c.action)).not.toContain("container_contents");
});

test("FC-153: 'what do I use these for?' retrieves what the last answer was about, and wrong sums get corrected", async () => {
  const prototypes = PrototypesSchema.parse({ ...rowPrototypes, items: { "iron-gear-wheel": { type: "item", stack_size: 100 }, "engine-unit": { type: "item", stack_size: 50 } } });
  const retriever = new RecipeRetriever(prototypes);
  const model = fakeModel([{ text: "You have 7 iron gear wheels." }, { text: "Engines. 7 × 2 = 12 plates." }]);
  const events: any[] = [];
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => retriever, prototypes: () => prototypes, emit: (e) => events.push(e) });
  await agent.ask("What's in my inventory now");
  await agent.ask("What do I use these for");
  const turn = model.seen[1]!.at(-1)!.content;
  expect(turn).toContain("engine-unit"); // a recipe that uses gears
  expect(turn).toContain('"these" means iron-gear-wheel from the last answer');
  expect(agent.transcript().at(-1)!.text).toContain("Correction: 7 × 2 = 14, not 12.");
});

test("FC-144 FC-051: sending a spidertron waits for a card, and 'stop' takes it back at once", async () => {
  const calls: { action: ActionName; args: any }[] = [];
  const game: GameActions = {
    latest: () => ({ receivedAt: 0, digest: DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
      player: { name: "p", surface: "gleba", position: { x: 0, y: 0 } } }) }),
    async call(action: ActionName, args?: any): Promise<any> {
      calls.push({ action, args });
      if (action === "spidertrons") return { spidertrons: [{ name: "spidertron", unit_number: 7, x: 4, y: 0, distance: 4, driver: false }], total: 1, has_remote: true, surface: "gleba" };
      if (action === "find_entities") return { surface: "gleba", count: 2, by_name: { "copper-ore": 2 }, entities: [{ name: "copper-ore", x: 40, y: 0 }, { name: "copper-ore", x: 60, y: 0 }], center: { x: 0, y: 0 }, truncated: false };
      if (action === "highlight") return { drawn: 2, seconds: 60 };
      if (action === "send_spidertron") return { name: "spidertron", unit_number: 7, x: args.x, y: args.y, distance: 36, surface: "gleba" };
      if (action === "stop_control") return { stopped: true, control: "spidertron", entity: "spidertron", surface: "gleba" };
      throw new Error(`unexpected ${action}`);
    },
  };
  const events: ServerMessage[] = [];
  const prototypes = PrototypesSchema.parse({ ...rowPrototypes, items: { "copper-ore": { type: "item", stack_size: 50 } } });
  const model = fakeModel([{ text: "Card is up." }, { text: "Stopped." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => prototypes, emit: (m) => events.push(m) });

  await agent.ask("send my spidertron to the nearest copper ore");
  const card = events.find((e) => e.type === "approval") as any;
  expect(card.title).toBe("Send the spidertron to the nearest copper-ore at (40, 0)?");
  expect(card.detail).toContain("its own autopilot");
  expect(calls.map((c) => c.action)).not.toContain("send_spidertron"); // nothing moves before the confirm
  expect(model.seen[0]!.at(-1)!.content).toContain("the player's spidertrons on gleba");
  await agent.approve(card.id);
  expect(calls.find((c) => c.action === "send_spidertron")?.args).toEqual({ x: 40, y: 0, unit_number: 7 });

  await agent.ask("stop");
  expect(calls.map((c) => c.action)).toContain("stop_control");
  expect(model.seen[1]!.at(-1)!.content).toContain("stopped the spidertron in the game, as asked");
});

test("FC-163: the list tool edits the player's list, shows it, and is dropped when they didn't ask", async () => {
  const events: ServerMessage[] = [];
  const model = fakeModel([
    { tool: "update_list", args: { list: "packing", kind: "packing", add: ["20 stone furnace", "200 transport belt"] } }, { text: "On the list." },
    { text: "Three radars." },
    { tool: "update_list", args: { list: "packing", clear: true } }, { text: "Nothing to add." },
  ]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m) });

  await agent.ask("start a packing list: 20 stone furnace and 200 transport belt");
  expect(agent.lists.active()!.items.map((i) => i.text)).toEqual(["20 stone furnace", "200 transport belt"]);
  const shown = events.filter((e) => e.type === "lists").at(-1) as any;
  expect(shown.active).toBe("packing");
  expect(shown.lists[0].kind).toBe("packing");

  // The next turn sees the list in its tail, so it can answer about it without asking the game.
  await agent.ask("how many radars are near me?");
  const tail = model.seen[2]!.at(-1)!.content; // the first ask used two rounds (tool, then answer)
  expect(tail).toContain('the player\'s list "packing" (0 of 2 done');
  expect(tail).toContain("- [ ] 200 transport belt");

  // A question that isn't about lists: an edit the player didn't ask for is dropped (FC-126).
  await agent.ask("what's my iron plate production?");
  expect(agent.lists.active()!.items).toHaveLength(2);
  expect(model.seen[4]!.at(-1)!.content).toContain("the player hasn't asked for this yet");
});

test("FC-163: clearing the conversation clears its lists", async () => {
  const events: ServerMessage[] = [];
  const model = fakeModel([{ tool: "update_list", args: { list: "packing", add: ["20 stone furnace"] } }, { text: "Added." }]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: (m) => events.push(m) });
  await agent.ask("add 20 stone furnace to a packing list");
  expect(agent.lists.all()).toHaveLength(1);
  agent.reset();
  expect(agent.lists.all()).toHaveLength(0);
  expect((events.filter((e) => e.type === "lists").at(-1) as any).lists).toEqual([]);
});

test("FC-166: a build the player is about to make becomes a packing list even if the model forgets to say so", async () => {
  const model = fakeModel([{ tool: "update_list", args: { list: "outpost", add: ["20 stone furnace"] } }, { text: "Listed." }]);
  const agent = new Agent({ model, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await agent.ask("I'm building a smelting outpost, I need 20 ovens and some belt");
  expect(agent.lists.active()!.kind).toBe("packing");
  // A list that isn't about a build stays plain.
  const plain = fakeModel([{ tool: "update_list", args: { list: "jobs", add: ["fix the wall"] } }, { text: "Listed." }]);
  const other = new Agent({ model: plain, game: fakeGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await other.ask("add fix the wall to my jobs list");
  expect(other.lists.active()!.kind).toBe("plain");
});

test("FC-172: a build request hears what it can actually do, not a flat refusal", async () => {
  const { game } = firstHourGame();
  const model = fakeModel([{ text: "Here's the plan." }]);
  const agent = new Agent({ model, game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  // The player's own words, from the 2026-09-17 session.
  await agent.ask("build a line up to my metal");
  const turn = model.seen[0]!.at(-1)!.content as string;
  expect(turn).toContain("build a blueprint in code for one production row");
  expect(turn).toContain("on a card they confirm");
  // The limits are named rather than implied.
  expect(turn).toContain("no template for a belt run between two points");
  expect(turn).toContain("ghosts are built by construction robots");

  // A question that isn't about building gets none of it.
  const other = fakeModel([{ text: "12 rails." }]);
  const plain = new Agent({ model: other, game: firstHourGame().game, system: () => "rules", retriever: () => null, prototypes: () => null, emit: () => {} });
  await plain.ask("how many rails are near me?");
  expect(other.seen[0]!.at(-1)!.content as string).not.toContain("one production row");
});

test("FC-172: 'build me 120 gears a minute' is the same request as asking for a blueprint", async () => {
  const { wantsBlueprint, wantsBuild } = await import("./agent");
  // A rate makes it a row we can build in code, with or without the word "blueprint".
  expect(wantsBlueprint("build me 120 iron gear wheels per minute")).toBe(true);
  expect(wantsBlueprint("a blueprint for 120 gears per minute")).toBe(true);
  // No rate: it's a build request, answered in words with the real limits.
  expect(wantsBlueprint("build a line up to my metal")).toBe(false);
  expect(wantsBuild("build a line up to my metal")).toBe(true);
  expect(wantsBuild("can you build a smelting row here?")).toBe(true);
  // A described load is a packing list, not a build offer (FC-166 keeps that turn).
  expect(wantsBuild("I'm building a smelting outpost, I need 20 ovens and some belt")).toBe(false);
  expect(wantsBuild("how many rails are near me?")).toBe(false);
});
