// S04 check through the real server: the page connection gets digests and series, and an event
// triggered in-game reaches it quickly. Needs bun run start + the dev save hosted.
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: { at: number; m: ServerMessage }[] = [];
ws.onmessage = (e) => got.push({ at: performance.now(), m: JSON.parse(String(e.data)) });
await new Promise((r) => (ws.onopen = r));
const waitFor = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find((g) => pred(g.m)); if (hit) return hit; await Bun.sleep(20); }
  return null;
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const series = await waitFor((m) => m.type === "series", 5000);
const digest = await waitFor((m) => m.type === "digest", 5000);
check("page connection receives series history on connect", !!series && Object.keys((series.m as any).series).length > 0, series ? `${Object.keys((series.m as any).series).length} series` : "none");
check("the digest has production data", !!digest && (digest.m as any).digest.surfaces.length > 0, digest ? `tick ${(digest.m as any).digest.tick}, ${(digest.m as any).digest.surfaces.length} surfaces` : "none");
const before = got.length;
const next = await waitFor((m) => m.type === "digest", 4000, before);
check("digests keep streaming (every ~2 s)", !!next);

const dev = await connectDevGame();
const t0 = performance.now();
const fromIndex = got.length; // ignore events the server replayed on connect
const wall = await dev.sc(`local p = game.connected_players[1] local s = p.surface for dx = 6, 30 do local pos = { x = p.position.x + dx, y = p.position.y + 14 } if s.can_place_entity({ name = "stone-wall", position = pos, force = p.force }) then local w = s.create_entity({ name = "stone-wall", position = pos, force = p.force }) w.die(game.forces.enemy) rcon.print("ok") return end end rcon.print("no spot")`);
const alert = await waitFor((m) => m.type === "events" && m.events.some((e) => e.kind === "alert" && e.entity === "stone-wall"), 5000, fromIndex);
const latency = alert ? alert.at - t0 : NaN;
check("an in-game alert reaches the page within ~1 s", !!alert && latency < 1500, `${wall}; ${alert ? `${latency.toFixed(0)} ms` : "not received"}`);
dev.rcon.close();
ws.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
