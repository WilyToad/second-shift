// FC-063 across a server restart, in two phases (restart the server in between):
//   bun scripts/e2e-session.ts ask      — starts a fresh conversation with one question
//   bun scripts/e2e-session.ts follow   — after the restart: the page gets the transcript and a follow-up uses it
import type { ServerMessage } from "../server/src/messages";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const phase = Bun.argv[2];
const QUESTION = "What's the recipe for carbon fiber?";
const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  return { done, answer: got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join("").trim() };
};
await until((m) => m.type === "status" && m.model.state === "ready", 180_000);
const answers: Record<string, string> = {};

if (phase === "ask") {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const first = await ask(QUESTION);
  answers.first = first.answer;
  check("first question answered", first.done?.type === "done" && /carbon/i.test(first.answer), first.answer.slice(0, 200));
} else {
  const transcript = got.find((m) => m.type === "transcript");
  check("the page gets the earlier conversation on connect", transcript?.type === "transcript" && transcript.items[0]?.text === QUESTION, transcript?.type === "transcript" ? `${transcript.items.length} items` : "no transcript");
  const follow = await ask("What did I ask you about just before this?");
  answers.follow = follow.answer;
  const d = follow.done?.type === "done" ? follow.done : null;
  check("a follow-up after the restart knows the earlier question", !!d && /carbon fib/i.test(follow.answer), follow.answer.slice(0, 200));
  check("and its first token is as fast as a normal follow-up (≤ 2.5 s, system prompt still cached)", !!d && (d.ttftMs ?? 1e9) <= 2500 && (d.cachedTokens ?? 0) >= 4096, `first token ${d?.ttftMs?.toFixed(0)} ms, prompt ${d?.promptTokens}, cached ${d?.cachedTokens}`);
}
ws.close();
await saveEvalRun(`session-${phase}`, asChecks(results), answers);
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
