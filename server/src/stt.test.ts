import { expect, test } from "bun:test";
import { looksInvented, loudness, QUIET } from "./stt";
import { normalizeNames } from "./normalize-names";

test("FC-230: Whisper's silence inventions are refused, real text isn't", () => {
  for (const t of ["Thank you.", "thank you", "Thanks for watching!", "Subtitles by the Amara.org community", "", "  ", "you."]) expect(looksInvented(t)).toBe(true);
  for (const t of ["Okay, I'm running wire.", "Thank you, now queue automation.", "You have 5 iron plates."]) expect(looksInvented(t)).toBe(false);
});

test("FC-230: a quiet clip is the room, not the player", () => {
  const header = new Uint8Array(44);
  const silent = new Uint8Array(44 + 32000); // a second of zeros
  expect(loudness(silent)).toBe(0);
  const loud = new Uint8Array(44 + 32000);
  const view = new DataView(loud.buffer);
  for (let i = 0; i < 16000; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 8000), true);
  expect(loudness(loud)).toBeGreaterThan(QUIET);
  expect(loudness(header)).toBe(0);
});

test("FC-230: the save's names are put back the way the save spells them", () => {
  const phrases = ["spidertron", "roboport", "transport belt", "iron gear wheel", "space platform", "space platform foundation", "belt"];
  // The three FC-189 misses that a normalizer can fix.
  expect(normalizeNames("Send the Spider-Tron to the ore patch.", phrases)).toBe("Send the spidertron to the ore patch.");
  expect(normalizeNames("send the spider tron to the nearest robo port", phrases)).toBe("send the spidertron to the nearest roboport");
  expect(normalizeNames("Send the SpyderTron to the nearest RoboPort.", phrases)).toBe("Send the SpyderTron to the nearest roboport.");
  // Longest run wins, punctuation survives, and plain English words are left alone.
  expect(normalizeNames("Stock space platform foundation deep, then belts.", phrases)).toBe("Stock space platform foundation deep, then belts.");
  expect(normalizeNames("Two hundred belt, arms to feed them.", phrases)).toBe("Two hundred belt, arms to feed them.");
  expect(normalizeNames("An Iron-Gear-Wheel costs two plates.", phrases)).toBe("An iron gear wheel costs two plates.");
  expect(normalizeNames("nothing to do here", [])).toBe("nothing to do here");
  // A near miss of a long name, from the first live clip: "spider train". Short names never get this treatment.
  expect(normalizeNames("Where is this spider train?", phrases)).toBe("Where is this spidertron?");
  expect(normalizeNames("Whereas the spider charm", phrases)).toBe("Whereas the spider charm");
  expect(normalizeNames("the iron plant is busy", [...phrases, "iron plate"])).toBe("the iron plant is busy");
});
