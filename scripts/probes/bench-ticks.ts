// Probe: per-tick benchmark timings with and without the mod, to find where the worst ticks come from.
// Usage (game closed, after bun scripts/benchmark.ts made data/bench/mods-*): bun scripts/probes/bench-ticks.ts [ticks]
import { join, resolve } from "node:path";
import { isFactorioRunning, spawnFactorio } from "../lib/factorio";
const ticks = Number(Bun.argv[2] ?? 1800);
const save = resolve(import.meta.dir, "../../data/saves/dev.zip");
const bench = resolve(import.meta.dir, "../../data/bench");
for (const which of ["mods-without", "mods-with"]) {
  const logPath = join(bench, `ticks-${which}.log`);
  const proc = spawnFactorio(["--benchmark", save, "--benchmark-ticks", String(ticks), "--benchmark-runs", "1", "--benchmark-verbose", "wholeUpdate,scriptUpdate", "--mod-directory", join(bench, which), "--disable-audio"], { logPath });
  await proc.exited;
  while (isFactorioRunning()) await Bun.sleep(500);
  const rows = (await Bun.file(logPath).text()).split("\n").filter((l) => /^t\d+,/.test(l)).map((l) => l.split(","));
  // Columns: tick, wholeUpdate, scriptUpdate (nanoseconds)
  const parsed = rows.map((r) => ({ tick: Number(r[0]!.slice(1)), whole: Number(r[1]) / 1e6, script: Number(r[2]) / 1e6 }));
  const slow = [...parsed].sort((a, b) => b.whole - a.whole).slice(0, 6);
  const scriptSlow = [...parsed].sort((a, b) => b.script - a.script).slice(0, 6);
  const avgScript = parsed.reduce((n, r) => n + r.script, 0) / parsed.length;
  const tail = parsed.slice(-600);
  const avgScriptTail = tail.reduce((n, r) => n + r.script, 0) / tail.length;
  console.log(`${which}: ${parsed.length} ticks; script avg ${avgScript.toFixed(3)} ms (last 600 ticks ${avgScriptTail.toFixed(3)} ms, max ${Math.max(...tail.map((r) => r.script)).toFixed(3)})`);
  console.log(`  slowest whole ticks: ${slow.map((r) => `t${r.tick} ${r.whole.toFixed(2)} (script ${r.script.toFixed(2)})`).join(", ")}`);
  console.log(`  slowest script ticks: ${scriptSlow.map((r) => `t${r.tick} ${r.script.toFixed(2)}`).join(", ")}`);
}
