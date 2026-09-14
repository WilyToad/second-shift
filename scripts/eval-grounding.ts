// FC-014: scripted grounding check against the running server (bun run start).
// Expected facts are computed from the save's own prototype data, not written by hand.
// Usage: bun scripts/eval-grounding.ts [--url ws://127.0.0.1:5170/ws]
import { mkdirSync } from "node:fs";
import { PrototypesSchema, type Prototypes } from "../interfaces/src/index";
import { craftersByCategory } from "../server/src/grounding";

const url = Bun.argv.includes("--url") ? Bun.argv[Bun.argv.indexOf("--url") + 1]! : "ws://127.0.0.1:5170/ws";
const cache = Bun.file(new URL("../data/cache/prototypes.json", import.meta.url));
const p: Prototypes = PrototypesSchema.parse((await cache.json()).data);
const crafters = craftersByCategory(p);

type Case = { question: string; mustInclude: string[]; mustNotInclude?: string[]; negative?: boolean };
const recipeFacts = (name: string) => {
  const r = p.recipes[name]!;
  return [...r.ingredients.map((i) => `${i.amount} ${i.name}`), ...(crafters.get(r.category) ?? []).filter((c) => c !== "by hand").slice(0, 1)];
};
const tech = (name: string) => p.technologies[name]!;

const cases: Case[] = [
  { question: "What makes bioflux, and where can it be crafted?", mustInclude: recipeFacts("bioflux") },
  { question: "How do I craft agricultural science packs?", mustInclude: recipeFacts("agricultural-science-pack") },
  { question: "What's the recipe for carbon fiber?", mustInclude: recipeFacts("carbon-fiber") },
  { question: "What do maraxsis glass panes need?", mustInclude: recipeFacts("maraxsis-glass-panes") },
  { question: "What goes into a Cerys charging rod?", mustInclude: recipeFacts("cerys-charging-rod") },
  { question: "How many copper cables does a green circuit take?", mustInclude: ["3 copper cable"] },
  {
    question: "What do I need before I can research agricultural science?",
    mustInclude: [...tech("agricultural-science-pack").prerequisites, String((tech("agricultural-science-pack").trigger as { count?: number })?.count ?? "")].filter(Boolean),
  },
  { question: "How long does yumako last before it spoils, and what does it turn into?", mustInclude: [String(p.items["yumako"]!.spoil_ticks! / 3600), p.items["yumako"]!.spoil_result!] },
  { question: "What's the crafting speed of a biochamber?", mustInclude: [String(p.machines["biochamber"]!.crafting_speed)] },
  { question: "How do I craft a quantum widget?", mustInclude: [], negative: true },
];

const norm = (s: string) => s.toLowerCase().replace(/[*_`]/g, "").replace(/[-]/g, " ").replace(/\s+/g, " ");
// Plural-tolerant: "3 copper cables" satisfies "3 copper cable".
const includes = (answer: string, term: string) => norm(answer).includes(norm(term));

const ws = new WebSocket(url);
let answer = "";
let onDone: (m: any) => void = () => {};
let ready = false;
let tools = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === "status") ready = m.model.state === "ready";
  if (m.type === "token") answer += m.text;
  if (m.type === "tool") tools++;
  if (m.type === "done" || m.type === "error" || m.type === "reset") onDone(m);
};
await new Promise((r) => (ws.onopen = r));
for (let i = 0; i < 600 && !ready; i++) await Bun.sleep(250);

const send = (msg: object) => new Promise<any>((resolve) => { answer = ""; tools = 0; onDone = resolve; ws.send(JSON.stringify(msg)); });
const results = [];
for (const c of cases) {
  await send({ type: "reset" });
  const done = await send({ type: "ask", text: c.question });
  const missing = c.mustInclude.filter((t) => !includes(answer, t));
  const refused = /\b(no|not|cannot|can't|isn't|doesn't|don't|couldn't|unknown|unable)\b/i.test(answer) && !/->|→/.test(answer);
  const pass = done.type === "done" && (c.negative ? refused : missing.length === 0);
  results.push({ ...c, pass, missing, answer, toolCalls: tools, ttftMs: done.ttftMs, totalMs: done.totalMs, completionTokens: done.completionTokens, promptTokens: done.promptTokens, cachedTokens: done.cachedTokens });
  console.log(`${pass ? "PASS" : "FAIL"}  ${(done.ttftMs / 1000).toFixed(1)}s first / ${(done.totalMs / 1000).toFixed(1)}s total / ${done.completionTokens} tok / prompt ${done.promptTokens} (${done.cachedTokens} cached)${tools ? ` / ${tools} tool` : ""}  ${c.question}${missing.length ? `\n      missing: ${missing.join(", ")}` : ""}`);
}

// Warm follow-up in the same conversation (FC-013): prefix cache should cover system + previous turn.
await send({ type: "reset" });
await send({ type: "ask", text: cases[0]!.question });
const follow = await send({ type: "ask", text: "And how many biochambers would I need for 60 bioflux per minute?" });
console.log(`\nfollow-up: first token ${(follow.ttftMs / 1000).toFixed(2)} s, prompt ${follow.promptTokens}, cached ${follow.cachedTokens}`);
ws.close();

const passed = results.filter((r) => r.pass).length;
const ttfts = results.map((r) => r.ttftMs).sort((a, b) => a - b);
const tokens = results.map((r) => r.completionTokens).sort((a, b) => a - b);
console.log(`\n${passed}/${results.length} passed · first token median ${(ttfts[Math.floor(ttfts.length / 2)]! / 1000).toFixed(2)} s, max ${(ttfts.at(-1)! / 1000).toFixed(2)} s · answer tokens median ${tokens[Math.floor(tokens.length / 2)]}, max ${tokens.at(-1)}`);
mkdirSync(new URL("../data/eval", import.meta.url), { recursive: true });
await Bun.write(new URL(`../data/eval/grounding-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url), JSON.stringify({ results, followUp: follow }, null, 2));
process.exit(passed === results.length ? 0 : 1);
