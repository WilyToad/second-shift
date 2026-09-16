// FC-083/FC-084: registry and status polling on the hosted dev save.
import { actions, encodeCommand, parseReply } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
let id = 1;
const call = async <A extends "machine_stats" | "debug_machine_tick" | "find_machines" | "machine_output">(action: A, profile = false, args: Record<string, unknown> = {}) => {
  const { reply, profile: p } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile })));
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return { data: actions[action].data.parse(reply.data) as any, profile: p };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

// Wait for the initial chunk scan.
const t0 = performance.now();
let stats = await call("machine_stats");
while (!stats.data.progress.scanned && performance.now() - t0 < 120_000) { await Bun.sleep(1000); stats = await call("machine_stats"); }
check("initial scan finishes", stats.data.progress.scanned, `${((performance.now() - t0) / 1000).toFixed(0)} s after connect, ${stats.data.progress.machines} machines`);

const TYPES = `{"assembling-machine","furnace","rocket-silo","lab","mining-drill"}`;
const direct = Number(await dev.sc(`local n = 0 for _, s in pairs(game.surfaces) do n = n + s.count_entities_filtered({ type = ${TYPES} }) end rcon.print(n)`));
check("registry matches a one-off count of machines", stats.data.progress.machines === direct, `registry ${stats.data.progress.machines}, direct ${direct}`);

// Wait one full refresh period, then every machine should be in a status bucket.
await Bun.sleep((stats.data.progress.refresh_ticks / 60) * 1000 + 1500);
stats = await call("machine_stats");
const total = Object.values(stats.data.counts as Record<string, Record<string, Record<string, number>>>).flatMap((r) => Object.values(r)).flatMap((st) => Object.values(st)).reduce((a, b) => a + b, 0);
check("status counts cover every machine after one refresh period", total === stats.data.progress.machines, `${total}/${stats.data.progress.machines}, refresh every ${stats.data.progress.refresh_ticks} ticks`);
const stuck = Object.entries(stats.data.counts as Record<string, Record<string, Record<string, number>>>).flatMap(([surface, r]) => Object.entries(r).map(([recipe, st]) => ({ surface, recipe, st }))).filter((x) => Object.keys(x.st).some((k) => k !== "working")).slice(0, 5);
console.log("  sample non-working buckets:", JSON.stringify(stuck));

// FC-102: the chunk index behind find_machines agrees with the status counts on every surface.
// Paused (test tooling) so polling can't change a status between the two reads.
await dev.sc(`game.tick_paused = true rcon.print("paused")`);
const countsBySurface = (await call("machine_stats")).data.counts as Record<string, Record<string, Record<string, number>>>;
const mismatches: string[] = [];
for (const [surface, byRecipe] of Object.entries(countsBySurface)) {
  const expected = Object.values(byRecipe).flatMap((st) => Object.entries(st)).filter(([k]) => k !== "working" && k !== "normal").reduce((a, [, n]) => a + n, 0);
  const found = (await call("find_machines", false, { surface })).data;
  if (found.count + found.not_visible !== expected) mismatches.push(`${surface}: index ${found.count}+${found.not_visible}, counts ${expected}`);
}
await dev.sc(`game.tick_paused = false rcon.print("unpaused")`);
check("find_machines index matches the status counts on every surface", mismatches.length === 0, mismatches.join("; ") || `${Object.keys(countsBySurface).length} surfaces`);

