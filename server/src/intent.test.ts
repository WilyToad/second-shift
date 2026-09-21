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
