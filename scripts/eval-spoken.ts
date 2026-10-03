// FC-255: answers that are heard, not read, are one idea and short. Replays the player's own spoken lines from the
// first local-voice playtest (2026-09-27, a new map, Ballast read aloud by Kokoro) as one conversation, spoken, then
// the same lines typed as a control, and compares answer lengths. The playtest's answers ran 58–129 tokens, median 84;
// the player cut in on the padding: "He seems very verbal and chatty."
// Usage (server running; the game can be closed): bun scripts/eval-spoken.ts
import { openConsole } from "./lib/console";

const PLAYTEST = [
  "Okay, I've just started.",
  "I'm walking.",
  "Okay, I made it to the coal.",
  "I think I need a chest.",
  "It's filling up.",
  "I'm on a coal spot. So it looks like it's drilling the coal out, putting the coal in the chest.",
  "I need another drill.",
  "I have no iron.",
  "I'm gonna move this drill over there for now. I have a decent amount of coal, should be fine.",
  "Looks like I also need stone for the drill.",
  "Okay, I'm going to get some stone.",
  "Okay, I made another drill. Actually, I'm gonna make two drills.",
  "What do you think of this in front of me?",
];
const PLAYTEST_MEDIAN = 84;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
// The closers the player cut in on: a line about the ship, the hold, the manifest, orbit, after the answer.
const FLOURISH = /\b(back in orbit|in orbit|the hold|manifest|hauler|my ship|on the ship)\b/i;

const c = await openConsole({ ready: true });
async function replay(spoken: boolean) {
  await c.reset();
  const lengths: number[] = [];
  const paragraphs: number[] = [];
  let flourishes = 0;
  for (const q of PLAYTEST) {
    const a = await c.askFull(q, { extra: spoken ? { spoken: true, aloud: true } : {} });
    c.answers[`${spoken ? "spoken" : "typed"}: ${q}`] = a.answer;
    // An answer stopped at its first paragraph ends the model's stream early, which then reports no count: estimate
    // those from the text the player got, at the ~4 characters a token these answers run at.
    const tokens = (a.done as { completionTokens?: number } | null)?.completionTokens || Math.ceil(a.answer.length / 4);
    lengths.push(tokens);
    paragraphs.push(a.answer.split(/\n\s*\n/).filter((p) => p.trim()).length);
    // A closer is the last sentence; a clause of his past inside one is allowed by design (FC-182).
    const sentences = a.answer.trim().split(/(?<=[.!?])\s+/);
    if (sentences.length > 1 && FLOURISH.test(sentences.at(-1)!)) { flourishes++; console.log(`    ends on a ship line: "${sentences.at(-1)}"`); }
    console.log(`  ${spoken ? "spoken" : "typed "} ${String(tokens).padStart(4)} tok  ${q.slice(0, 40).padEnd(40)} → ${a.answer.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  return { median: median(lengths), max: Math.max(...lengths), multiParagraph: paragraphs.filter((n) => n > 1).length, flourishes };
}

const spoken = await replay(true);
const typed = await replay(false);
console.log(`\nspoken: median ${spoken.median} tok, max ${spoken.max}, ${spoken.multiParagraph} with a second paragraph, ${spoken.flourishes} with a ship/orbit line`);
console.log(`typed:  median ${typed.median} tok, max ${typed.max}, ${typed.multiParagraph} with a second paragraph, ${typed.flourishes} with a ship/orbit line`);
c.check("spoken answers at least a third shorter than the playtest's (median 84 tokens)", spoken.median <= Math.floor((PLAYTEST_MEDIAN * 2) / 3), `${spoken.median} tok`);
c.check("spoken answers have no second paragraph", spoken.multiParagraph === 0, `${spoken.multiParagraph} of ${PLAYTEST.length}`);
c.check("spoken answers don't end on a ship or orbit line", spoken.flourishes === 0, `${spoken.flourishes} of ${PLAYTEST.length}`);
c.check("typed answers keep their length (no shorter than two thirds of the playtest's)", typed.median >= Math.floor((PLAYTEST_MEDIAN * 2) / 3), `${typed.median} tok`);
await c.finish("eval-spoken");
