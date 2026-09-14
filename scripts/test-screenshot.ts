// FC-049: the screenshot look action on the hosted dev save: a visible spot produces a real image, fog of war is refused.
import { statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { actions, encodeCommand, parseReply } from "../interfaces/src/index";
import { USER_DIR } from "../server/src/factorio";
import { waitForShot } from "../server/src/screenshots";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const out = join(USER_DIR, "script-output");
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const call = async (args: Record<string, unknown>) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: Date.now(), action: "screenshot", args, profile: true })));
  return { ...reply, data: reply.ok ? actions.screenshot.data.parse(reply.data) : undefined, profile };
};

const here = await call({ size: 1024, zoom: 0.5 });
let bytes = 0, waited = 0;
if (here.ok) {
  const started = performance.now();
  const name = await waitForShot(out, here.data!.path).catch(() => "");
  waited = performance.now() - started;
  if (name) { bytes = statSync(join(out, "companion", name)).size; rmSync(join(out, "companion", name)); }
}
check("a spot the player can see becomes a real image", here.ok && bytes > 20_000, `${JSON.stringify(here.data)}; ${(bytes / 1024).toFixed(0)} KB after ${waited.toFixed(0)} ms; ${here.profile}`);
const player = here.data!;
const far = await call({ x: player.x + 200000, y: player.y });
check("fog of war is refused", !far.ok && far.error?.code === "not_visible", far.error?.code ?? "");
const clamp = await call({ size: 99999, zoom: 50 });
if (clamp.ok) { const name = await waitForShot(out, clamp.data!.path).catch(() => ""); if (name) rmSync(join(out, "companion", name)); }
check("size and zoom are clamped", clamp.ok && clamp.data!.size === 2048 && clamp.data!.zoom === 2, JSON.stringify(clamp.data));
dev.rcon.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