// Build and destroy a machine through the game's own events.
const before = stats.data.progress.machines;
await dev.sc(`local p = game.connected_players[1] local s = p.surface for dx = 8, 40, 4 do local pos = { x = p.position.x + dx, y = p.position.y - 16 } if s.can_place_entity({ name = "assembling-machine-1", position = pos, force = p.force }) then storage.test_machine = s.create_entity({ name = "assembling-machine-1", position = pos, force = p.force, raise_built = true }) rcon.print("built") return end end rcon.print("no spot")`);
await Bun.sleep(300);
const afterBuild = (await call("machine_stats")).data.progress.machines;
await dev.sc(`if storage.test_machine and storage.test_machine.valid then storage.test_machine.destroy({ raise_destroy = true }) end storage.test_machine = nil rcon.print("destroyed")`);
await Bun.sleep(300);
const afterDestroy = (await call("machine_stats")).data.progress.machines;
check("building adds and destroying removes a machine", afterBuild === before + 1 && afterDestroy === before, `${before} -> ${afterBuild} -> ${afterDestroy}`);

// A recipe change moves a machine between index groups once it's polled.
const pos = await dev.sc(`local p = game.connected_players[1] local s = p.surface for dx = 8, 40, 4 do local pos = { x = p.position.x + dx, y = p.position.y - 16 } if s.can_place_entity({ name = "assembling-machine-1", position = pos, force = p.force }) then local e = s.create_entity({ name = "assembling-machine-1", position = pos, force = p.force, raise_built = true }) e.set_recipe("iron-gear-wheel") storage.test_machine = e rcon.print(helpers.table_to_json(e.position)) return end end rcon.print("{}")`);
const at = JSON.parse(pos) as { x?: number; y?: number };
const settle = async () => { for (let i = 0; i < Math.ceil((before + 1) / 20) + 2; i++) await call("debug_machine_tick"); };
const listed = async (recipe: string) => ((await call("find_machines", false, { recipe })).data.entities as { x: number; y: number }[]).some((e) => e.x === at.x && e.y === at.y);
await settle();
const inGears = await listed("iron-gear-wheel");
await dev.sc(`storage.test_machine.set_recipe("copper-cable") rcon.print("ok")`);
await settle();
const movedOut = !(await listed("iron-gear-wheel")), movedIn = await listed("copper-cable");
await dev.sc(`if storage.test_machine and storage.test_machine.valid then storage.test_machine.destroy({ raise_destroy = true }) end storage.test_machine = nil rcon.print("destroyed")`);
await Bun.sleep(300);
const gone = !(await listed("copper-cable"));
check("a recipe change moves a machine between groups; destroying drops it", at.x !== undefined && inGears && movedOut && movedIn && gone, `listed as gears ${inGears}, left gears ${movedOut}, listed as cable ${movedIn}, gone ${gone}`);

// FC-162: measured output from the machines' own craft counts. The first read starts the clock, the next reports.
await dev.leaveRemoteView();
const first = await call("machine_output", true, { radius: 64, restart: true });
check("machine_output starts the clock on the first read", first.data.window_ticks === 0 && first.data.machines > 0 && first.data.recipes.every((r: any) => r.per_minute === undefined),
  `${first.data.machines} machines, ${first.data.recipes.length} recipes, ${first.profile}`);
// Give the idle machines near the player something to craft, so there's a real rate to compare (test tooling).
const fed = JSON.parse(await dev.sc(`local p = game.connected_players[1] local at = p.physical_position local n = 0
  for _, e in pairs(p.surface.find_entities_filtered({ area = { { at.x - 64, at.y - 64 }, { at.x + 64, at.y + 64 } }, type = "assembling-machine", force = p.force })) do
    local r = e.get_recipe()
    if r then
      for _, i in pairs(r.ingredients) do if i.type == "item" then e.insert({ name = i.name, count = math.min(200, i.amount * 60) }) end end
      n = n + 1
    end
  end rcon.print(helpers.table_to_json({ fed = n }))`));
