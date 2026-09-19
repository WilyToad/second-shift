// FC-233 spike: can a small local model scored Jev-style (option logits after one prefill) tell the player's voice
// from the companion's own echo better than `looksLikeEcho()` (FC-217)? Builds the cases from real answer sentences
// in data/eval and the player's kept clips, runs the code rule and jevmlx over the same cases, and reports accuracy,
// latency and memory. Usage: bun scripts/eval-barge-scorer.ts [--model test|fast|quality|<hub id>] [--batch N]
// [--scoring slots|labels] [--prior] (jevmlx's neutral-context prior correction) [--rule-only] (no model; FC-234)
import { readdirSync } from "node:fs";
import { Window } from "../displays/node_modules/happy-dom";

const dir = new URL("../data/", import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : fallback; };
const model = opt("--model", "test");
const batch = Number(opt("--batch", "1"));
const extra = [...(args.includes("--prior") ? ["--prior"] : []), "--scoring", opt("--scoring", "slots")];
const ruleOnly = args.includes("--rule-only");

// The same rule the console runs, imported from the console's own module (browser globals first).
const window = new Window({ url: "http://127.0.0.1:5170/" });
Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, KeyboardEvent: window.KeyboardEvent, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
const { looksLikeEcho } = await import("../displays/src/voice");

// Deterministic sampling, so a rerun scores the same cases.
let seed = 20260919;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

