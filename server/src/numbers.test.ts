import { expect, test } from "bun:test";
import { arithmeticCorrections } from "./numbers";

test("FC-153: wrong arithmetic written out in an answer gets a correction", () => {
  expect(arithmeticCorrections("7 × 25,000 = 1,250,000 capacity total")).toEqual(["Correction: 7 × 25,000 = 175,000, not 1,250,000."]);
  expect(arithmeticCorrections("that's 7 x 25000 is 175000")).toEqual([]);
  expect(arithmeticCorrections("60 / 1.5 = 40 machines, plus 12 + 30 = 42 belts")).toEqual([]);
  expect(arithmeticCorrections("12 + 30 = 41")).toEqual(["Correction: 12 + 30 = 42, not 41."]);
  expect(arithmeticCorrections("150 ÷ 60 is about 2.5")).toEqual([]);
  expect(arithmeticCorrections("0.42 × 120 ≈ 50")).toEqual([]);
  expect(arithmeticCorrections("**7** × **25,000** = **1,250,000**")).toHaveLength(1);
});

test("FC-153: recipes, ranges and names aren't read as arithmetic", () => {
  for (const text of [
    "Electronic circuit: 1 iron-plate + 3 copper-cable → 1 circuit, 0.5 s.",
    "Bioflux is made from 15 yumako-mash + 12 jelly → 4 bioflux in 6 s",
    "cargo-bays 11–14 tiles north-east",
    "0.5× biochamber for 60/min bioflux",
    "assembling-machine-3 x 2 is what you need",
    "assembling-machine-3 x 2 = 6 slots",
  ]) expect(arithmeticCorrections(text)).toEqual([]);
});