const truth = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1] local at = p.physical_position local out = {}
  for _, e in pairs(p.surface.find_entities_filtered({ area = { { at.x - 64, at.y - 64 }, { at.x + 64, at.y + 64 } }, type = { "assembling-machine", "furnace", "rocket-silo" }, force = p.force })) do
    out[tostring(e.unit_number)] = e.products_finished
  end rcon.print(helpers.table_to_json({ counts = out, tick = game.tick }))`)) as { counts: Record<string, number>; tick: number };
const truthBefore = await truth();
await call("machine_output", false, { radius: 64 }); // start the clock next to the truth reading
await Bun.sleep(10_000);
const second = await call("machine_output", true, { radius: 64 });
const truthAfter = await truth();
const truthCrafts = Object.entries(truthAfter.counts).reduce((n, [unit, count]) => n + (count - (truthBefore.counts[unit] ?? count)), 0);
const truthPerMinute = (truthCrafts * 3600) / (truthAfter.tick - truthBefore.tick);
const reported = second.data.recipes.reduce((n: number, r: any) => n + (r.per_minute ?? 0), 0);
check("the measured rate matches the machines' own craft counts", truthPerMinute > 0 && Math.abs(reported - truthPerMinute) <= Math.max(1, truthPerMinute * 0.1),
  `reported ${reported.toFixed(1)}/min, from the game ${truthPerMinute.toFixed(1)}/min over ${((truthAfter.tick - truthBefore.tick) / 60).toFixed(0)} s (fed ${fed.fed} machines); ${second.profile}`);

// Cost with many machines: read 500 of them through remote view over the factory floor (test tooling), as a
// player looking at their base through radar coverage would.
const many = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = game.get_surface("nauvis-factory-floor")
  local refs = {}
  for _, e in pairs(s.find_entities_filtered({ type = { "assembling-machine", "furnace" }, force = p.force, limit = 200 })) do
    refs[#refs + 1] = { name = e.name, x = e.position.x, y = e.position.y }
  end
  local at = refs[1]
  p.set_controller({ type = defines.controllers.remote, surface = s, position = { at.x, at.y } })
  rcon.print(helpers.table_to_json({ refs = refs }))`));
try {
  const big = await call("machine_output", true, { entities: many.refs });
  check("reading a capped batch of machines costs about a millisecond", parseFloat(big.profile ?? "99") < 1.5, `${big.data.machines} machines (${big.data.not_visible} out of sight) in ${big.profile}`);
} finally {
  await dev.sc(`game.connected_players[1].exit_remote_view() rcon.print("ok")`);
}
// Helmet: machines the player can't see aren't measured.
const unseen = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.surface local at = p.physical_position
  local far = { x = at.x + 6000, y = at.y } s.request_to_generate_chunks(far, 0) s.force_generate_chunk_requests()
  local pos = s.find_non_colliding_position("assembling-machine-2", far, 40, 1)
  local e = pos and s.create_entity({ name = "assembling-machine-2", position = pos, force = p.force })
  rcon.print(helpers.table_to_json(e and { name = e.name, x = e.position.x, y = e.position.y, visible = p.force.is_chunk_visible(s, { x = math.floor(e.position.x / 32), y = math.floor(e.position.y / 32) }) } or {}))`));
if (unseen.name) {
  const refused = await call("machine_output", false, { entities: [{ name: unseen.name, x: unseen.x, y: unseen.y }] });
  check("machine_output refuses machines the player can't see", refused.data.machines === 0 && refused.data.not_visible === 1, `machines ${refused.data.machines}, not visible ${refused.data.not_visible}`);
  await dev.destroy([{ name: unseen.name, x: unseen.x, y: unseen.y }]);
} else check("machine_output refuses machines the player can't see", false, "couldn't place a test machine out of sight");

// Cost of one tick's work (polling; scan is finished), profiled in Lua.
const costs: string[] = [];
for (let i = 0; i < 10; i++) costs.push((await call("debug_machine_tick", true)).profile ?? "?");
console.log(`  one tick of polling (${Math.min(20, stats.data.progress.machines)} machines): ${costs.join(" | ")}`);
const worst = Math.max(...costs.map((c) => parseFloat(c)));
check("one tick of polling stays under 0.1 ms", worst < 0.1, `worst ${worst} ms`);
dev.rcon.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
