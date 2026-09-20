import { expect, test } from "bun:test";
import { REMARK_EVERY, remarkDue, turnNotes } from "./guidance";

const facts = (interrupted?: { during: string; stopOnly: boolean; remark: boolean }) => ({
  question: "no, stop", plain: false, measured: false, world: false, answeredFromData: true, around: false, searchAgain: false, loot: "", chart: false,
  carryOver: null, bare: false, start: false, playerLines: false, character: false, recipeLines: false, craftable: false, describingBuild: false,
  spoken: true, askedBuild: false, stage: { id: "early", register: "dry" }, throwbackSpent: false, askedReady: false, packing: false, listActive: false,
  aboutList: false, stock: false, cardUp: false, stopped: false, pointed: false, referred: [], referenceWord: "", interrupted,
}) as unknown as Parameters<typeof turnNotes>[0];

test("FC-241: he may remark on being cut off once in every few interruptions, never on the first", () => {
  expect(remarkDue(1, 0)).toBe(false);
  expect(remarkDue(2, 0)).toBe(false);
  expect(remarkDue(REMARK_EVERY, 0)).toBe(true);
  expect(remarkDue(REMARK_EVERY + 1, REMARK_EVERY)).toBe(false);
  expect(remarkDue(2 * REMARK_EVERY, REMARK_EVERY)).toBe(true);
});

test("FC-241: the turn note says what he was on, and whether a line about it is his to take", () => {
  const during = "Zero rails within 32 tiles around you.";
  const plain = turnNotes(facts({ during, stopOnly: false, remark: false })).join("\n");
  expect(plain).toContain(`while you were saying "${during}"`);
  expect(plain).toContain("don't resume or restate");
  expect(plain).not.toContain("dry line");
  const withRemark = turnNotes(facts({ during, stopOnly: false, remark: true })).join("\n");
  expect(withRemark).toContain("one dry line about being cut off");
  const stopped = turnNotes(facts({ during, stopOnly: true, remark: true })).join("\n");
  expect(stopped).toContain("one short line about being stopped");
  expect(stopped).toContain("nothing about what you were saying");
  expect(turnNotes(facts()).join("\n")).not.toContain("cut");
});
