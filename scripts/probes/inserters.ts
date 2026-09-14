// FC-105 probe: inserter prototype values and force bonuses on the dev save; pickup/drop positions of
// inserters built facing each direction, to check the direction convention used for blueprints.
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
console.log(await dev.sc(`local out = {}
  for name, e in pairs(prototypes.get_entity_filtered({ { filter = "type", type = "inserter" } })) do
    out[#out + 1] = name .. " rot=" .. e.get_inserter_rotation_speed() .. " ext=" .. e.get_inserter_extension_speed() .. " bulk=" .. tostring(e.bulk) .. " bonus=" .. e.inserter_stack_size_bonus .. " uses_bonus=" .. tostring(e.uses_inserter_stack_size_bonus) .. " belt_stack=" .. e.inserter_max_belt_stack_size .. " pick=" .. serpent.line(e.inserter_pickup_position) .. " drop=" .. serpent.line(e.inserter_drop_position)
  end
  local f = game.forces.player
  out[#out + 1] = "force inserter_stack_size_bonus=" .. f.inserter_stack_size_bonus .. " bulk_inserter_capacity_bonus=" .. f.bulk_inserter_capacity_bonus .. " belt_stack_size_bonus=" .. f.belt_stack_size_bonus
  rcon.print(table.concat(out, "\\n"))`));
console.log(await dev.sc(`local p = game.connected_players[1] local s = p.surface local out = {}
  for _, name in pairs({ "inserter", "long-handed-inserter" }) do
    for _, dir in pairs({ 0, 4, 8, 12 }) do
      local pos = { x = math.floor(p.position.x) + 20.5, y = math.floor(p.position.y) + 20.5 }
      local e = s.create_entity({ name = name, position = pos, direction = dir, force = p.force })
      if e then
        out[#out + 1] = name .. " dir=" .. dir .. " pickup=" .. serpent.line({ e.pickup_position.x - pos.x, e.pickup_position.y - pos.y }) .. " drop=" .. serpent.line({ e.drop_position.x - pos.x, e.drop_position.y - pos.y })
        e.destroy()
      else out[#out + 1] = "couldn't place" end
    end
  end
  rcon.print(table.concat(out, "\\n"))`));
dev.rcon.close();
