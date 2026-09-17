import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { nameCorrections, unknownNames } from "./names";

const real = PrototypesSchema.parse(await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json());

test("FC-171: the name from the player's own session is caught", () => {
  // Verbatim shape of the answer that started this item (2026-09-17).
  const answer = "Walls and turrets need the defensive-structures research first, then you can place stone-wall and gun-turret.";
  expect(unknownNames(answer, real)).toEqual(["defensive-structures"]);
  expect(nameCorrections(answer, real)[0]).toBe('Correction: this save has no "defensive-structures" — I shouldn\'t have named it.');
});

test("FC-171: it stays quiet on everything the save does have, however it's written", () => {
  const fine = [
    "3 copper-cable and 1 iron-plate make an electronic-circuit in an assembling-machine-1.",
    "Feed the biochamber with nutrients before the yumako-mash spoils.",
    // Plurals, either direction.
    "Two transport-belts and three long-handed-inserters.",
    // A name the dump only has inside a technology's trigger.
    "Mine a big-volcanic-rock for tungsten-carbide.",
    // Ordinary hyphenated English.
    "Stop hand-carrying coal; the belt is a dead-end without an inserter.",
    // The one the earlier scan tripped on: a real name the regex could split.
    "Use pipe-to-ground to cross the lane.",
    "It's read-only, and up-to-date as of now.",
    // The family name with the tier as a separate word, which is how a person writes it.
    "Made in assembling-machine 1–3, or by hand.",
    "A transport-belt or two, and an electric-mining-drill.",
  ];
  for (const text of fine) expect(unknownNames(text, real)).toEqual([]);
  expect(nameCorrections("You have 3 iron-plate.", real)).toEqual([]);
  // No dump: nothing to check against, so nothing is claimed.
  expect(unknownNames("the defensive-structures research", null)).toEqual([]);
});

test("FC-171: several inventions are named once each, and the line stays short", () => {
  const answer = "Research defensive-structures, then craft a quantum-widget, build a flux-capacitor, and research defensive-structures again to unlock the warp-core recipe.";
  expect(unknownNames(answer, real)).toEqual(["defensive-structures", "quantum-widget", "flux-capacitor", "warp-core"]);
  expect(nameCorrections(answer, real)[0]).toBe('Correction: this save has no "defensive-structures", "quantum-widget", "flux-capacitor" (and 1 more) — I shouldn\'t have named them.');
});

test("FC-171: a turn of phrase is never corrected, and framing is what makes the difference", () => {
  // All three were corrected by the first version of this check, in real eval runs (2026-09-17). Ordinary
  // hyphenated English is now known as English, so nothing is reported and nothing is said.
  for (const text of [
    "Spoilage as a fuel is an insult to a well-run hold. What's short on gleba?",
    "Off-world means a rocket-silo, a cargo-landing-pad, and cargo that survives the trip.",
    "Hand-mine an iron-stromatolite to start agriculture.",
  ]) {
    expect(unknownNames(text, real)).toEqual([]);
    expect(nameCorrections(text, real)).toEqual([]);
  }

  // A name the save really doesn't have is reported by the scan either way...
  const loose = "The warp-core was a turn of phrase, nothing more.";
  expect(unknownNames(loose, real)).toEqual(["warp-core"]);
  // ...but the player is only told about it when it was used as a thing this save would have.
  expect(nameCorrections(loose, real)).toEqual([]);
  expect(nameCorrections("Research the warp-core technology first.", real)[0]).toContain('no "warp-core"');
  // The cue has to be adjacent: a sentence that merely mentions research elsewhere doesn't vouch for it.
  expect(nameCorrections("Nothing is researching right now, so the warp-core was mostly a joke.", real)).toEqual([]);
});

test("FC-171: the names a technology triggers on count as names the save has", () => {
  // The dump writes a trigger's item or entity as `{ name }`, not as a string: the first version of this check
  // pushed those objects into the known set, so a trigger-only name would have been called an invention.
  const { knownNames } = require("./names") as typeof import("./names");
  const known = knownNames(real);
  expect([...known].every((n) => typeof n === "string")).toBe(true);
  for (const triggered of ["big-volcanic-rock", "fulgoran-ruin-vault", "iron-stromatolite", "lithium-iceberg-big"]) {
    expect(known.has(triggered)).toBe(true);
  }
});
