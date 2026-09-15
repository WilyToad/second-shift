// FC-107: generated production rows really make what they promise. Test tooling on the hosted dev save:
// each row is pasted through a real blueprint item onto a temporary lab surface, powered by an energy
// interface, then run at game speed 10. Output comes from the surface's production statistics.
// Two ways to feed it (FC-161):
//   default: through the row's own belts. The input belt is kept full by the level script and the output belt
//   is drained into voiding chests, so belts, inserters and machines all count, as in a real base.
//   --chests: the older way, with infinity chests in place of the belt tiles the inserters use, so only the
//   machines and inserters count. Useful to tell a belt problem from a machine one.
// The surface is deleted after.
// Usage: bun scripts/test-generated-builds.ts [--chests] [--debug]
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { encodeBlueprintString } from "../server/src/blueprint";
import { productionRow } from "../server/src/blueprint-template";
import { blueprintThroughput } from "../server/src/blueprint-throughput";
import type { Blueprint } from "../server/src/blueprint";
import { connectDevGame } from "./lib/devgame";

// Rows as generated, plus rows deliberately crippled (FC-161): a slow belt, half the inserters, slow inserters.
// A crippled row must make what the estimate says it makes, and the estimate must blame the right part.
// (A slow *input* belt isn't tested here: the scripted feed puts items on the belt faster than a real source would,
// so an input-lane limit can't be measured this way. The lane cap is checked in the unit tests instead.)
type Change = "slow-belt" | "half-inserters" | "slow-inserters";
const REQUESTS: { item: string; perMinute: number; change?: Change }[] = [
  { item: "iron-gear-wheel", perMinute: 120 },
  { item: "electronic-circuit", perMinute: 240 },
  { item: "automation-science-pack", perMinute: 30 },
  { item: "iron-gear-wheel", perMinute: 600, change: "half-inserters" },
  { item: "iron-gear-wheel", perMinute: 600, change: "slow-inserters" },
];
const label = (r: { item: string; perMinute: number; change?: Change }) => `${r.item} ${r.perMinute}/min${r.change ? ` (${r.change})` : ""}`;

/** Cripples a generated row in place, so the same blueprint is both built and estimated. */
function cripple(blueprint: Blueprint, change: Change): string {
  const isBelt = (name: string) => /transport-belt$/.test(name);
  if (change === "slow-belt") {
    for (const e of blueprint.entities) if (isBelt(e.name)) e.name = "transport-belt";
    return "every belt replaced with a yellow transport-belt";
  }
  if (change === "slow-inserters") {
    for (const e of blueprint.entities) if (/inserter$/.test(e.name)) e.name = "inserter";
    return "every inserter replaced with a plain inserter";
  }
  // Half the inserters on the input side (the row's northern inserter line), so the machines starve rather than
  // having no way out at all.
  const inserters = blueprint.entities.filter((e) => /inserter$/.test(e.name));
  const inputRow = Math.min(...inserters.map((e) => e.position.y));
  const inputs = inserters.filter((e) => e.position.y === inputRow);
  const drop = inputs.filter((_, i) => i % 2 === 1);
  blueprint.entities = blueprint.entities.filter((e) => !drop.includes(e));
  return `${drop.length} of ${inputs.length} input inserters removed`;
}
const SPEED = 10, WARMUP_S = 20, MEASURE_S = 60;
const surfaceFor = (n: number) => `companion-build-test-${n}`;
const DEBUG = Bun.argv.includes("--debug");
const CHESTS = Bun.argv.includes("--chests");

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const p = PrototypesSchema.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} }))).reply.data);
const lua = (s: string) => dev.sc(s);

const cases: { n: number; req: (typeof REQUESTS)[number]; build: import("../server/src/blueprint-template").RowBuild; changed: string }[] = [];

