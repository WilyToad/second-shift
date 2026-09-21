import { expect, test } from "bun:test";
import { CLASSIFIERS, CORPUS } from "./intent-corpus";

test("FC-199: every classifier agrees with the reviewed corpus", () => {
  const wrong: string[] = [];
  for (const [question, expected] of CORPUS) {
    const actual = Object.entries(CLASSIFIERS).filter(([, f]) => f(question)).map(([k]) => k);
    if (actual.join(",") !== expected.join(",")) wrong.push(`${JSON.stringify(question)}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
  expect(wrong, wrong.join("\n")).toEqual([]);
  expect(CORPUS.length).toBeGreaterThanOrEqual(40);
});

test("FC-199: every classifier is in the table, so a new one can't be left out", () => {
  // The columns are the whole set of text classifiers the turn uses; a new export from intent.ts or player.ts
  // that decides guidance has to be added here or this list goes stale in silence.
  expect(Object.keys(CLASSIFIERS)).toHaveLength(22);
});

test("FC-251: changing a count is asking to change the list, however it's phrased", async () => {
  const { ASKS_FOR } = await import("./intent");
  const asked = ASKS_FOR.update_list!;
  // Live 2026-09-20: said twice, dropped twice, and the answer each time was "say 'set stone-brick to 250'" —
  // the very phrase being dropped.
  for (const t of ["Set stone brick to 250.", "set stone-brick to 250", "Make it 30 ovens", "bump the belts to 400", "change stone-brick to 250", "lower the chests to 2", "Add a few belts to that list."]) {
    expect([t, asked.test(t)]).toEqual([t, true]);
  }
  // A question about the world or a recipe is not a list edit, whatever numbers are in it.
  for (const t of ["What rate are my labs really hitting?", "How many copper cables does a green circuit take?", "Set the recipe to iron gear wheel", "Do you ever miss flying?"]) {
    expect([t, asked.test(t)]).toEqual([t, false]);
  }
});
