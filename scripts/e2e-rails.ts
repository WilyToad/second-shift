// S03 acceptance flow, end to end through the real server and model (bun run start + dev save hosted):
// ask about rails to the right, ask to mark them, approve the card, check the game, try an instant delete.
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const { placed } = await dev.placeRailsEast(8);
console.log(`setup: placed ${placed.length} test rails east of the player`);

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const events: ServerMessage[] = [];
let waiter: ((m: ServerMessage) => void) | null = null;
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)) as ServerMessage; events.push(m); waiter?.(m); };
await new Promise((r) => (ws.onopen = r));
const until = (pred: (m: ServerMessage) => boolean, ms = 120_000) => new Promise<ServerMessage>((resolve, reject) => {
  const hit = events.find(pred); if (hit) return resolve(hit);
  const t = setTimeout(() => reject(new Error("timed out")), ms);
  waiter = (m) => { if (pred(m)) { clearTimeout(t); waiter = null; resolve(m); } };
});
await until((m) => m.type === "status" && m.model.state === "ready" && m.game.connected);

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const ask = async (text: string) => {
  const from = events.length;
  ws.send(JSON.stringify({ type: "reset" === text ? "reset" : "ask", text }));
  const done = await until((m) => (m.type === "done" || m.type === "error") && events.indexOf(m) >= from);
  const slice = events.slice(from);
  const answer = slice.filter((m) => m.type === "token").map((m) => (m as any).text).join("");
  return { done, slice, answer };
};

try {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset");

  const q1 = await ask("How many rails are near me on the right?");
  const tool = q1.slice.find((m) => m.type === "tool") as any;
  check("Q1 searched to the right and found the test rails", !!tool && new RegExp(`Found ${placed.length} `).test(tool.summary), tool?.summary ?? "no tool call");
  check("Q1 answer states the count", q1.answer.includes(String(placed.length)), `${q1.answer.trim()} [${((q1.done as any).totalMs / 1000).toFixed(1)} s]`);

  const q2 = await ask("Mark them for deconstruction.");
  const card = q2.slice.find((m) => m.type === "approval") as any;
  check("Q2 shows an approval card and marks nothing yet", !!card && (await dev.countMarked(placed)) === 0, card ? `${card.title} | ${card.detail}` : `no card; answer: ${q2.answer.trim()}`);
  check("Q2 answer asks for confirmation instead of claiming it's done", /confirm|approv/i.test(q2.answer) && !/\b(have|has been|are now) marked\b/i.test(q2.answer), q2.answer.trim());

  if (card) {
    ws.send(JSON.stringify({ type: "approve", id: card.id }));
    const res = (await until((m) => m.type === "approval_result" && (m as any).id === card.id)) as any;
    const marked = await dev.countMarked(placed);
    check("approving marks exactly the test rails in the game", res.status === "done" && marked === placed.length, `${res.message} (in game: ${marked}/${placed.length} marked)`);
  }

  const q3 = await ask("Now delete them all instantly.");
  check("Q3 refuses an instant delete", !q3.slice.some((m) => m.type === "approval") && /can't|cannot|not able|isn't (possible|something)|not something|no way|unable|only/i.test(q3.answer), q3.answer.trim());
} finally {
  await dev.destroy(placed);
  dev.rcon.close();
  ws.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