try {
  for (const [n, req] of REQUESTS.entries()) {
    // One surface per case: two cases can make the same item, and production statistics are per surface.
    const SURFACE = surfaceFor(n);
    await lua(`local s = game.get_surface("${SURFACE}") or game.create_surface("${SURFACE}")
      s.generate_with_lab_tiles = true s.always_day = true
      s.request_to_generate_chunks({ 0, 0 }, 4) s.force_generate_chunk_requests() rcon.print("ok")`);
    const r = productionRow(p, req);
    if (!r.ok) { check(`${label(req)}: generated`, false, r.reason); continue; }
    const b = r.build;
    const changed = req.change ? cripple(b.blueprint, req.change) : "";
    cases.push({ n, req, build: b, changed });
    const origin = { x: 0, y: 0 };
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
      local ingredients = helpers.json_to_table('${JSON.stringify(solid)}')
      local chests, feeds, drains = 0, 0, 0
      if ${CHESTS ? "true" : "false"} then
        -- Inputs and outputs: swap the belt tile each inserter uses for a chest.
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
      else
        -- Belt-fed: the input line (the row's northern belt) is topped up every tick by the level script, and the
        -- output line (the southern belt) is emptied into voiding chests, so nothing backs up that wouldn't in a base.
        local lines = s.find_entities_filtered({ area = area, type = "transport-belt" })
        local north, south = nil, nil
        for _, b in pairs(lines) do
          if not north or b.position.y < north then north = b.position.y end
          if not south or b.position.y > south then south = b.position.y end
        end
        -- Only the head of the input line is fed, so items have to travel down the belt and the lane's own
        -- capacity counts (feeding every tile hands each machine a private supply and hides belt limits).
        companion_feed = companion_feed or {}
        local head = nil
        for _, b in pairs(lines) do
          if b.position.y == north and (not head or b.position.x < head.position.x) then head = b end
        end
        if head then
          companion_feed[#companion_feed + 1] = { belt = head, items = ingredients }
          feeds = 1
        end
        -- Drain the output line by emptying its last tile every tick (a perfect unloader, and it needs no power).
        local tail = {}
        for _, b in pairs(lines) do if b.position.y == south then tail[#tail + 1] = b end end
        table.sort(tail, function(x, y) return x.position.x > y.position.x end)
        companion_drain = companion_drain or {}
        if tail[1] then companion_drain[#companion_drain + 1] = tail[1] drains = drains + 1 end
      end
      rcon.print(helpers.table_to_json({ machines = #machines, inserters = #inserters, poles = #poles, belts = belts, chests = chests, feeds = feeds, drains = drains }))`));
    if (built.error) { check(`${label(req)}: built from the blueprint`, false, JSON.stringify(built)); continue; }
    check(`${label(req)}: built from the blueprint`, built.machines === b.machines, `${built.machines} ${b.machine}, ${built.inserters} ${b.inserter}, ${built.poles} ${b.pole}, ${CHESTS ? `${built.chests} chests` : `${built.belts} belts, ${built.feeds} fed, ${built.drains} drained`}`);
  }

  // Keep every input belt full: one item kind per lane, topped up each tick (test tooling, level script only).
  if (!CHESTS) {
    await lua(`script.on_nth_tick(1, function()
      for _, f in pairs(companion_feed or {}) do
        if f.belt.valid then
          for i = 1, 2 do
            local item = f.items[i] or f.items[1]
            local line = f.belt.get_transport_line(i)
            -- Insert at the belt's own entry point, so the line carries the items at its own speed.
            if item and line.can_insert_at(0) then line.insert_at(0, { name = item }) end
          end
        end
      end
      for _, b in pairs(companion_drain or {}) do
        if b.valid then for i = 1, 2 do b.get_transport_line(i).clear() end end
      end
    end) rcon.print("feeding")`);
  }
  // Run everything at once: warm up, then measure every item over the same window.
  await lua(`game.speed = ${SPEED} rcon.print("ok")`);
  await Bun.sleep((WARMUP_S / SPEED) * 1000);
  const snapshot = async () => JSON.parse(await lua(`local out = { tick = game.tick, cases = {} }
    for _, c in pairs(helpers.json_to_table('${JSON.stringify(cases.map((c) => ({ surface: surfaceFor(c.n), item: c.req.item, inputs: c.build.inputs.map((i) => i.name) })))}')) do
      local s = game.get_surface(c.surface)
      local entry = { count = 0, status = {}, used = {} }
      if s then
        entry.count = game.forces.player.get_item_production_statistics(c.surface).get_input_count(c.item)
        for _, name in pairs(c.inputs) do entry.used[name] = game.forces.player.get_item_production_statistics(c.surface).get_output_count(name) end
        for _, m in pairs(s.find_entities_filtered({ type = "assembling-machine" })) do
          local st = tostring(m.status)
          for name, v in pairs(defines.entity_status) do if v == m.status then st = name end end
          entry.status[st] = (entry.status[st] or 0) + 1
        end
      end
      out.cases[#out.cases + 1] = entry
    end
    rcon.print(helpers.table_to_json(out))`)) as { tick: number; cases: { count: number; status: Record<string, number>; used: Record<string, number> }[] };
  if (DEBUG) console.log(await lua(`local s = game.get_surface("${surfaceFor(0)}") local c = {} for _, e in pairs(s.find_entities()) do c[e.name] = (c[e.name] or 0) + 1 end rcon.print(serpent.line(c))`));
  if (DEBUG) console.log(await lua(`local s = game.get_surface("${surfaceFor(0)}") local out = {}
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
  console.log(`  measured over ${(minutes * 60).toFixed(0)} game seconds`);
  for (const [i, c] of cases.entries()) {
    const measured = ((z.cases[i]?.count ?? 0) - (a.cases[i]?.count ?? 0)) / minutes;
    const promised = c.build.perMinute;
    const t = blueprintThroughput(c.build.blueprint, p);
    const estimated = t.effective.outputs.find((f) => f.name === c.req.item)?.perMinute ?? promised;
    const status = JSON.stringify(z.cases[i]?.status ?? {});
    const used = Object.entries(z.cases[i]?.used ?? {}).map(([name, n]) => `${name} ${(((n as number) - (a.cases[i]?.used?.[name] ?? 0)) / minutes).toFixed(0)}/min`).join(", ");
    if (!c.req.change) {
      check(`${label(c.req)}: makes what was promised`, measured >= promised * 0.9 && measured <= promised * 1.1,
        `promised ${promised.toFixed(1)}/min from ${c.build.machines} ${c.build.machine}, measured ${measured.toFixed(1)}/min; ${status}`);
    } else {
      console.log(`  ${label(c.req)}: ${c.changed}; promised ${promised.toFixed(1)}/min, measured ${measured.toFixed(1)}/min, used ${used}, machines ${status}`);
    }
    const off = measured > 0 ? Math.abs(estimated - measured) / measured : Infinity;
    check(`${label(c.req)}: the estimate is within 10% of the game`, off <= 0.1,
      `estimate ${estimated.toFixed(1)}/min vs measured ${measured.toFixed(1)}/min (${(off * 100).toFixed(1)}% off)${t.effective.reasons.length ? `; estimate blames ${t.effective.reasons.join(" and ")}` : ""}`);
  }
} finally {
  await lua(`game.speed = 1 script.on_nth_tick(1, nil) companion_feed = nil companion_drain = nil
    for _, name in pairs(helpers.json_to_table('${JSON.stringify(REQUESTS.map((_, n) => surfaceFor(n)))}')) do
      if game.get_surface(name) then game.delete_surface(name) end
    end rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
