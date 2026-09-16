// FC-144/FC-051 through the real server: asking for the spidertron puts up a card, confirming it sends it with the
// game's own autopilot, and "stop" takes it back. Server and dev save running; resets the conversation.
// Test tooling makes a spidertron and a remote next to the player and removes them after.
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const setup = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface local at = p.physical_position
  if #s.find_entities_filtered({ type = "spider-vehicle", force = p.force }) > 0 then rcon.print(helpers.table_to_json({ error = "a spidertron is already here; test skipped" })) return end
  local pos = s.find_non_colliding_position("spidertron", { x = at.x + 6, y = at.y }, 30, 1)
  local e = pos and s.create_entity({ name = "spidertron", position = pos, force = p.force })
  local inv = p.get_main_inventory()
  local had = inv.get_item_count("spidertron-remote") > 0
  if not had then inv.insert({ name = "spidertron-remote", count = 1 }) end
  rcon.print(helpers.table_to_json({ made = e ~= nil, had_remote = had }))`));
if (setup.error) { console.log(setup.error); dev.rcon.close(); process.exit(0); }
const spider = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1]
  local s = p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })[1]
  rcon.print(helpers.table_to_json(s and { walking = s.autopilot_destination ~= nil } or {}))`));

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
  console.log(`\n> ${text}\n${answer}`);
  return { answer, card: slice.find((m) => m.type === "approval") as any, slice };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const answers: Record<string, string> = {};

try {
  const asked = await ask("Can you walk my spidertron over here to me?");
  answers["send"] = asked.answer;
  check("asking puts up a card and moves nothing yet", Boolean(asked.card) && (await spider()).walking === false, asked.card ? asked.card.title : "no card");
  if (asked.card) {
    const from = got.length;
    ws.send(JSON.stringify({ type: "approve", id: asked.card.id }));
    const done = (await until((m) => m.type === "approval_result", 60_000, from)) as any;
    const walking = (await spider()).walking;
    check("confirming sends it with the game's own autopilot", done?.status === "done" && walking === true, `${done?.status}: ${done?.message}`);
  }
  const stopped = await ask("stop");
  answers["stop"] = stopped.answer;
  check("\"stop\" takes it back", (await spider()).walking === false, stopped.answer.slice(0, 160));
  check("the answer says it stopped", /stop/i.test(stopped.answer), stopped.answer.slice(0, 160));
} finally {
  ws.close();
  await dev.sc(`local p = game.connected_players[1]
    for _, s in pairs(p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })) do s.destroy() end
    local inv = p.get_main_inventory()
    ${setup.had_remote ? "" : `inv.remove({ name = "spidertron-remote", count = 64 })`}
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("e2e-spidertron", asChecks(results), answers)}`);
process.exit(failed.length ? 1 : 0);
