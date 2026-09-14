// S11: scale the running dev game to a megabase and profile every mod path. Test tooling only:
// builds a lab-tile surface full of assemblers through build events, measures, then deletes it.
// Nothing is saved. Usage: bun scripts/megabase.ts [--machines 25000] [--keep]
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const args = Bun.argv.slice(2);
const target = args.includes("--machines") ? Number(args[args.indexOf("--machines") + 1]) : 25_000;
const keep = args.includes("--keep");
const dev = await connectDevGame();
const sc = dev.sc;
let id = 1;
const profiled = async (action: ActionName, a: Record<string, unknown> = {}, runs = 5) => {
  const times: number[] = [];
  let data: any;
  for (let i = 0; i < runs; i++) {
    const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args: a, profile: true })));
    if (!reply.ok) throw new Error(`${action}: ${JSON.stringify(reply.error)}`);
    data = actions[action].data.parse(reply.data);
    times.push(parseFloat(profile ?? "NaN"));
  }
  times.sort((x, y) => x - y);
  return { data, median: times[Math.floor(times.length / 2)]!, max: times.at(-1)! };
};
const scLua = async (label: string, lua: string, runs = 5) => {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(parseFloat((await sc(`local prof = helpers.create_profiler() ${lua} prof.stop() rcon.print({ "", prof })`)).replace("Duration: ", "")));
  times.sort((x, y) => x - y);
  return { label, median: times[Math.floor(times.length / 2)]!, max: times.at(-1)! };
};

