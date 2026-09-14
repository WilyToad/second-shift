import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
console.log(await dev.sc(`local out = {} for name, e in pairs(prototypes.get_entity_filtered({ { filter = "type", type = { "loader", "loader-1x1", "infinity-container", "electric-energy-interface" } } })) do out[#out+1] = name .. " " .. e.type end rcon.print(table.concat(out, ", "))`));
dev.rcon.close();
