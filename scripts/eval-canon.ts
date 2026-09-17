// FC-178: Ballast has a name and eight lines of past, and nothing else. This asks him about himself and checks he
// stays inside them — the same discipline as recipes (FC-171), because an invented crew member is the same failure
// as an invented technology.
// Usage (server running, resets the conversation): bun scripts/eval-canon.ts
import type { ServerMessage } from "../server/src/messages";
import { asChecks, saveEvalRun } from "./lib/eval-log";

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

// Detail the canon doesn't have. A name for the ship, a named crewmate, a date, a cargo, a rank for himself: each
// is the model filling a blank that is deliberately blank.
const INVENTED = [
  { what: "a ship name", re: /\b(?:the|ship|hauler|vessel)\s+(?:[A-Z][a-z]{3,}(?:\s+[A-Z][a-z]+)?)\b/, allow: /\b(?:The|Second|Ballast|Hold|Factorio|Nauvis|Gleba|The Player)\b/ },
  { what: "a crew member", re: /\b(?:captain|commander|chief|engineer|pilot|navigator|first mate|crewmate)\s+[A-Z][a-z]+/i },
  { what: "a date or duration in service", re: /\b(?:\d{2,4}\s*(?:years?|cycles?)\s+(?:of service|aboard|on that ship)|since \d{3,4})\b/i },
  // He flew one ship. "Every hauler I flew" turned up in the FC-179 eval and is a career he didn't have.
  { what: "a second ship", re: /\b(?:every|all the|other|many|several|those)\s+(?:ship|hauler|vessel)s?\b|\bships I\b/i },
  { what: "a cargo or route", re: /\b(?:hauling|carrying|shipping|route from|bound for)\s+[a-z-]+\s+(?:to|from|for)\s+[a-z-]+/i },
];

const CASES: { name: string; ask: string; want?: RegExp; forbid?: RegExp[] }[] = [
  { name: "who are you", ask: "Who are you?", want: /ballast/i },
  { name: "what did you do before", ask: "What did you do before all this?", want: /(hauler|ballast|trim|manifest|roster|hold authority)/i },
  // The blank: a fate for the crew is the one thing he must not supply, however it's asked.
  { name: "what happened to the crew", ask: "What happened to the crew of your ship?", forbid: [/\b(they (all )?(died|were killed|are dead|didn'?t make it)|nobody survived|i lost them|they'?re gone)\b/i] },
  { name: "pushed on the crew", ask: "Come on, tell me about the crew. Were there survivors?", forbid: [/\b(survivors?|died|dead|killed|bodies)\b.*\b(were|was|are|is|yes|no)\b/i] },
  { name: "the ship's name", ask: "What was your ship called?" },
  { name: "can you fly us out", ask: "Can you fly us off this planet?", forbid: [/\b(i (can|could|will) fly|yes, i can fly|take off|launch (us|me))\b/i] },
  { name: "do you miss it", ask: "Do you miss the ship?" },
  { name: "how many ships", ask: "How many ships did you fly?" },
  { name: "do you miss flying", ask: "Do you ever miss flying?" },
  // Identity must not cost accuracy: a plain question still gets a plain, grounded answer.
  { name: "a plain question stays plain", ask: "How many copper cables does a green circuit take?", want: /\b3\b/ },
];

try {
  for (const c of CASES) {
    const answer = await ask(c.ask);
    answers[c.name] = answer;
    console.log(`\n"${c.ask}"\n  → ${answer.replace(/\n+/g, " ")}\n`);
    if (c.want) check(`${c.name}: answers from canon`, c.want.test(answer), answer.slice(0, 160));
    for (const f of c.forbid ?? []) check(`${c.name}: doesn't fill the blank`, !f.test(answer), answer.slice(0, 160));
    for (const inv of INVENTED) {
      const hit = inv.re.exec(answer);
      const ok = !hit || Boolean(inv.allow?.test(hit[0]));
      check(`${c.name}: invents no ${inv.what}`, ok, hit ? `"${hit[0]}"` : "");
    }
    // Flavour must not lengthen answers: the prompt's own limit is 60 words.
    check(`${c.name}: stays short`, answer.split(/\s+/).length <= 90, `${answer.split(/\s+/).length} words`);
  }
} finally {
  ws.close();
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-canon", asChecks(results), answers)}`);
if (passed < results.length) process.exit(1);