// Real companion sentences, from every eval run that kept its answers.
const answers = new Set<string>();
const walk = (o: unknown) => {
  if (Array.isArray(o)) for (const x of o) walk(x);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "answer" && typeof v === "string") answers.add(v); else walk(v); }
};
for (const f of readdirSync(`${dir}eval`)) if (f.endsWith(".json")) { try { walk(await Bun.file(`${dir}eval/${f}`).json()); } catch { /* not every file is JSON we can read */ } }
const sentences = [...new Set([...answers].flatMap((a) => a.replace(/```[\s\S]*?```/g, "").replace(/\*\*|`|#+ /g, "").replace(/\n/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim())
  .filter((s) => { const n = s.split(/\s+/).length; return n >= 6 && n <= 30 && !s.includes("|"); })))];

// The player's own words, from the kept clips (their correction when they gave one).
const said: string[] = [];
for (const f of readdirSync(`${dir}captures/voice`)) if (f.endsWith(".json")) { const d = await Bun.file(`${dir}captures/voice/${f}`).json(); const t = (d.said ?? d.heard ?? "").trim(); if (t && t.split(/\s+/).length >= 2) said.push(t); }

// What a recognizer makes of an echo: the sentence, a leading or trailing piece of it, or a garbled version.
const words = (s: string) => s.replace(/[^\w' ]+/g, " ").split(/\s+/).filter(Boolean);
const HOMOPHONES: Record<string, string> = { two: "to", to: "two", four: "for", for: "four", plate: "plate", belt: "built", steel: "steal", copper: "copper", iron: "I earn", wire: "wine", "there": "their", "queue": "cue", "labs": "lambs", "one": "won" };
const garble = (s: string) => words(s).filter((_, i) => i % 4 !== 3).map((w) => HOMOPHONES[w.toLowerCase()] ?? w).join(" ");
const head = (s: string) => words(s).slice(0, 3 + Math.floor(rand() * 4)).join(" ");
const tail = (s: string) => words(s).slice(-(3 + Math.floor(rand() * 3))).join(" ");

type Case = { id: string; kind: string; truth: "player" | "echo"; spoken: string; heard: string };
const cases: Case[] = [];
let n = 0;
const add = (kind: string, truth: Case["truth"], spoken: string, heard: string) => cases.push({ id: `c${++n}`, kind, truth, spoken, heard });
const pool = [...sentences].sort(() => rand() - 0.5).slice(0, 120);
for (const s of pool) {
  add("echo: whole sentence", "echo", s, s.toLowerCase().replace(/[.!?]+$/, ""));
  add("echo: leading piece", "echo", s, head(s).toLowerCase());
  add("echo: trailing piece", "echo", s, tail(s).toLowerCase());
  add("echo: garbled", "echo", s, garble(s).toLowerCase());
}
for (const t of said) for (let i = 0; i < 3; i++) add("player: a real question", "player", pick(sentences), t);
// The hard ones: the player cutting in with the companion's own words in their mouth, and one-word cut-ins.
const cutIns = [(q: string) => `what do you mean ${q}?`, (q: string) => `wait, ${q}?`, (q: string) => `${q}, which one?`, (q: string) => `say that again, ${q}`, (q: string) => `no, not ${q}`];
for (const s of pool.slice(0, 60)) add("player: quoting him back", "player", s, pick(cutIns)(tail(s).toLowerCase()));
for (const w of ["stop", "wait", "hold on", "no", "quiet", "Ballast", "hang on", "shush", "stop stop"]) for (let i = 0; i < 4; i++) add("player: one-word cut-in", "player", pick(sentences), w);
// Echoes that begin exactly like a cut-in word by chance are rare and left out on purpose: the question is the
// heard text against the spoken one, not the word list.

const rule = new Map(cases.map((c) => [c.id, looksLikeEcho(c.heard, [c.spoken]) ? "echo" : "player"] as const));

if (ruleOnly) {
  const kinds = [...new Set(cases.map((c) => c.kind))];
  console.log(`FC-234 echo rule — ${cases.length} cases\n`);
  for (const k of kinds) { const sel = cases.filter((c) => c.kind === k); console.log(`${k.padEnd(28)} ${`${sel.filter((c) => rule.get(c.id) === c.truth).length}/${sel.length}`.padStart(9)}`); }
  console.log(`${"overall".padEnd(28)} ${`${cases.filter((c) => rule.get(c.id) === c.truth).length}/${cases.length}`.padStart(9)}`);
  for (const c of cases.filter((c) => rule.get(c.id) !== c.truth).slice(0, 8)) console.log(`  [${c.kind}] said "${c.spoken.slice(0, 60)}…" heard "${c.heard}" → rule ${rule.get(c.id)}`);
  process.exit(0);
}

// jevmlx, in the venv, over the same cases.
const t0 = performance.now();
const proc = Bun.spawn([".venv-jev/bin/python", "scripts/lib/barge-jev.py", "--model", model, "--batch", String(batch), ...extra], { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd: new URL("..", import.meta.url).pathname });
proc.stdin.write(cases.map((c) => JSON.stringify({ id: c.id, spoken: c.spoken, heard: c.heard })).join("\n") + "\n");
proc.stdin.end();
const out = await new Response(proc.stdout).text();
const err = await new Response(proc.stderr).text();
if ((await proc.exited) !== 0) { console.error(err.split("\n").slice(-12).join("\n")); process.exit(1); }
const lines = out.trim().split("\n").map((l) => JSON.parse(l));
const meta = lines.pop() as { footprint_mb: number; model: string; load_ms: number };
const scored = new Map(lines.map((r) => [r.id as string, r as { who: "player" | "echo"; p_player: number | null; p_echo: number | null; ms: number }]));
const wall = (performance.now() - t0) / 1000;

// Report.
const kinds = [...new Set(cases.map((c) => c.kind))];
const acc = (f: (c: Case) => string | undefined, sel: Case[]) => { const ok = sel.filter((c) => f(c) === c.truth).length; return `${ok}/${sel.length}`; };
console.log(`FC-233 barge-in scorer — ${cases.length} cases (${sentences.length} real sentences, ${said.length} player transcripts), model ${meta.model}\n`);
console.log(`${"kind".padEnd(28)} ${"rule".padStart(9)} ${"jevmlx".padStart(9)}`);
for (const k of kinds) { const sel = cases.filter((c) => c.kind === k); console.log(`${k.padEnd(28)} ${acc((c) => rule.get(c.id), sel).padStart(9)} ${acc((c) => scored.get(c.id)?.who, sel).padStart(9)}`); }
for (const truth of ["echo", "player"] as const) { const sel = cases.filter((c) => c.truth === truth); console.log(`${("all " + truth).padEnd(28)} ${acc((c) => rule.get(c.id), sel).padStart(9)} ${acc((c) => scored.get(c.id)?.who, sel).padStart(9)}`); }
console.log(`${"overall".padEnd(28)} ${acc((c) => rule.get(c.id), cases).padStart(9)} ${acc((c) => scored.get(c.id)?.who, cases).padStart(9)}`);
const ms = [...scored.values()].map((r) => r.ms).sort((a, b) => a - b);
const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!.toFixed(0);
console.log(`\nlatency per decision: p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms (batch ${batch}); load+warm ${(meta.load_ms / 1000).toFixed(1)} s; process footprint ${meta.footprint_mb} MB; wall ${wall.toFixed(0)} s`);
// Confidence: how sure the model was when wrong, since a hint that's confidently wrong is worse than none.
const wrong = cases.filter((c) => scored.get(c.id)?.who !== c.truth);
const conf = (c: Case) => { const r = scored.get(c.id)!; return r.who === "player" ? r.p_player : r.p_echo; };
const wrongConf = wrong.map(conf).filter((p): p is number => typeof p === "number");
if (wrongConf.length) console.log(`when wrong, the model's own probability was ≥0.8 in ${wrongConf.filter((p) => p >= 0.8).length} of ${wrongConf.length} cases`);
console.log(`\ndisagreements where the rule was right and the model wrong (first 6):`);
for (const c of wrong.filter((c) => rule.get(c.id) === c.truth).slice(0, 6)) console.log(`  [${c.kind}] said "${c.spoken.slice(0, 60)}…" heard "${c.heard}" → model ${scored.get(c.id)!.who} (${(conf(c) ?? 0).toFixed(2)})`);
console.log(`disagreements where the model was right and the rule wrong (first 6):`);
for (const c of cases.filter((c) => rule.get(c.id) !== c.truth && scored.get(c.id)?.who === c.truth).slice(0, 6)) console.log(`  [${c.kind}] said "${c.spoken.slice(0, 60)}…" heard "${c.heard}" → rule ${rule.get(c.id)}`);

const path = `${dir}eval/barge-scorer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await Bun.write(path, JSON.stringify({ at: new Date().toISOString(), model: meta.model, batch, cases: cases.map((c) => ({ ...c, rule: rule.get(c.id), model: scored.get(c.id) })), latencyMs: { p50: Number(q(0.5)), p95: Number(q(0.95)) }, footprintMb: meta.footprint_mb, loadMs: meta.load_ms }, null, 2));
console.log(`\nSaved to ${path}`);
process.exit(0);
