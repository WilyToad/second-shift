// FC-083/FC-084: registry and status polling on the hosted dev save.
import { actions, encodeCommand, parseReply } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
let id = 1;
const call = async <A extends "machine_stats" | "debug_machine_tick" | "find_machines">(action: A, profile = false, args: Record<string, unknown> = {}) => {
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
