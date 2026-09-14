// S08: in-game helmet tests for planning actions on the hosted dev save. Setup/cleanup use /sc (test tooling).
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { encodeBlueprintString } from "../server/src/blueprint";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
let id = 1;
const call = async (action: ActionName, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile: true })));
  return { ...reply, data: reply.ok ? actions[action].data.parse(reply.data) as any : undefined, profile };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sc = dev.sc;

const originalQueue = await sc(`local q = {} for _, t in pairs(game.forces.player.research_queue or {}) do q[#q+1] = t.name end rcon.print(helpers.table_to_json(q))`);
const picks = JSON.parse(await sc(`
  local f = game.forces.player local out = {}
  for name, t in pairs(f.technologies) do
    if t.enabled and not t.prototype.hidden then
      local ready = true for _, p in pairs(t.prerequisites) do if not p.researched then ready = false end end
      if not t.researched and ready and not t.prototype.research_trigger and not out.ready then out.ready = name end
      if not t.researched and not ready and not out.blocked then out.blocked = name end
      if t.researched and not out.done then out.done = name end
      if not t.researched and t.prototype.research_trigger and not out.trigger then out.trigger = name end
    end
  end
  rcon.print(helpers.table_to_json(out))`));
const placed: { belts: { name: string; x: number; y: number }[] } = { belts: [] };

try {
  // --- research
  const q = await call("queue_research", { technology: picks.ready });
  check("queues a researchable technology", q.ok && q.data.queue.includes(picks.ready), `${picks.ready}; ${q.profile}`);
  const again = await call("queue_research", { technology: picks.ready });
  check("refuses a technology already in the queue", !again.ok && again.error?.code === "already_queued");
  const blocked = await call("queue_research", { technology: picks.blocked });
  check("refuses when prerequisites are missing and names them", !blocked.ok && blocked.error?.code === "missing_prerequisites", blocked.error?.message ?? "");
  const done = await call("queue_research", { technology: picks.done });
  check("refuses an already researched technology", !done.ok && done.error?.code === "already_researched");
  if (picks.trigger) {
    const trig = await call("queue_research", { technology: picks.trigger });
    check("refuses a trigger technology (not researched by labs)", !trig.ok && trig.error?.code === "trigger_technology", trig.error?.message ?? "");
  }

  // --- map tag and camera
  const player = JSON.parse(await sc(`local p = game.connected_players[1] rcon.print(helpers.table_to_json({ x = p.position.x, y = p.position.y }))`));
  const tag = await call("add_map_tag", { x: player.x + 3, y: player.y + 3, text: "companion test tag" });
  check("adds a map tag on charted map", tag.ok, JSON.stringify(tag.data));
  const farTag = await call("add_map_tag", { x: player.x + 200000, y: player.y, text: "nope" });
  check("refuses a map tag on uncharted map", !farTag.ok && farTag.error?.code === "not_charted");
  const cam = await call("camera_to", { x: player.x + 10, y: player.y + 10 });
  const controller = await sc(`rcon.print(game.connected_players[1].controller_type == defines.controllers.remote and "remote" or "other")`);
  check("camera jump opens remote view at a charted spot", cam.ok && controller === "remote");
  await sc(`game.connected_players[1].exit_remote_view() rcon.print("ok")`);
  const farCam = await call("camera_to", { x: player.x + 200000, y: player.y });
  check("refuses a camera jump to uncharted map", !farCam.ok && farCam.error?.code === "not_charted");

  // --- upgrade: build 3 belts, upgrade them to their next tier
  const belts = JSON.parse(await sc(`
    local p = game.connected_players[1] local s = p.surface local out = {}
    for dx = 6, 40 do if #out < 3 then local pos = { x = math.floor(p.position.x) + dx + 0.5, y = math.floor(p.position.y) - 20 + 0.5 }
      if s.can_place_entity({ name = "transport-belt", position = pos, force = p.force }) then local e = s.create_entity({ name = "transport-belt", position = pos, force = p.force }) out[#out+1] = { name = e.name, x = e.position.x, y = e.position.y } end end end
    rcon.print(helpers.table_to_json(out))`));
  placed.belts = belts;
  const up = await call("mark_upgrade", { entities: belts });
  const marked = Number(await sc(`local n = 0 for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(belts)}]=])) do local e = game.connected_players[1].surface.find_entity(r.name, r) if e and e.to_be_upgraded() then n = n + 1 end end rcon.print(n)`));
  check("marks belts for upgrade to their next tier", up.ok && up.data.done === belts.length && marked === belts.length, `${JSON.stringify(up.data)}; ${up.profile}`);
  const wrong = await call("mark_upgrade", { entities: belts, target: "assembling-machine-2" });
  check("refuses an upgrade to an incompatible entity", wrong.ok && wrong.data.done === 0 && (wrong.data.rejected.not_compatible ?? 0) + (wrong.data.rejected.already_marked ?? 0) === belts.length, JSON.stringify(wrong.data.rejected));

  // --- blueprint: paste 3 belts as ghosts near the player, and refuse far away
  const bp = encodeBlueprintString({ blueprint: { item: "blueprint", entities: [0, 1, 2].map((i) => ({ entity_number: i + 1, name: "transport-belt", position: { x: i + 0.5, y: 0.5 }, direction: 4 })) } });
  let spot: { x: number; y: number } | null = null;
  for (const dy of [26, 30, 34, 38, -26, -30]) {
    const free = await sc(`local p = game.connected_players[1] local s = p.surface local ok = true for i = 0, 2 do if not s.can_place_entity({ name = "transport-belt", position = { x = math.floor(p.position.x) + 8 + i + 0.5, y = math.floor(p.position.y) + ${dy} + 0.5 }, force = p.force, build_check_type = defines.build_check_type.ghost_revive }) then ok = false end end rcon.print(ok and "yes" or "no")`);
    if (free === "yes") { spot = { x: Math.floor(player.x) + 9, y: Math.floor(player.y) + dy }; break; }
  }
  if (spot) {
    const paste = await call("place_blueprint", { blueprint: bp, x: spot.x, y: spot.y });
    check("pastes a small blueprint as ghosts where the player can see", paste.ok && paste.data.placed === 3 && paste.data.expected === 3, `${JSON.stringify(paste.data)}; ${paste.profile}`);
  } else {
    check("pastes a small blueprint as ghosts where the player can see", false, "no free spot found for the test");
  }
  const far = await call("place_blueprint", { blueprint: bp, x: player.x + 200000, y: player.y });
  check("refuses a blueprint paste where the player can't see", !far.ok && far.error?.code === "not_visible");
} finally {
  await sc(`
    local p = game.connected_players[1] local s = p.surface local f = p.force
    for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(placed.belts)}]=])) do local e = s.find_entity(r.name, r) if e then e.destroy() end end
    for _, g in pairs(s.find_entities_filtered({ area = { { p.position.x - 50, p.position.y - 50 }, { p.position.x + 50, p.position.y + 50 } }, name = "entity-ghost", force = f })) do if g.ghost_name == "transport-belt" then g.destroy() end end
    for _, t in pairs(f.find_chart_tags(s, { { p.position.x - 10, p.position.y - 10 }, { p.position.x + 10, p.position.y + 10 } })) do if t.text == "companion test tag" then t.destroy() end end
    local q = {} for _, name in pairs(helpers.json_to_table([=[${originalQueue}]=]) or {}) do q[#q+1] = name end f.research_queue = q
    if p.controller_type == defines.controllers.remote then p.exit_remote_view() end
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
