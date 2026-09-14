// FC-049 probe: what game.take_screenshot costs in the hosted dev game. Measures the Lua call itself, how long
// the file takes to appear, and ticks per wall-second around it (a render hitch shows up as a UPS dip).
import { existsSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectDevGame } from "../lib/devgame";
import { USER_DIR } from "../lib/factorio";

const dev = await connectDevGame();
const out = join(USER_DIR, "script-output", "companion");
const tick = async () => Number(await dev.sc(`rcon.print(game.tick)`));
const ups = async (ms: number) => { const t0 = await tick(); const s = performance.now(); await Bun.sleep(ms); return ((await tick()) - t0) / ((performance.now() - s) / 1000); };

console.log(`baseline UPS ${(await ups(2000)).toFixed(1)}`);
for (const [size, ext] of [[512, "png"], [1024, "png"], [2048, "png"], [1024, "jpg"], [2048, "jpg"]] as const) {
  const file = `probe-${size}.${ext}`;
  rmSync(join(out, file), { force: true });
  const t0 = await tick();
  const started = performance.now();
  const lua = await dev.sc(`local p = game.connected_players[1] local prof = helpers.create_profiler()
    game.take_screenshot({ player = p, by_player = p, surface = p.surface, position = p.position, resolution = { ${size}, ${size} }, zoom = 0.5, path = "companion/${file}", show_gui = false, show_entity_info = true, anti_alias = false, quality = 80 })
    prof.stop() rcon.print({ "", prof })`);
  let appeared = -1;
  while (performance.now() - started < 15000) { if (existsSync(join(out, file)) && statSync(join(out, file)).size > 0) { appeared = performance.now() - started; break; } await Bun.sleep(20); }
  await Bun.sleep(300);
  const t1 = await tick();
  const wall = (performance.now() - started) / 1000;
  const bytes = existsSync(join(out, file)) ? statSync(join(out, file)).size : 0;
  console.log(`${size}px ${ext}: lua ${lua.replace("Duration: ", "")}, file after ${appeared.toFixed(0)} ms (${(bytes / 1024).toFixed(0)} KB), UPS over the window ${((t1 - t0) / wall).toFixed(1)}`);
}
console.log(`after UPS ${(await ups(2000)).toFixed(1)}`);
dev.rcon.close();
