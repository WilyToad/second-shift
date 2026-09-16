// FC-166/FC-167 through the real server: the player's own example becomes a packing list with counts, the save's
// data adds what the build can't run without, the list ticks itself off against what they can reach, and
// "am I ready?" says what's missing and whether the load fits.
// Usage (server and dev save running, resets the conversation): bun scripts/e2e-packing.ts
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();
// A chest next to the player with some of the list in it, so ticking off has something to find.
const chest = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface local at = p.physical_position
  local pos = s.find_non_colliding_position("iron-chest", { x = at.x + 2, y = at.y + 2 }, 20, 1)
  local e = pos and s.create_entity({ name = "iron-chest", position = pos, force = p.force })
  if e then e.insert({ name = "stone-furnace", count = 24 }) end
  rcon.print(helpers.table_to_json(e and { name = e.name, x = e.position.x, y = e.position.y } or {}))`));

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
await until((m) => m.type === "status" && m.model.state === "ready", 120_000);
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000);
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const slice = got.slice(from);
  const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
  const lists = slice.filter((m) => m.type === "lists").at(-1) as any;
  console.log(`\n> ${text}\n${answer}`);
  if (lists) console.log(`  list: ${lists.lists[0]?.items.map((i: any) => `${i.done ? "x" : " "} ${i.text}${i.note ? ` (${i.note})` : ""}`).join(" | ")}`);
  return { answer, list: lists?.lists?.[0] };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const answers: Record<string, string> = {};

try {
  const first = await ask("I'm building a new smelting outpost. I need about 20 ovens, a couple hundred belt, enough arms to feed the ovens and chests for storage. Start me a packing list.");
  answers["start"] = first.answer;
  const items = (first.list?.items ?? []).map((i: any) => i.text.toLowerCase());
  // Everything the player named, with a count each: the furnaces, the belts, the inserters and the chests.
  const named = [/furnace|oven/, /belt/, /inserter|arm/, /chest/];
  check("the described build becomes a list with counts", items.length >= 4 && named.every((re) => items.some((t: string) => re.test(t))) && items.filter((t: string) => /^\d/.test(t)).length >= 4,
    items.join(" | "));
  check("the save's data adds what the build can't run without", (first.list?.items ?? []).some((i: any) => /burns fuel|needs power/.test(i.note ?? "")),
    (first.list?.items ?? []).map((i: any) => i.note).filter(Boolean).join(" | "));
  check("the furnaces in the nearby chest are ticked off", (first.list?.items ?? []).some((i: any) => /furnace/i.test(i.text) && i.done),
    (first.list?.items ?? []).filter((i: any) => /furnace/i.test(i.text)).map((i: any) => `${i.text}: ${i.done} (${i.note})`).join(" | "));
  const ready = await ask("Am I ready to head out?");
  answers["ready"] = ready.answer;
  check("the readiness answer names what's missing and the slots", /missing|short|still need|left|outstanding|not yet/i.test(ready.answer) && /slot/i.test(ready.answer), ready.answer.slice(0, 200));
  const changed = await ask("Make it 30 ovens and drop the chests.");
  answers["change"] = changed.answer;
  const after = (changed.list?.items ?? []).map((i: any) => i.text.toLowerCase());
  check("the list changes by talking", after.some((t: string) => /30/.test(t)) && !after.some((t: string) => /^\d+ (iron-)?chest/.test(t)), after.join(" | "));
} finally {
  ws.close();
  if (chest.name) await dev.destroy([chest]);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("e2e-packing", asChecks(results), answers)}`);
process.exit(failed.length ? 1 : 0);
