// FC-046 through the real server: a selection (made by test tooling with the same capture code the tool uses)
// is fetched and reviewed in chat without the player typing. Needs bun run start + the dev save hosted.
import { encodeCommand, parseReply } from "../interfaces/src/index";
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
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
const call = async (action: string, args: Record<string, unknown>) => parseReply(await dev.rcon.exec(encodeCommand({ id: Date.now(), action, args }))).reply;

await until((m) => m.type === "status" && m.model.state === "ready", 120_000);
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000, got.length);

const from = got.length;
const started = performance.now();
const selected = await call("debug_select_area", { radius: 12 });
const seq = (selected.data as { seq: number; count: number }).seq, count = (selected.data as { count: number }).count;
check("the capture finds entities around the player", selected.ok && count > 0, JSON.stringify(selected.data));
const feed = await until((m) => m.type === "events" && m.events.some((e) => e.kind === "selection" && e.seq === seq), 5000, from);
check("the alert feed announces the selection", feed !== null);
const user = await until((m) => m.type === "user", 10_000, from);
const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
const slice = got.slice(from);
const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
check("a review starts on its own, with a placeholder instead of the string", user?.type === "user" && user.text === "Review the build I just selected: [blueprint 1]", user?.type === "user" ? user.text : "no user message");
const card = slice.find((m) => m.type === "blueprint");
check("the page gets the layout sketch of the selection", card?.type === "blueprint" && card.blueprint.sketch.length === Math.min(count, 4000), card?.type === "blueprint" ? `${card.blueprint.sketch.length} drawn` : "no card");
check("the answer gives the entity count", done?.type === "done" && answer.includes(String(count)), `${answer} [${((performance.now() - started) / 1000).toFixed(1)} s]`);
check("it doesn't offer to paste a build that already exists", !/\b(paste|ghosts?)\b/i.test(answer));
const stale = await call("get_selection", { seq: seq - 1 });
check("an older selection can't be fetched", !stale.ok && stale.error?.code === "not_found");

ws.close();
dev.rcon.close();
await saveEvalRun("selection", asChecks(results), { review: answer });
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
