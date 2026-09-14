// Probe (FC-093): how a script can put a machine's leftovers into its trash slots, as a hand recipe change does.
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
console.log(await dev.sc(`local p = game.connected_players[1] local s = p.surface local f = p.force local out = {}
  local function machine()
    local e = s.create_entity({ name = "assembling-machine-2", position = s.find_non_colliding_position("assembling-machine-2", { p.position.x + 20, p.position.y + 20 }, 60, 1, true), force = f })
    e.set_recipe("iron-gear-wheel") e.insert({ name = "iron-plate", count = 20 }) return e
  end
  local e = machine()
  local trash = e.get_inventory(defines.inventory.crafter_trash)
  out[#out+1] = "before: trash size " .. (trash and #trash or -1)
  local removed = e.set_recipe("copper-cable")
  trash = e.get_inventory(defines.inventory.crafter_trash)
  out[#out+1] = "after set_recipe: removed " .. serpent.line(removed) .. ", trash size " .. (trash and #trash or -1) .. ", trash plates " .. (trash and trash.get_item_count("iron-plate") or -1)
  if trash then
    out[#out+1] = "can_insert " .. tostring(trash.can_insert({ name = "iron-plate", count = 20 })) .. ", insert " .. trash.insert({ name = "iron-plate", count = 20 })
    if #trash > 0 then local ok, err = pcall(function() return trash[1].set_stack({ name = "iron-plate", count = 20 }) end) out[#out+1] = "set_stack " .. tostring(ok) .. " " .. tostring(err) end
    local ok2, err2 = pcall(function() trash.resize(1) end) out[#out+1] = "resize " .. tostring(ok2) .. " " .. tostring(err2)
    if ok2 then out[#out+1] = "after resize insert " .. trash.insert({ name = "iron-plate", count = 20 }) end
  end
  e.destroy()
  rcon.print(table.concat(out, " | "))`));
dev.rcon.close();
