import { expect, test } from "bun:test";
import type { ActionName } from "@companion/interfaces";
import { Agent, needsWorldTools, wantsChart, type GameActions } from "./agent";
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
