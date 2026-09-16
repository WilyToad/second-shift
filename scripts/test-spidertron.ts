// FC-144/FC-051: sending the player's spidertron, and taking it back. Runs against the hosted dev save; test
// tooling creates a spidertron and a remote next to the player and removes them after.
// Usage: bun scripts/test-spidertron.ts
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
let id = 1;
const call = async (action: string, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile: true })));
  const data = reply.ok && action in actions ? actions[action as ActionName].data.parse(reply.data) : reply.data;
  return { ...reply, data: data as any, profile };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const spider = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1]
  local s = p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })[1]
  rcon.print(helpers.table_to_json(s and { name = s.name, x = s.position.x, y = s.position.y, speed = s.speed, walking = s.autopilot_destination ~= nil,
    goal = s.autopilot_destination and { x = s.autopilot_destination.x, y = s.autopilot_destination.y } or nil } or {}))`));

await dev.leaveRemoteView();
// Setup: the player's own spidertron and a remote in their inventory.
const setup = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface local at = p.physical_position
  local existing = s.find_entities_filtered({ type = "spider-vehicle", force = p.force })
  if #existing > 0 then rcon.print(helpers.table_to_json({ error = "the save already has a spidertron here; test skipped to leave it alone" })) return end
  local pos = s.find_non_colliding_position("spidertron", { x = at.x + 6, y = at.y }, 30, 1)
  local e = pos and s.create_entity({ name = "spidertron", position = pos, force = p.force })
  local inv = p.get_main_inventory()
  local had_remote = inv.get_item_count("spidertron-remote") > 0
  if not had_remote then inv.insert({ name = "spidertron-remote", count = 1 }) end
  rcon.print(helpers.table_to_json({ made = e ~= nil, x = e and e.position.x, y = e and e.position.y, had_remote = had_remote }))`));
if (setup.error) { console.log(setup.error); dev.rcon.close(); process.exit(0); }
check("setup: a spidertron and a remote next to the player", setup.made === true, `at (${setup.x}, ${setup.y})`);

try {
  const list = await call("spidertrons");
  check("spidertrons lists the player's own, with the remote they carry", list.ok && list.data.total === 1 && list.data.has_remote === true && list.data.spidertrons[0].driver === false,
    `${list.data?.total} listed, remote ${list.data?.has_remote}, ${list.profile}`);

  // Send it a few tiles away and watch the game take the order.
  const goal = { x: Math.round(setup.x) + 8, y: Math.round(setup.y) };
  const sent = await call("send_spidertron", goal);
  const after = await spider();
  check("send_spidertron hands the spot to the game's own autopilot", sent.ok && after.walking === true && Math.round(after.goal.x) === goal.x,
    `${JSON.stringify(sent.data)}; game says walking to ${JSON.stringify(after.goal)}`);

  // The stop key: the order goes, the autopilot is cleared, and the console hears about it.
  const seq = (await call("events", { since: 0 })).data.seq as number;
  const stopped = await call("debug_press_stop");
  const afterStop = await spider();
  const feed = await call("events", { since: seq });
  const stopEvent = (feed.data.events as any[]).find((e) => e.kind === "control_stopped");
  check("the stop key clears the order and says why", stopped.data.stopped === true && afterStop.walking === false && stopEvent?.reason === "stop_key",
    `walking ${afterStop.walking}, event ${JSON.stringify(stopEvent ?? null)}`);
  const nothing = await call("stop_control");
  check("stopping with nothing moving says so instead of failing", nothing.ok && nothing.data.stopped === false, JSON.stringify(nothing.data));

  // It really walks there, and arrival is reported once.
  const seq2 = (await call("events", { since: 0 })).data.seq as number;
  const near = { x: Math.round(setup.x) + 3, y: Math.round(setup.y) + 3 };
  await call("send_spidertron", near);
  let arrived: any = null;
  for (let i = 0; i < 40 && !arrived; i++) {
    await Bun.sleep(500);
    arrived = ((await call("events", { since: seq2 })).data.events as any[]).find((e) => e.kind === "control_arrived");
  }
  const atGoal = await spider();
  check("it walks there and arrival is reported", Boolean(arrived) && Math.hypot(atGoal.x - near.x, atGoal.y - near.y) < 4,
    `arrived ${JSON.stringify(arrived ?? null)}, now at (${atGoal.x?.toFixed(1)}, ${atGoal.y?.toFixed(1)})`);

  // Helmet: refusals the player's own limits imply.
  const uncharted = await call("send_spidertron", { x: Math.round(setup.x) + 8000, y: Math.round(setup.y) });
  check("refuses a spot that isn't on the player's map", !uncharted.ok && ["not_charted", "too_far"].includes(uncharted.error?.code ?? ""), uncharted.error?.code ?? "");
  const other = await call("send_spidertron", { ...goal, surface: "some-other-surface" });
  check("refuses another surface", !other.ok && other.error?.code === "other_surface", other.error?.code ?? "");
  await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })[1] s.set_driver(p) rcon.print("in")`);
  const driven = await call("send_spidertron", goal);
  await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })[1] s.set_driver(nil) rcon.print("out")`);
  check("refuses a spidertron someone is driving", !driven.ok && driven.error?.code === "someone_driving", driven.error?.code ?? "");
  await dev.sc(`local inv = game.connected_players[1].get_main_inventory() inv.remove({ name = "spidertron-remote", count = 64 }) rcon.print("took the remote")`);
  const noRemote = await call("send_spidertron", goal);
  check("refuses when the player carries no remote (they couldn't send it either)", !noRemote.ok && noRemote.error?.code === "no_remote", noRemote.error?.code ?? "");
} finally {
  // Clean up: the test's spidertron goes, and the remote only if the test added it.
  await dev.sc(`local p = game.connected_players[1]
    for _, s in pairs(p.physical_surface.find_entities_filtered({ type = "spider-vehicle", force = p.force })) do s.destroy() end
    local inv = p.get_main_inventory()
    ${setup.had_remote ? `if inv.get_item_count("spidertron-remote") == 0 then inv.insert({ name = "spidertron-remote", count = 1 }) end` : `inv.remove({ name = "spidertron-remote", count = 64 })`}
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("test-spidertron", asChecks(results), {})}`);
process.exit(failed.length ? 1 : 0);
