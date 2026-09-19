import { expect, test } from "bun:test";
import { actionClaims } from "./claims";

test("FC-229: an action the answer says happened, on a turn where no tool did it, gets a correction", () => {
  // Verbatim from the diagnosis eval (2026-09-18): no tool call, and a claimed highlight.
  const claimed = "The 6 are highlighted in-game for 60 s: 2 with no power, 3 starved of iron plates, 1 jammed with full output.";
  expect(actionClaims(claimed, [])).toEqual(["Correction: nothing was highlighted this turn — I didn't run a search."]);
  // The same words after a real search are fine.
  expect(actionClaims(claimed, ["find_stuck_machines"])).toEqual([]);
  expect(actionClaims("Found them and highlighted them for 60 s.", ["find_entities"])).toEqual([]);
  // Other actions, same rule.
  expect(actionClaims("Done — marked on your map at (-4, -5).", [])).toEqual(["Correction: nothing was marked on the map this turn."]);
  expect(actionClaims("Queued automation for you.", ["queue_research"])).toEqual([]);
  expect(actionClaims("I've queued it.", [])).toHaveLength(1);
});

test("FC-229: talking about an action isn't claiming it", () => {
  for (const text of [
    "Say the word and I'll highlight them.",
    "find_stuck_machines lists and highlights them — want me to run it?",
    "You could mark it on your map with a tag.",
    "Nothing is queued: 47 labs idle.",
    "That would need a paste, which puts up a card first.",
  ]) expect(actionClaims(text, [])).toEqual([]);
});
