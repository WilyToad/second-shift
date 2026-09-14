// FC-093 hands-on check: what the game does with a machine's ingredients when the player changes its recipe by hand
// from map view. `setup` builds a gear assembler holding 20 iron plates away from the character; `status` reports
// where the plates went (player inventory, ground, still in the machine); `cleanup` removes it.
import { connectDevGame } from "./lib/devgame";

const mode = Bun.argv[2] ?? "setup";
const dev = await connectDevGame();
const FILE = new URL("../data/check-remote-recipe.json", import.meta.url).pathname;

if (mode === "setup") {
  const out = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface local c = p.physical_position local f = p.force
    for _, d in pairs({ 80, 64, 48 }) do
      local spot = s.find_non_colliding_position("assembling-machine-2", { c.x + d, c.y }, 20, 1, true)
      if spot and f.is_chunk_visible(s, { x = math.floor(spot.x / 32), y = math.floor(spot.y / 32) }) then
        local e = s.create_entity({ name = "assembling-machine-2", position = spot, force = f })
        e.set_recipe("iron-gear-wheel")
        e.insert({ name = "iron-plate", count = 20 })
        rcon.print(helpers.table_to_json({ x = e.position.x, y = e.position.y, surface = s.name, plates = p.get_main_inventory() and p.get_main_inventory().get_item_count("iron-plate") or -1, character = { x = math.floor(c.x), y = math.floor(c.y) } }))
        return
      end
    end
    rcon.print("{}")`));
  await Bun.write(FILE, JSON.stringify(out));
  console.log(JSON.stringify(out));
} else {
  const s = JSON.parse(await Bun.file(FILE).text());
  if (mode === "cleanup") {
    console.log(await dev.sc(`local surface = game.get_surface("${s.surface}") local e = surface.find_entity("assembling-machine-2", { ${s.x}, ${s.y} }) if e then e.destroy() end
      for _, i in pairs(surface.find_entities_filtered({ type = "item-entity", position = { ${s.x}, ${s.y} }, radius = 6 })) do if i.stack.name == "iron-plate" then i.destroy() end end rcon.print("cleaned")`));
  } else {
    console.log(await dev.sc(`local p = game.connected_players[1] local surface = game.get_surface("${s.surface}")
      local e = surface.find_entity("assembling-machine-2", { ${s.x}, ${s.y} })
      local inside = 0 if e then for _, inv in pairs({ defines.inventory.assembling_machine_input, defines.inventory.assembling_machine_output }) do local i = e.get_inventory(inv) if i then inside = inside + i.get_item_count("iron-plate") end end end
      local ground = 0 for _, i in pairs(surface.find_entities_filtered({ type = "item-entity", position = { ${s.x}, ${s.y} }, radius = 6 })) do if i.stack.name == "iron-plate" then ground = ground + i.stack.count end end
      local inv = p.get_main_inventory() local now = inv and inv.get_item_count("iron-plate") or -1
      rcon.print("recipe " .. (e and e.get_recipe() and e.get_recipe().name or "none") .. " | plates: player " .. now .. " (was ${s.plates}), still in machine " .. inside .. ", on the ground " .. ground .. " | cursor: " .. (p.cursor_stack and p.cursor_stack.valid_for_read and (p.cursor_stack.name .. " x" .. p.cursor_stack.count) or "empty"))`));
  }
}
dev.rcon.close();
