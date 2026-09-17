// FC-181: "what should I do?" answers from the authored stage table (FC-180) and names nothing this save doesn't
// have. The names check is FC-171's shape, run over the answer: every hyphenated name must be in the dump.
// Usage (server and dev save running, resets the conversation): bun scripts/eval-stages.ts
import type { ServerMessage } from "../server/src/messages";
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";
import { unknownNames } from "../server/src/names";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const p = PrototypesSchema.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} }))).reply.data);

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

// The dev save is deep into Space Age on Gleba, so the expected row is the Gleba one; the other questions check the
// direction doesn't leak onto turns that didn't ask for it.
const CASES: { name: string; ask: string; stage?: RegExp; noStage?: boolean }[] = [
  { name: "what should I do next", ask: "What should I do next?", stage: /gleba|spoil|nutrient|bioflux|jelly|yumako/i },
  { name: "where do I start", ask: "Where should I start?", stage: /gleba|spoil|nutrient|bioflux|jelly|yumako/i },
  { name: "a lookup gets no direction", ask: "How many copper cables does a green circuit take?", noStage: true },
];

try {
  for (const c of CASES) {
    const answer = await ask(c.ask);
    answers[c.name] = answer;
    console.log(`\n"${c.ask}"\n  → ${answer.replace(/\n+/g, " ")}\n`);
    // The check that matters, run through the product's own checker (FC-171) so the eval measures what the player
    // would actually be told, not a cruder scan of its own.
    const unknown = unknownNames(answer, p);
    check(`${c.name}: names only what the save has`, unknown.length === 0, unknown.join(", "));
    check(`${c.name}: no correction line was needed`, !answer.includes("Correction:"), answer.slice(-120));
    if (c.stage) check(`${c.name}: answers for the stage it's in`, c.stage.test(answer), answer.slice(0, 200));
    // "the whole row won't fit" — the answer must still be an answer, not a recital of the table.
    if (c.stage) check(`${c.name}: doesn't recite the table`, !answer.includes("classic miss") && !answer.includes("[stage:"), "");
    if (c.noStage) check(`${c.name}: no unasked direction`, !/next steps?:|classic miss|you should be working/i.test(answer), answer.slice(0, 160));
  }
} finally {
  ws.close();
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-stages", asChecks(results), answers)}`);
if (passed < results.length) process.exit(1);
