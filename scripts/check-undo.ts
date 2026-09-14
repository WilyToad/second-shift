// FC-027 hands-on check: places 3 belts near the player (test tooling) and marks them through the mod's
// mark_deconstruction action, exactly as the agent does. Run `bun scripts/check-undo.ts status` after pressing Ctrl+Z,
// and `bun scripts/check-undo.ts cleanup` at the end.
import { encodeCommand, parseReply } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const mode = Bun.argv[2] ?? "setup";
const dev = await connectDevGame();
const FILE = new URL("../data/check-undo.json", import.meta.url).pathname;

if (mode === "right") {
  // Like "mark the belts to my right": the agent's own find_entities, then mark_deconstruction on what it found.
  const found = parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "find_entities", args: { types: ["transport-belt", "underground-belt", "splitter"], direction: "right", radius: 16 } }))).reply.data as { entities: { name: string; x: number; y: number }[]; count: number };
  await Bun.write(FILE, JSON.stringify(found.entities));
  const covered = await dev.sc(`local p = game.connected_players[1] rcon.print(#p.surface.find_logistic_networks_by_construction_area(p.position, p.force))`);
  const { reply } = parseReply(await dev.rcon.exec(encodeCommand({ id: 2, action: "mark_deconstruction", args: { entities: found.entities } })));
  console.log(`found ${found.count} belts to the right; construction networks covering the player: ${covered}`);
  console.log("mark result:", JSON.stringify(reply.data ?? reply.error));
}
if (mode === "setup") {
  // Outside construction-robot coverage, so robots don't carry out the marks before Ctrl+Z (first try: they did).
  const placed = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.surface local f = p.force
    local function ok(pos)
      return #s.find_logistic_networks_by_construction_area(pos, f) == 0 and s.can_place_entity({ name = "transport-belt", position = pos, force = f })
        and f.is_chunk_visible(s, { x = math.floor(pos.x / 32), y = math.floor(pos.y / 32) })
    end
    for r = 4, 200, 4 do for a = 0, 355, 5 do
      local x = math.floor(p.position.x + r * math.cos(math.rad(a))) + 0.5
      local y = math.floor(p.position.y + r * math.sin(math.rad(a))) + 0.5
      if ok({ x = x, y = y }) and ok({ x = x + 1, y = y }) and ok({ x = x + 2, y = y }) then
        local out = {}
        for i = 0, 2 do
          local e = s.create_entity({ name = "transport-belt", position = { x + i, y }, force = f, direction = defines.direction.east })
          out[#out + 1] = { name = e.name, x = e.position.x, y = e.position.y }
        end
        rcon.print(helpers.table_to_json(out)) return
      end
    end end
    rcon.print("[]")`));
  await Bun.write(FILE, JSON.stringify(placed));
  const { reply } = parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "mark_deconstruction", args: { entities: placed } })));
  console.log("placed:", JSON.stringify(placed));
  console.log("player at:", await dev.sc(`local p = game.connected_players[1] rcon.print(math.floor(p.position.x) .. ", " .. math.floor(p.position.y))`));
  console.log("mark result:", JSON.stringify(reply.data ?? reply.error));
}
const refs = JSON.parse(await Bun.file(FILE).text());
if (mode === "cleanup") {
  console.log(await dev.sc(`local s = game.connected_players[1].surface local n = 0 for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(refs)}]=])) do local e = s.find_entity(r.name, r) if e then e.destroy() n = n + 1 end end rcon.print("removed " .. n)`));
} else {
  console.log("marked for deconstruction:", await dev.sc(`local s = game.connected_players[1].surface local out = {} for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(refs)}]=])) do local e = s.find_entity(r.name, r) out[#out + 1] = e and tostring(e.to_be_deconstructed()) or "gone" end rcon.print(table.concat(out, ", "))`));
}
dev.rcon.close();
