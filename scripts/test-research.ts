// FC-103: research completion patches the companion's prototype data without a full dump.
// Runs a GameLink against the hosted dev save, researches technologies by test tooling, and compares the
// patched data with a fresh full dump. Research is reverted afterwards (nothing is saved anyway).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCommand, parseReply, type Prototypes } from "../interfaces/src/index";
import { GameLink } from "../server/src/game";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
let id = 1;
const raw = async (action: string, args: Record<string, unknown> = {}) => parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile: true })));

// Candidates: unresearched, prerequisites done, unlocking recipes; plus one recipe productivity technology.
const pick = JSON.parse(await dev.sc(`local f = game.forces.player local unlock, prod = nil, nil
  for name, t in pairs(f.technologies) do
    if not t.researched and t.enabled then
      local ready = true
      for _, pre in pairs(t.prerequisites) do if not pre.researched then ready = false end end
      for _, e in pairs(t.prototype.effects or {}) do
        if ready and not unlock and e.type == "unlock-recipe" then unlock = name end
        if ready and not prod and e.type == "change-recipe-productivity" then prod = name end
      end
    end
  end
  rcon.print(helpers.table_to_json({ unlock = unlock or "", prod = prod or "" }))`)) as { unlock: string; prod: string };
const techs = [pick.unlock, pick.prod].filter(Boolean);
console.log(`  researching: ${techs.join(", ")}`);

const link = new GameLink({ pollMs: 500, eventPollMs: 100, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-research-")) });
link.start();
const until = async (cond: () => boolean, ms: number) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await Bun.sleep(50); return cond(); };
await until(() => link.prototypes() !== null && link.latest() !== undefined, 60_000);
await Bun.sleep(500); // the first event poll only records the sequence number
const before = link.prototypes()!;
let dumps = 0;
const call = link.call.bind(link);
link.call = (async (action: any, args?: any) => { if (action === "dump_prototypes") dumps++; return call(action, args); }) as typeof link.call;

const t0 = performance.now();
await dev.sc(`local f = game.forces.player for _, name in pairs(helpers.json_to_table('${JSON.stringify(techs)}')) do f.technologies[name].researched = true end rcon.print("ok")`);
const patched = await until(() => link.prototypes() !== before, 5000);
check("research completion updates the companion's data", patched, `${(performance.now() - t0).toFixed(0)} ms`);
check("without a full prototype dump", dumps === 0, `${dumps} dumps`);

const full = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action: "dump_prototypes", args: {} }))).reply.data as Prototypes;
const got = link.prototypes()!.data;
const diffs: string[] = [];
for (const [name, r] of Object.entries(full.recipes)) {
  const g = got.recipes[name];
  if (!g || g.enabled !== r.enabled || (g.productivity_bonus ?? 0) !== (r.productivity_bonus ?? 0)) diffs.push(`recipe ${name}: ${g?.enabled}/${g?.productivity_bonus} vs ${r.enabled}/${r.productivity_bonus}`);
}
for (const [name, t] of Object.entries(full.technologies)) if (got.technologies[name]?.researched !== t.researched) diffs.push(`technology ${name}`);
const flipped = Object.keys(full.recipes).filter((n) => before.data.recipes[n]?.enabled !== full.recipes[n]!.enabled || before.data.recipes[n]?.productivity_bonus !== full.recipes[n]!.productivity_bonus);
check("patched data matches a fresh full dump", diffs.length === 0 && flipped.length > 0, diffs.slice(0, 3).join("; ") || `${flipped.length} recipes changed: ${flipped.slice(0, 4).join(", ")}`);

const targeted: number[] = [], whole: number[] = [];
for (let i = 0; i < 5; i++) targeted.push(parseFloat((await raw("research_state", { technologies: techs })).profile!));
for (let i = 0; i < 5; i++) whole.push(parseFloat((await raw("research_state")).profile!));
targeted.sort((a, b) => a - b); whole.sort((a, b) => a - b);
check("game-side cost after a research is under 1 ms", targeted[4]! < 1, `targeted max ${targeted[4]!.toFixed(3)} ms; whole force on connect ${whole[2]!.toFixed(3)} ms`);

link.stop();
await dev.sc(`local f = game.forces.player for _, name in pairs(helpers.json_to_table('${JSON.stringify(techs)}')) do f.technologies[name].researched = false end rcon.print("ok")`);
dev.rcon.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
