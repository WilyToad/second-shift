// Probe: the companion's selection tool and shortcut prototypes loaded (FC-046).
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
console.log(await dev.sc(`local t = prototypes.item["companion-selection-tool"] local s = prototypes.shortcut["companion-select-build"] rcon.print((t and ("tool " .. t.type) or "no tool") .. ", " .. (s and ("shortcut " .. s.action) or "no shortcut"))`));
dev.rcon.close();
