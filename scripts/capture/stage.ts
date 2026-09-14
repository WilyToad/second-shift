// Capture staging (dev save only, test tooling): `clear` removes the pasted build at (55, 40) between takes;
// `view` puts the player in map view over it, so "paste it here" lands on open ground in Nauvis's main robot network.
// The spot was found once with find_non_colliding_position inside that network; it's the dev save, so it doesn't move.
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
if (Bun.argv[2] === "clear") {
  console.log(await dev.sc(`local s = game.surfaces.nauvis local n = 0 for _, e in pairs(s.find_entities_filtered({ area = { { 44, 30 }, { 66, 50 } }, force = game.connected_players[1].force })) do if e.type ~= "character" and e.name ~= "big-electric-pole" then e.destroy() n = n + 1 end end rcon.print("removed " .. n)`));
} else {
  console.log(await dev.sc(`local p = game.connected_players[1] local s = game.surfaces.nauvis
    if p.surface ~= s or (p.character and p.character.valid and math.abs(p.physical_position.x - 55) > 20) then p.teleport(s.find_non_colliding_position("character", { 55, 52 }, 10, 0.5), s) end
    p.set_controller({ type = defines.controllers.remote, position = { 55, 40 }, surface = s }) p.zoom = 0.9
    rcon.print(p.controller_type == defines.controllers.remote and "map view at 55, 40" or "failed")`));
}
dev.rcon.close();
