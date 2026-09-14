// FC-107: generated production rows really make what they promise. Test tooling on the hosted dev save:
// each row is pasted through a real blueprint item onto a temporary lab surface, powered by an energy
// interface, fed from infinity chests at its input inserters and emptied into voiding chests at its
// output inserters, then run at game speed 10. Output comes from the surface's production statistics.
// Belts aren't exercised (chests replace the belt tiles the inserters use). The surface is deleted after.
// Usage: bun scripts/test-generated-builds.ts
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { encodeBlueprintString } from "../server/src/blueprint";
import { productionRow } from "../server/src/blueprint-template";
import { connectDevGame } from "./lib/devgame";

const REQUESTS = [
  { item: "iron-gear-wheel", perMinute: 120 },
  { item: "electronic-circuit", perMinute: 240 },
  { item: "automation-science-pack", perMinute: 30 },
];
const SPEED = 10, WARMUP_S = 20, MEASURE_S = 60;
const SURFACE = "companion-build-test";
const DEBUG = Bun.argv.includes("--debug");

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const p = PrototypesSchema.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} }))).reply.data);
const lua = (s: string) => dev.sc(s);

try {
  await lua(`local s = game.get_surface("${SURFACE}") or game.create_surface("${SURFACE}")
    s.generate_with_lab_tiles = true s.always_day = true
    s.request_to_generate_chunks({ 0, 0 }, 4) s.force_generate_chunk_requests() rcon.print("ok")`);
  for (const [n, req] of REQUESTS.entries()) {
    const r = productionRow(p, req);
    if (!r.ok) { check(`${req.item}: generated`, false, r.reason); continue; }
    const b = r.build;
    const origin = { x: 0, y: n * 40 };
    const str = encodeBlueprintString({ blueprint: b.blueprint });
    const solid = b.inputs.map((i) => i.name);
    const built = JSON.parse(await lua(`local s = game.get_surface("${SURFACE}") local f = game.forces.player
      local inv = game.create_inventory(1) inv.insert({ name = "blueprint" }) local stack = inv[1]
      if stack.import_stack("${str}") ~= 0 then rcon.print('{"error":"import failed"}') inv.destroy() return end
      local ghosts = stack.build_blueprint({ surface = s, force = f, position = { ${origin.x}, ${origin.y} }, build_mode = defines.build_mode.forced })
      inv.destroy()
      -- Depending on cheat settings the paste makes ghosts or real entities: revive ghosts, then collect everything in the area.
      local area = { { ${origin.x} - 60, ${origin.y} - 15 }, { ${origin.x} + 60, ${origin.y} + 15 } }
      for _, g in pairs(s.find_entities_filtered({ area = area, type = "entity-ghost" })) do g.revive() end
      local machines, inserters, poles, belts = {}, {}, {}, 0
      for _, e in pairs(s.find_entities_filtered({ area = area })) do
        if e.type == "assembling-machine" then machines[#machines + 1] = e
        elseif e.type == "inserter" then inserters[#inserters + 1] = e
        elseif e.type == "electric-pole" then poles[#poles + 1] = e
        elseif e.type == "transport-belt" then belts = belts + 1 end
      end
      if #machines == 0 or #poles == 0 then rcon.print(helpers.table_to_json({ error = "nothing built", ghosts = #ghosts })) return end
      -- Power next to the first pole, outside the row.
      local top = poles[1]
      for _, pole in pairs(poles) do if pole.position.y < top.position.y or (pole.position.y == top.position.y and pole.position.x < top.position.x) then top = pole end end
      local eei = s.create_entity({ name = "electric-energy-interface", position = { top.position.x - 2, top.position.y - 3 }, force = f })
      eei.electric_buffer_size = 1e12 eei.power_production = 1e10
      -- Inputs and outputs: swap the belt tile each inserter uses for a chest.
      local ingredients = helpers.json_to_table('${JSON.stringify(solid)}')
      local chests = 0
      for _, ins in pairs(inserters) do
        local from, to = ins.pickup_position, ins.drop_position
        local feeding = false
        for _, m in pairs(machines) do
          local box = m.bounding_box
          if to.x > box.left_top.x and to.x < box.right_bottom.x and to.y > box.left_top.y and to.y < box.right_bottom.y then feeding = true end
        end
        local spot = feeding and from or to
        for _, belt in pairs(s.find_entities_filtered({ position = spot, type = "transport-belt" })) do belt.destroy() end
        local chest = s.create_entity({ name = "infinity-chest", position = spot, force = f })
        if chest then
          chests = chests + 1
          if feeding then
            for i, name in pairs(ingredients) do chest.set_infinity_container_filter(i, { name = name, count = 100, mode = "exactly", index = i }) end
          else
            chest.remove_unfiltered_items = true
          end
        end
      end
      rcon.print(helpers.table_to_json({ machines = #machines, inserters = #inserters, poles = #poles, belts = belts, chests = chests }))`));
    if (built.error) { check(`${req.item}: built from the blueprint`, false, JSON.stringify(built)); continue; }
    check(`${req.item}: built from the blueprint`, built.machines === b.machines, `${built.machines} ${b.machine}, ${built.inserters} ${b.inserter}, ${built.poles} ${b.pole}, ${built.chests} chests`);
  }

  // Run everything at once: warm up, then measure every item over the same window.
  await lua(`game.speed = ${SPEED} rcon.print("ok")`);
  await Bun.sleep((WARMUP_S / SPEED) * 1000);
  const items = REQUESTS.map((r) => r.item);
  const snapshot = async () => JSON.parse(await lua(`local stats = game.forces.player.get_item_production_statistics("${SURFACE}")
    local out = { tick = game.tick, counts = {} }
    for _, name in pairs(helpers.json_to_table('${JSON.stringify(items)}')) do out.counts[name] = stats.get_input_count(name) end
    local status = {}
    for _, m in pairs(game.get_surface("${SURFACE}").find_entities_filtered({ type = "assembling-machine" })) do
      local k = m.get_recipe() and m.get_recipe().name or "none"
      status[k] = status[k] or {}
      local st = tostring(m.status)
      for name, v in pairs(defines.entity_status) do if v == m.status then st = name end end
      status[k][st] = (status[k][st] or 0) + 1
    end
    out.status = status
    rcon.print(helpers.table_to_json(out))`)) as { tick: number; counts: Record<string, number>; status: Record<string, Record<string, number>> };
  if (DEBUG) console.log(await lua(`local s = game.get_surface("${SURFACE}") local c = {} for _, e in pairs(s.find_entities()) do c[e.name] = (c[e.name] or 0) + 1 end rcon.print(serpent.line(c))`));
  if (DEBUG) console.log(await lua(`local s = game.get_surface("${SURFACE}") local out = {}
    for _, ins in pairs(s.find_entities_filtered({ type = "inserter" })) do
      local st = "?" for name, v in pairs(defines.entity_status) do if v == ins.status then st = name end end
      local at = function(pos) local names = {} for _, e in pairs(s.find_entities_filtered({ position = pos })) do names[#names + 1] = e.name end return table.concat(names, "+") end
      out[#out + 1] = ins.name .. "@" .. ins.position.x .. "," .. ins.position.y .. " " .. st .. " pick " .. at(ins.pickup_position) .. " drop " .. at(ins.drop_position) .. " hand " .. tostring(ins.held_stack.valid_for_read and ins.held_stack.count or 0)
    end
    rcon.print(table.concat(out, " ; "))`));
  const a = await snapshot();
  await Bun.sleep((MEASURE_S / SPEED) * 1000);
  const z = await snapshot();
  await lua(`game.speed = 1 rcon.print("ok")`);
  const minutes = (z.tick - a.tick) / 3600;
  console.log(`  measured over ${(minutes * 60).toFixed(0)} game seconds; machine status: ${JSON.stringify(z.status)}`);
  for (const req of REQUESTS) {
    const r = productionRow(p, req);
    if (!r.ok) continue;
    const measured = ((z.counts[req.item] ?? 0) - (a.counts[req.item] ?? 0)) / minutes;
    const promised = r.build.perMinute;
    check(`${req.item}: makes what was promised`, measured >= promised * 0.9 && measured <= promised * 1.1 && measured >= req.perMinute * 0.9,
      `asked ${req.perMinute}/min, promised ${promised.toFixed(1)}/min from ${r.build.machines} ${r.build.machine}, measured ${measured.toFixed(1)}/min`);
  }
} finally {
  await lua(`game.speed = 1 if game.get_surface("${SURFACE}") then game.delete_surface("${SURFACE}") end rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
