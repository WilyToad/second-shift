// Measures the companion mod's UPS cost: benchmarks a save with and without the mod.
// Usage: bun scripts/benchmark.ts [save.zip] [--ticks N] [--runs N]
// Uses mirrored mod folders in data/bench/, so the real mod-list.json is never touched.
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BINARY, MODS_DIR, USER_DIR, isFactorioRunning } from "./lib/factorio";

const args = Bun.argv.slice(2);
const flag = (name: string, fallback: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const ticks = flag("--ticks", 1800);
const runs = flag("--runs", 3);
const save = resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? join(import.meta.dir, "../data/saves/dev.zip"));
const repoMod = resolve(import.meta.dir, "../mods/factorio-companion");
const benchDir = resolve(import.meta.dir, "../data/bench");

if (isFactorioRunning()) { console.error("Close Factorio first."); process.exit(1); }
if (!existsSync(save)) { console.error(`Save not found: ${save}`); process.exit(1); }

function mirrorMods(withCompanion: boolean): string {
  const dir = join(benchDir, withCompanion ? "mods-with" : "mods-without");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(MODS_DIR)) {
    if (entry === "mod-list.json" || entry === "factorio-companion") continue;
    if (entry === "mod-settings.dat") copyFileSync(join(MODS_DIR, entry), join(dir, entry));
    else symlinkSync(join(MODS_DIR, entry), join(dir, entry));
  }
  if (withCompanion) symlinkSync(repoMod, join(dir, "factorio-companion"), "dir");
  const list = JSON.parse(require("node:fs").readFileSync(join(MODS_DIR, "mod-list.json"), "utf8")) as { mods: { name: string; enabled: boolean }[] };
  list.mods = list.mods.filter((m) => m.name !== "factorio-companion");
  if (withCompanion) list.mods.push({ name: "factorio-companion", enabled: true });
  require("node:fs").writeFileSync(join(dir, "mod-list.json"), JSON.stringify(list, null, 2));
  return dir;
}

async function bench(modDir: string): Promise<{ avg: number; min: number; max: number }[]> {
  const proc = Bun.spawn([BINARY, "--benchmark", save, "--benchmark-ticks", String(ticks), "--benchmark-runs", String(runs), "--mod-directory", modDir, "--disable-audio"], { stdout: "pipe", stderr: "pipe" });
  let out = await new Response(proc.stdout).text();
  await proc.exited;
  // If Steam relaunched the game, output lands in the log instead of our pipe.
  while (isFactorioRunning()) await Bun.sleep(1000);
  if (!/avg:/.test(out)) out = await Bun.file(join(USER_DIR, "factorio-current.log")).text();
  const results = [...out.matchAll(/avg: ([\d.]+) ms, min: ([\d.]+) ms, max: ([\d.]+) ms/g)].map((m) => ({ avg: Number(m[1]), min: Number(m[2]), max: Number(m[3]) }));
  if (results.length === 0) throw new Error(`No benchmark results found. Output tail:\n${out.slice(-1500)}`);
  return results;
}

const summarize = (label: string, r: { avg: number; min: number; max: number }[]) => {
  const avg = r.reduce((s, x) => s + x.avg, 0) / r.length;
  console.log(`${label}: avg ${avg.toFixed(3)} ms/tick (${(1000 / avg).toFixed(0)} UPS), runs ${r.map((x) => x.avg.toFixed(3)).join(" / ")}, worst tick ${Math.max(...r.map((x) => x.max)).toFixed(3)} ms`);
  return avg;
};

console.log(`Benchmarking ${save}: ${ticks} ticks × ${runs} runs each…`);
const without = summarize("without companion", await bench(mirrorMods(false)));
const withMod = summarize("with companion   ", await bench(mirrorMods(true)));
console.log(`companion cost: ${(withMod - without).toFixed(3)} ms/tick (budget: < 0.1 ms avg, no tick > 1 ms)`);
