// FC-080: where the time goes, from data/eval/turns.jsonl (written by the server per answer).
// Usage: bun scripts/latency-report.ts [--since ISO-time] [--last N]
const args = Bun.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1]! : "";
const last = args.includes("--last") ? Number(args[args.indexOf("--last") + 1]) : Infinity;
const lines = (await Bun.file(new URL("../data/eval/turns.jsonl", import.meta.url)).text()).trim().split("\n").filter(Boolean);
type Turn = import("../server/src/agent").TurnRecord;
const turns: Turn[] = lines.map((l) => JSON.parse(l)).filter((t: Turn & { kind?: string }) => !t.kind && Array.isArray(t.rounds) && t.rounds.length > 0 && t.at >= since).slice(-last);
if (!turns.length) { console.log("No turns recorded."); process.exit(0); }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN; };
const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const first = (t: Turn) => t.rounds[0]!;
const uncached = (t: Turn) => (first(t).promptTokens ?? 0) - (first(t).cachedTokens ?? 0);
const charsPerToken = median(turns.map((t) => (t.chars.system + t.chars.history + t.chars.question + t.chars.retrieved + t.chars.snapshot) / Math.max(first(t).promptTokens ?? 1, 1)));
const tok = (chars: number) => Math.round(chars / charsPerToken);

console.log(`${turns.length} turns · ~${charsPerToken.toFixed(2)} chars/token\n`);
console.log("visible ttft  server ttft  rounds  prompt/cached(uncached)  tail tokens: question+retrieved+snapshot  history  out  question");
for (const t of turns) {
  const f = first(t);
  console.log(
    `${fmt(t.visibleTtftMs ?? NaN).padStart(8)}  ${`${(f.serverTtftS ?? NaN).toFixed(2)} s`.padStart(10)}  ${String(t.rounds.length).padStart(6)}  ${`${f.promptTokens}/${f.cachedTokens}(${uncached(t)})`.padStart(22)}  ${`${tok(t.chars.question)}+${tok(t.chars.retrieved)}+${tok(t.chars.snapshot)}`.padStart(40)}  ${String(tok(t.chars.history)).padStart(7)}  ${String(t.rounds.at(-1)!.completionTokens ?? "?").padStart(3)}  ${t.question.slice(0, 60)}`,
  );
}
const single = turns.filter((t) => t.rounds.length === 1);
console.log(`\nmedian visible ttft ${fmt(median(turns.map((t) => t.visibleTtftMs ?? NaN)))} · single-round ${fmt(median(single.map((t) => t.visibleTtftMs ?? NaN)))} · with tools ${fmt(median(turns.filter((t) => t.rounds.length > 1).map((t) => t.visibleTtftMs ?? NaN)))}`);
console.log(`median uncached tokens ${median(turns.map(uncached))} · median snapshot ${tok(median(turns.map((t) => t.chars.snapshot)))} tok · retrieved ${tok(median(turns.map((t) => t.chars.retrieved)))} tok · system ${tok(median(turns.map((t) => t.chars.system)))} tok`);
console.log(`median gap visible − server ttft (single-round): ${fmt(median(single.map((t) => (t.visibleTtftMs ?? 0) - (first(t).serverTtftS ?? 0) * 1000)))}`);
