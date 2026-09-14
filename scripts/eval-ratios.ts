// FC-096: ratio questions through the real server (bun run start). Expected numbers come from an
// independent reference below (hardcoded recipe and machine per question, arithmetic from the dump),
// not from server/src/planner.ts.
import { PrototypesSchema } from "../interfaces/src/index";
import type { ServerMessage } from "../server/src/messages";

const p = PrototypesSchema.parse((await Bun.file(new URL("../data/cache/prototypes.json", import.meta.url)).json()).data);

type Case = { question: string; item: string; rate: number; recipe: string; machine: string; input: string };
const cases: Case[] = [
  { question: "How many assemblers do I need for 120 electronic circuits per minute?", item: "electronic-circuit", rate: 120, recipe: "electronic-circuit", machine: "assembling-machine-3", input: "copper-cable" },
  { question: "What does it take to make 60 iron gear wheels per minute?", item: "iron-gear-wheel", rate: 60, recipe: "iron-gear-wheel", machine: "assembling-machine-3", input: "iron-plate" },
  { question: "How many biochambers for 60 bioflux per minute?", item: "bioflux", rate: 60, recipe: "bioflux", machine: "biochamber", input: "yumako-mash" },
  { question: "I want 30 agricultural science packs per minute. How many biochambers?", item: "agricultural-science-pack", rate: 30, recipe: "agricultural-science-pack", machine: "biochamber", input: "bioflux" },
  { question: "How many chemical plants for 120 plastic bars per minute?", item: "plastic-bar", rate: 120, recipe: "plastic-bar", machine: "chemical-plant", input: "petroleum-gas" },
  { question: "Plan 10 low density structures per minute.", item: "low-density-structure", rate: 10, recipe: "low-density-structure", machine: "assembling-machine-3", input: "copper-plate" },
  { question: "How many assemblers for 60 automation science packs per minute?", item: "automation-science-pack", rate: 60, recipe: "automation-science-pack", machine: "assembling-machine-3", input: "iron-gear-wheel" },
  { question: "What do I need for 60 maraxsis glass panes per minute?", item: "maraxsis-glass-panes", rate: 60, recipe: "maraxsis-glass-panes", machine: "foundry", input: "sand" },
];

// Independent reference: one step, straight from recipe time, products and crafting speed.
function reference(c: Case) {
  const r = p.recipes[c.recipe]!;
  const speed = p.machines[c.machine]!.crafting_speed!;
  const out = r.products.filter((x) => x.name === c.item).reduce((n, x) => n + (x.amount ?? 0) * (x.probability ?? 1), 0);
  const craftsPerMin = c.rate / out;
  const machines = craftsPerMin / ((60 * speed) / r.energy);
  const ing = r.ingredients.find((i) => i.name === c.input)!;
  return { machines, inputRate: craftsPerMin * ing.amount };
}

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
await until((m) => m.type === "status" && m.model.state === "ready", 120_000);

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02 * Math.abs(b), 0.011);
let passed = 0;
for (const c of cases) {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: c.question }));
  const done = (await until((m) => m.type === "done" || m.type === "error", 120_000, from)) as any;
  const slice = got.slice(from);
  const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("");
  const plan = (slice.find((m) => m.type === "plan") as any)?.plan;
  const ref = reference(c);
  const numbers = [...answer.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const machinesOk = numbers.some((n) => near(n, ref.machines)) || numbers.some((n) => near(n, Math.ceil(ref.machines)) && /round|ceil|at least|build/i.test(answer));
  const inputOk = numbers.some((n) => near(n, ref.inputRate));
  const planStep = plan?.steps?.find((s: any) => s.item === c.item);
  const planOk = !!planStep && planStep.machine === c.machine && near(planStep.machines, ref.machines);
  const ok = done?.type === "done" && machinesOk && inputOk && planOk;
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.question}\n      reference: ${ref.machines.toFixed(2)}× ${c.machine}, ${c.input} ${ref.inputRate.toFixed(1)}/min | plan: ${planStep ? `${planStep.machines}× ${planStep.machine}` : "none"} | answer ok: machines ${machinesOk}, input ${inputOk} [${done?.totalMs ? (done.totalMs / 1000).toFixed(1) : "?"} s]\n      ${answer.trim().replace(/\n+/g, " ").slice(0, 220)}`);
}
ws.close();
console.log(`\n${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);
