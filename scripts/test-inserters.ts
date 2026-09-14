// FC-105: inserter pickup/drop geometry and hand size data, checked against the hosted dev game.
// Builds a blueprint (an assembler ringed by inserters facing every way) through a real blueprint item,
// revives the ghosts, compares each inserter's pickup/drop position with inserterReach, then removes it all.
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { encodeBlueprintString } from "../server/src/blueprint";
import { blueprintThroughput, inserterReach } from "../server/src/blueprint-throughput";
import { BlueprintSchema } from "../server/src/blueprint";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const dump = parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} })));
const p = PrototypesSchema.parse(dump.reply.data);
const bonuses = JSON.parse(await dev.sc(`local f = game.forces.player rcon.print(helpers.table_to_json({ stack = f.inserter_stack_size_bonus, bulk = f.bulk_inserter_capacity_bonus }))`));
check("dump carries inserter data and the force's hand size bonuses", Math.abs((p.machines["inserter"]?.rotation_speed ?? 0) - 0.014) < 1e-9 && p.machines["stack-inserter"]?.hand_bonus === 4 && p.inserter_bonuses.stack === bonuses.stack && p.inserter_bonuses.bulk === bonuses.bulk, `inserter ${JSON.stringify(p.machines["inserter"])}; bonuses ${JSON.stringify(p.inserter_bonuses)}`);

// Assembler at the origin (tiles -1..1); inserters on each side facing each direction, plus long-handed ones.
const entities: object[] = [{ name: "assembling-machine-2", position: { x: 0.5, y: 0.5 }, recipe: "iron-gear-wheel" }];
const spots: [number, number][] = [[0.5, -1.5], [2.5, 0.5], [0.5, 2.5], [-1.5, 0.5], [-0.5, -1.5], [1.5, 2.5]];
for (const [i, [x, y]] of spots.entries()) entities.push({ name: "inserter", position: { x, y }, direction: (i * 4) % 16 });
entities.push({ name: "long-handed-inserter", position: { x: 0.5, y: -2.5 }, direction: 0 }, { name: "long-handed-inserter", position: { x: 3.5, y: 0.5 }, direction: 12 });
const bp = { item: "blueprint", label: "fc-105 test", version: 562949958139904, entities: entities.map((e, i) => ({ entity_number: i + 1, ...e })) };
const str = encodeBlueprintString({ blueprint: bp });

// On a temporary lab-tile surface (deleted afterwards), so nothing in the save is in the way.
const built = JSON.parse(await dev.sc(`local p = game.connected_players[1]
  local s = game.get_surface("companion-inserter-test") or game.create_surface("companion-inserter-test")
  s.generate_with_lab_tiles = true
  s.request_to_generate_chunks({ 0, 0 }, 1) s.force_generate_chunk_requests()
  local inv = game.create_inventory(1) inv.insert({ name = "blueprint" })
  local stack = inv[1]
  if stack.import_stack("${str}") ~= 0 then rcon.print("{}") inv.destroy() return end
  local center = { x = 8, y = 8 }
  local ghosts = stack.build_blueprint({ surface = s, force = p.force, position = center, build_mode = defines.build_mode.forced, skip_fog_of_war = false })
  local out, made = {}, {}
  for _, g in pairs(ghosts) do
    local _, e = g.revive()
    if e then
      made[#made + 1] = e
      if e.type == "inserter" then out[#out + 1] = { name = e.name, direction = e.direction, x = e.position.x - center.x, y = e.position.y - center.y, pickup = { e.pickup_position.x - e.position.x, e.pickup_position.y - e.position.y }, drop = { e.drop_position.x - e.position.x, e.drop_position.y - e.position.y } }
      elseif e.type == "assembling-machine" then out[#out + 1] = { name = e.name, x = e.position.x - center.x, y = e.position.y - center.y } end
    end
  end
  inv.destroy()
  rcon.print(helpers.table_to_json({ entities = out, ghosts = #ghosts, center = center }))`)) as { entities: { name: string; direction?: number; x: number; y: number; pickup?: [number, number]; drop?: [number, number] }[]; ghosts: number };

const machine = built.entities?.find((e) => e.name === "assembling-machine-2");
const inserters = (built.entities ?? []).filter((e) => e.pickup);
check("the blueprint builds in the game", inserters.length === 8 && machine !== undefined, `${built.ghosts} ghosts, ${inserters.length} inserters`);
const wrong: string[] = [];
for (const ins of inserters) {
  // Match the built inserter to its blueprint entry by position relative to the assembler.
  const source = (bp.entities as unknown as { name: string; position: { x: number; y: number }; direction?: number }[]).find((e) => e.name === ins.name && Math.abs(e.position.x - 0.5 - (ins.x - machine!.x)) < 0.01 && Math.abs(e.position.y - 0.5 - (ins.y - machine!.y)) < 0.01);
  const reach = source ? inserterReach(p.machines[ins.name]!, source.direction ?? 0) : null;
  const close = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  if (!reach || !close(reach.pickup, ins.pickup!) || !close(reach.drop, ins.drop!)) wrong.push(`${ins.name} dir ${source?.direction}: game ${JSON.stringify([ins.pickup, ins.drop])}, computed ${JSON.stringify(reach)}`);
}
check("pickup and drop positions from blueprint directions match the game", wrong.length === 0 && inserters.length > 0, wrong.join("; ") || `${inserters.length} inserters, 4 directions`);

// The analysis's verdict against one computed from the game's own geometry: with this save's research
// and again with no hand size research, where the single long-handed output inserter (1.2/s) can't
// keep up with 1.5 gears/s.
const inside = (pt: [number, number], ins: { x: number; y: number }) => Math.abs(ins.x + pt[0] - machine!.x) < 1.5 && Math.abs(ins.y + pt[1] - machine!.y) < 1.5;
const feeding = inserters.filter((i) => inside(i.drop!, i)), emptying = inserters.filter((i) => inside(i.pickup!, i));
for (const [label, protos] of [["this save's research", p], ["no hand size research", { ...p, inserter_bonuses: { stack: 0, bulk: 0 } }]] as const) {
  const t = blueprintThroughput(BlueprintSchema.parse(bp), protos);
  const capacity = (name: string) => (1 + (protos.machines[name]!.hand_bonus ?? 0) + (protos.machines[name]!.bulk ? protos.inserter_bonuses.bulk : protos.inserter_bonuses.stack)) * protos.machines[name]!.rotation_speed! * 60;
  const capIn = feeding.reduce((n, i) => n + capacity(i.name), 0), capOut = emptying.reduce((n, i) => n + capacity(i.name), 0);
  const expected = [...(emptying.length && 1.5 > capOut ? ["output"] : []), ...(feeding.length && 3 > capIn ? ["input"] : [])];
  check(`inserter limits agree with the game's geometry (${label})`, JSON.stringify(t.limits.map((l) => l.side)) === JSON.stringify(expected), `game: ${feeding.length} feeding ${capIn.toFixed(2)}/s, ${emptying.length} emptying ${capOut.toFixed(2)}/s; expected ${JSON.stringify(expected)}, analysis ${JSON.stringify(t.limits.map((l) => l.side))}`);
}

await dev.sc(`if game.get_surface("companion-inserter-test") then game.delete_surface("companion-inserter-test") end rcon.print("removed")`);
dev.rcon.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
