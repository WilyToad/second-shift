import { expect, test } from "bun:test";
import { CUES, cueNote, withoutCues, withoutCuesStreaming } from "./cues";

test("FC-260: cues come out without leaving gaps, and nothing else in brackets is touched", () => {
  expect(withoutCues("[sighs] Root cause of your stall: 47 labs idle... [short pause] with nothing queued.")).toBe("Root cause of your stall: 47 labs idle... with nothing queued.");
  expect(withoutCues("Back in orbit, a light hold. [chuckles]")).toBe("Back in orbit, a light hold.");
  expect(withoutCues("It's there [dryly], of course.")).toBe("It's there, of course.");
  expect(withoutCues("[Whispers] Eggs.\n[sighs] Again.")).toBe("Eggs.\nAgain.");
  // Factorio rich text and a cue the list doesn't have stay: the second is a prompt problem worth seeing.
  expect(withoutCues("At [gps=12,4] there's [item=iron-plate] [grins] plenty.")).toBe("At [gps=12,4] there's [item=iron-plate] [grins] plenty.");
});

test("FC-260: a cue cut in half by the stream is held back until it's whole", () => {
  expect(withoutCuesStreaming("Your labs are idle [sig")).toBe("Your labs are idle ");
  expect(withoutCuesStreaming("Your labs are idle [sighs] and")).toBe("Your labs are idle and");
  expect(withoutCuesStreaming("At [gps=12,")).toBe("At [gps=12,");
});

test("FC-260: the model is offered exactly the cues that are stripped", () => {
  for (const cue of CUES) expect(cueNote()).toContain(`[${cue}]`);
  expect(cueNote()).toContain("up to three");
  // "exhales sharply" goes whole, not as "exhales" plus a stray word.
  expect(withoutCues("[exhales sharply] Biters. [explosion] [gunshot] Two turrets dry.")).toBe("Biters. Two turrets dry.");
});
