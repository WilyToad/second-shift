// FC-020: trigger events on the dev save and check they come back through `events` quickly and cheaply.
import { actions, encodeCommand, parseReply } from "../../interfaces/src/index";
import { connectDevGame } from "../lib/devgame";

const dev = await connectDevGame();
let id = 1;
const events = async (since: number) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action: "events", args: { since }, profile: true })));
  return { data: actions.events.data.parse(reply.data), profile };
};

const start = await events(0);
console.log(`start: seq ${start.data.seq}, ${start.data.events.length} buffered, events poll cost ${start.profile}`);

// Research event: mark a not-yet-researched technology as researched (test tooling only).
const tech = await dev.sc(`local f = game.forces.player for name, t in pairs(f.technologies) do if not t.researched and t.enabled and not t.prototype.hidden then t.researched = true rcon.print(name) return end end rcon.print("")`);
// Alert: destroy a freshly built wall near the player so the game raises an entity_destroyed alert.
const wall = await dev.sc(`local p = game.connected_players[1] local s = p.surface for dx = 6, 30 do local pos = { x = p.position.x + dx, y = p.position.y + 12 } if s.can_place_entity({ name = "stone-wall", position = pos, force = p.force }) then local w = s.create_entity({ name = "stone-wall", position = pos, force = p.force }) w.die(game.forces.enemy) rcon.print("killed wall at " .. math.floor(pos.x) .. "," .. math.floor(pos.y)) return end end rcon.print("no spot")`);
console.log(`triggered: research ${tech || "(none available)"}; ${wall}`);

const t0 = performance.now();
let got: typeof start.data.events = [];
while (performance.now() - t0 < 5000 && got.length < 2) {
  const r = await events(start.data.seq);
  got = r.data.events;
  if (got.length >= 2) console.log(`poll cost with ${got.length} events: ${r.profile}`);
  await Bun.sleep(100);
}
for (const e of got) console.log(`  event seq ${e.seq} tick ${e.tick}: ${e.kind} ${e.severity} ${e.type ?? e.research ?? ""} ${e.surface ?? ""} ${e.entity ?? ""} ${e.position ? `(${e.position.x},${e.position.y})` : ""}`);
console.log(`research event: ${got.some((e) => e.kind === "research_finished") ? "yes" : "NO"}; alert event: ${got.some((e) => e.kind === "alert") ? "yes" : "NO"}; seen within ${(performance.now() - t0).toFixed(0)} ms`);
dev.rcon.close();
