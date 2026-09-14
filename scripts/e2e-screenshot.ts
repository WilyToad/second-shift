// FC-049 through the real server: asking for a picture of the player's spot shows a real image in chat.
// Needs bun run start + the dev save hosted.
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
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
await until((m) => m.type === "status" && m.model.state === "ready", 180_000);
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000, got.length);
const from = got.length;
const started = performance.now();
ws.send(JSON.stringify({ type: "ask", text: "Show me a screenshot of where I'm standing" }));
await until((m) => m.type === "done" || m.type === "error", 120_000, from);
const slice = got.slice(from);
const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
const image = slice.find((m) => m.type === "image");
check("the page gets a screenshot", image?.type === "image", `${image?.type === "image" ? image.caption : "no image"} | ${answer.slice(0, 200)} [${((performance.now() - started) / 1000).toFixed(1)} s]`);
if (image?.type === "image") {
  const res = await fetch(`http://127.0.0.1:5170${image.url}`);
  const bytes = (await res.arrayBuffer()).byteLength;
  check("the server serves it as a JPEG", res.status === 200 && res.headers.get("content-type") === "image/jpeg" && bytes > 20_000, `${res.status}, ${(bytes / 1024).toFixed(0)} KB`);
}
const bad = await fetch("http://127.0.0.1:5170/shots/..%2F..%2Fconfig%2Fconfig.ini");
check("only screenshot names are served", bad.status === 404, String(bad.status));
check("the answer doesn't pretend to describe the picture", !/\b(I can see|in the (image|picture|screenshot),? (there|I|you))\b/i.test(answer), answer.slice(0, 300));
ws.close();
await saveEvalRun("screenshot", asChecks(results), { answer });
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
