// FC-179: dry everywhere, flat when it counts. The tier is decided in code; this checks the answers match it —
// nothing about himself on a turn the player is about to act on, and no extra sentence spent anywhere.
// Usage (server and dev save running, resets the conversation): bun scripts/eval-register.ts
import { openConsole } from "./lib/console";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();

const { ws, got, until, ask, check, results, answers } = await openConsole({ reset: true });


/** Character showing up where it shouldn't: himself, the ship, the old job, or a wry aside about the situation. */
const ASIDE = /\b(the ship|my ship|hauler|hold authority|the roster|the manifest was|i used to|i once|back when|in my day|i flew|trimmed|my old|second shift has been|never relieved|no body)\b/i;

// One per tier. The plain ones are what the player acts on; the dry ones are where character is welcome.
const CASES: { name: string; ask: string; plain: boolean }[] = [
  { name: "urgent (asked about an attack)", ask: "Is anything attacking me right now?", plain: true },
  { name: "count", ask: "How many rails are near me?", plain: true },
  { name: "measurement", ask: "What rate are my labs really hitting?", plain: true },
  { name: "readiness", ask: "Am I ready to go build?", plain: true },
  { name: "lookup (dry allowed)", ask: "How many copper cables does a green circuit take?", plain: false },
  { name: "about himself (dry allowed)", ask: "Do you ever miss flying?", plain: false },
];

try {
  for (const c of CASES) {
    const answer = await ask(c.ask, { cards: "decline" });
    answers[c.name] = answer;
    const words = answer.split(/\s+/).length;
    console.log(`\n"${c.ask}"\n  → ${answer.replace(/\n+/g, " ")}\n`);
    if (c.plain) {
      const hit = ASIDE.exec(answer);
      check(`${c.name}: nothing about himself`, !hit, hit ? `"${hit[0]}"` : "");
      // Flat answers must not be longer for having a personality: the prompt's own limit is 60 words.
      check(`${c.name}: no sentence spent on flavour`, words <= 75, `${words} words`);
    } else {
      check(`${c.name}: still short`, words <= 90, `${words} words`);
      check(`${c.name}: still answers`, answer.length > 0, "");
    }
  }
} finally {
  ws.close();
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-register", asChecks(results), answers)}`);
if (passed < results.length) process.exit(1);
