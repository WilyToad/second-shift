import { expect, test } from "bun:test";
import { failureClasses, score, wer, words } from "./compare-transcribers";

test("FC-189: word error rate is Levenshtein over words, and exact means exact", () => {
  expect(wer("okay I'm running wire", "okay I'm running wire")).toEqual({ wer: 0, errors: 0, words: 4 });
  expect(wer("okay I'm running wire", "okay I'm running wine").errors).toBe(1);
  expect(wer("I've got 10 red bottles to research automation", "Got10 red bottles to research automation").errors).toBe(3); // I've, got, 10 → Got10
  expect(wer("a bit further", "")).toEqual({ wer: 1, errors: 3, words: 3 });
  expect(score("A bit further.", "a bit further").exact).toBe(true);
  expect(words("What's the best way to get my Coal up here")).toEqual(["what's", "the", "best", "way", "to", "get", "my", "coal", "up", "here"]);
});

test("FC-189: the failure classes are the player's own mis-hears", () => {
  expect(failureClasses("okay I'm running wire", "okay I'm running wine")).toEqual(["homophone"]);
  expect(failureClasses("I see a big red dots on the map up there", "I see a big red darts on the map of there")).toEqual(expect.arrayContaining(["homophone", "function-word"]));
  expect(failureClasses("I've got 10 red bottles to research automation", "Got10 red bottles to research automation")).toContain("numeral");
  expect(failureClasses("what rate are these drills really hitting", "what rate are these drills really hitty")).toEqual(["dropped-syllable"]);
  expect(failureClasses("I've got 10 red bottles to research automation", "I've got 10 red bottles of research automation")).toEqual(["function-word"]);
  expect(failureClasses("same words", "same words")).toEqual([]);
});