async function measure(label: string) {
  const stats = await profiled("machine_stats", {}, 1);
  const results: Record<string, { median: number; max: number }> = {};
  results["poll tick (debug_machine_tick)"] = await profiled("debug_machine_tick", {}, 20);
  results["digest"] = await profiled("digest", {}, 5);
  results["rate refresh step (one surface and category)"] = await profiled("debug_refresh_rates", {}, 20);
  results["events poll"] = await profiled("events", { since: 0 }, 5);
  results["dump_prototypes"] = await profiled("dump_prototypes", {}, 2);
  results["find_entities (32 tiles, all machines)"] = await profiled("find_entities", { types: ["assembling-machine"], direction: "around", radius: 32 }, 5);
  // find_machines on the busiest recipe label anywhere
  const counts = stats.data.counts as Record<string, Record<string, Record<string, number>>>;
  const busiest = Object.entries(counts).flatMap(([surface, r]) => Object.entries(r).map(([recipe, st]) => ({ surface, recipe, n: Object.values(st).reduce((a, b) => a + b, 0) }))).sort((a, b) => b.n - a.n)[0];
  const player = await sc(`rcon.print(game.connected_players[1] and game.connected_players[1].surface.name or "")`);
  const local_ = Object.entries(counts[player.trim()] ?? {}).map(([recipe, st]) => ({ recipe, n: Object.values(st).reduce((a, b) => a + b, 0) })).sort((a, b) => b.n - a.n)[0];
  if (local_) results[`find_machines, player's surface (${local_.recipe} on ${player.trim()}, ${local_.n} machines)`] = await profiled("find_machines", { recipe: local_.recipe }, 5);
  results["find_machines, player's surface, every recipe"] = await profiled("find_machines", {}, 5);
  if (busiest) results[`find_machines (${busiest.recipe} on ${busiest.surface}, ${busiest.n} machines)`] = await profiled("find_machines", { recipe: busiest.recipe, surface: busiest.surface }, 5);
  const types = ["entity_under_attack","entity_destroyed","turret_out_of_ammo","train_no_path","train_out_of_fuel","not_enough_repair_packs","collector_path_blocked","unclaimed_cargo","no_platform_storage","platform_tile_building_blocked"];
  const alert = await scLua("events sampler (10 filtered get_alerts)", `local p = game.connected_players[1] for _, t in pairs(helpers.json_to_table([=[${JSON.stringify(types)}]=])) do local a = p.get_alerts({ type = defines.alert_type[t] }) end`);
  results[alert.label] = alert;
  console.log(`\n== ${label}: ${stats.data.progress.machines} machines, refresh every ${stats.data.progress.refresh_ticks} ticks`);
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(70)} median ${v.median.toFixed(3)} ms, max ${v.max.toFixed(3)} ms`);
  return { machines: stats.data.progress.machines, refreshTicks: stats.data.progress.refresh_ticks, results };
}

const report: Record<string, unknown> = {};
try {
  // Let the registry scan of the save finish first, so "before" measures a settled registry.
  for (let i = 0; i < 120; i++) {
    if ((await profiled("machine_stats", {}, 1)).data.progress.scanned) break;
    await Bun.sleep(1000);
  }
  report.before = await measure("dev save (before)");

  // Build the megabase: a lab-tile surface with a grid of assemblers (3x3 plus a 1-tile gap).
  const existing = (report.before as any).machines as number;
  const toBuild = Math.max(0, target - existing);
  const side = Math.ceil(Math.sqrt(toBuild));
  await sc(`if not game.get_surface("companion-megabase") then local s = game.create_surface("companion-megabase") s.generate_with_lab_tiles = true s.always_day = true end rcon.print("ok")`);
  await sc(`local s = game.get_surface("companion-megabase") s.request_to_generate_chunks({ 0, 0 }, ${Math.ceil((side * 4) / 32 / 2) + 2}) s.force_generate_chunk_requests() rcon.print("generated")`);
  const t0 = performance.now();
  const BATCH = 1500;
  for (let start = 0; start < toBuild; start += BATCH) {
    const end = Math.min(toBuild, start + BATCH);
    await sc(`local s = game.get_surface("companion-megabase") local f = game.forces.player local side = ${side}
      for i = ${start}, ${end - 1} do
        local x, y = (i % side) * 4 - side * 2 + 1.5, math.floor(i / side) * 4 - side * 2 + 1.5
        local e = s.create_entity({ name = "assembling-machine-2", position = { x, y }, force = f, raise_built = true })
        if e then e.set_recipe("iron-gear-wheel") end
      end rcon.print("ok")`);
  }
  console.log(`\nbuilt ${toBuild} assemblers in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  // Wait one full polling refresh so every new machine has a status (worst case for find_machines).
  const refresh = actions.machine_stats.data.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action: "machine_stats", args: {} }))).reply.data as unknown);
  await Bun.sleep((refresh.progress.refresh_ticks / 60) * 1000 + 3000);
  report.after = await measure("megabase");

  // One-time registry scan at scale: reset the registry and profile scan ticks until it finishes.
  await profiled("debug_reset_machines", {}, 1); // the mod's own storage (/sc runs in the scenario's Lua state)
  const scanTimes: number[] = [];
  const scanStart = performance.now();
  for (let i = 0; i < 5000; i++) {
    const r = await profiled("debug_machine_tick", {}, 1);
    scanTimes.push(r.median);
    if (r.median > 1) console.log(`  scan tick ${i}: ${r.median.toFixed(3)} ms (${r.data.machines} machines so far)`);
    if (r.data.scanned) break;
  }
  scanTimes.sort((x, y) => x - y);
  report.scan = { ticks: scanTimes.length, seconds: (performance.now() - scanStart) / 1000, median: scanTimes[Math.floor(scanTimes.length / 2)], p95: scanTimes[Math.floor(scanTimes.length * 0.95)], max: scanTimes.at(-1) };
  console.log(`\nregistry rescan at scale: ${JSON.stringify(report.scan)}`);
} finally {
  if (!keep) {
    await sc(`if game.get_surface("companion-megabase") then game.delete_surface("companion-megabase") end rcon.print("deleted")`);
  }
  await Bun.write(new URL("../data/eval/megabase.json", import.meta.url), JSON.stringify(report, null, 2));
  dev.rcon.close();
}
