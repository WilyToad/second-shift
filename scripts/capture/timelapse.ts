// Capture tooling (dev save only): the game renders its own daylight frames of one spot on Nauvis, fps a second, for N seconds,
// into script-output/capture/<name>/.  bun scripts/capture/timelapse.ts <name> <seconds> <x> <y> [zoom] [fps]
import { connectDevGame } from "../lib/devgame";
const [name, secs, x, y, zoom = "0.75", fps = "4"] = Bun.argv.slice(2);
const dev = await connectDevGame();
const end = performance.now() + Number(secs) * 1000;
let n = 0;
while (performance.now() < end) {
  const t = performance.now();
  await dev.sc(`game.take_screenshot({ surface = "nauvis", position = { ${x}, ${y} }, resolution = { 1600, 1000 }, zoom = ${zoom}, path = "capture/${name}/f${String(n).padStart(4, "0")}-${Date.now()}.jpg", quality = 92, daytime = 0.0, show_entity_info = true, anti_alias = true, force_render = true }) rcon.print("ok")`);
  n++;
  await Bun.sleep(Math.max(0, 1000 / Number(fps) - (performance.now() - t)));
}
console.log(`${n} frames`);
dev.rcon.close();
