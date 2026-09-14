// FC-022: how long large incoming RCON commands take to reach the mod (e.g. blueprint strings).
import { encodeCommand, parseReply } from "../../interfaces/src/index";
import { readRconSettings } from "../../server/src/factorio";
import { RconClient } from "../../server/src/rcon";

const rcon = await RconClient.connect({ ...(await readRconSettings())!, timeoutMs: 120_000 });
let id = 1;
const ping = async (padBytes: number) => {
  const cmd = encodeCommand({ id: id++, action: "ping", args: { pad: "x".repeat(padBytes) }, profile: true });
  const t0 = performance.now();
  const raw = await rcon.exec(cmd);
  const ms = performance.now() - t0;
  const { reply, profile } = parseReply(raw);
  return { ms, ok: reply.ok, tick: (reply.data as { tick?: number })?.tick, profile, bytes: cmd.length };
};
await ping(10);
const base = await ping(10);
console.log(`baseline ping: ${base.ms.toFixed(1)} ms`);
for (const size of [10_000, 100_000, 1_000_000, 5_000_000]) {
  const runs = [await ping(size), await ping(size)];
  console.log(`${String(size).padStart(9)} B command: ${runs.map((r) => `${r.ms.toFixed(0)} ms`).join(", ")}  ok=${runs.every((r) => r.ok)}  handler (incl. JSON parse) ${runs[1]!.profile}`);
}
// Does a big command hold up small ones sent right after it?
const t0 = performance.now();
const big = ping(1_000_000);
const small = ping(10);
const [b, s] = await Promise.all([big, small]);
console.log(`1 MB then 10 B sent together: big ${b.ms.toFixed(0)} ms (tick ${b.tick}), small ${s.ms.toFixed(0)} ms (tick ${s.tick}), total ${(performance.now() - t0).toFixed(0)} ms`);
rcon.close();
