// Probe: numeric wire connector ids, and the wires a real blueprint of two connected poles stores.
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
console.log(await dev.sc(`local out = {} for k, v in pairs(defines.wire_connector_id) do out[#out+1] = k .. "=" .. v end rcon.print(table.concat(out, " "))`));
console.log(await dev.sc(`local s = game.get_surface("companion-wire-probe") or game.create_surface("companion-wire-probe")
  s.generate_with_lab_tiles = true s.request_to_generate_chunks({0,0},1) s.force_generate_chunk_requests()
  local a = s.create_entity({ name = "medium-electric-pole", position = { 0.5, 0.5 }, force = "player" })
  local b = s.create_entity({ name = "medium-electric-pole", position = { 6.5, 0.5 }, force = "player" })
  local connected = a.get_wire_connector(defines.wire_connector_id.pole_copper, true).is_connected_to(b.get_wire_connector(defines.wire_connector_id.pole_copper, true))
  local inv = game.create_inventory(1) inv.insert({ name = "blueprint" })
  inv[1].create_blueprint({ surface = s, force = "player", area = { { -2, -2 }, { 9, 3 } } })
  local bp = inv[1].export_stack()
  inv.destroy() game.delete_surface(s)
  rcon.print("auto-connected on create: " .. tostring(connected) .. " | " .. bp)`));
dev.rcon.close();
