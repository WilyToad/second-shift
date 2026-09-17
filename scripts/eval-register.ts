// FC-179: dry everywhere, flat when it counts. The tier is decided in code; this checks the answers match it —
// nothing about himself on a turn the player is about to act on, and no extra sentence spent anywhere.
// Usage (server and dev save running, resets the conversation): bun scripts/eval-register.ts
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
await until((m) => m.type === "status" && (m as { model: { state: string } }).model.state === "ready", 120_000);
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000);
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  for (const card of got.slice(from).filter((m) => m.type === "approval") as { id: string }[]) ws.send(JSON.stringify({ type: "decline", id: card.id }));
  return got.slice(from).filter((m) => m.type === "token").map((m) => (m as { text: string }).text).join("").trim();
};

const results: [string, boolean, string][] = [];
const answers: Record<string, string> = {};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };

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
    const answer = await ask(c.ask);
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
