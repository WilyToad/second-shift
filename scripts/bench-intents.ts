// FC-245: how well does Jev classify the player's questions, against the regexes that do it today?
//
// No routing changes here and nothing ships from this script — it answers the one question that decides whether
// FC-245 is worth building: on the reviewed corpus, is Jev right more often than the code is, per classifier?
// Both are scored against the same hand-reviewed rows (`server/src/intent-corpus.ts`), so the comparison is fair.
//
// One call per question, every classifier in it: that is how the turn would use it (FC-244 measured twenty
// questions in one call at 156 ms against 3,757 ms sequentially).
//
// Usage (no game, no server): bun scripts/bench-intents.ts [--limit N]
import { Decisions } from "../server/src/decisions";
import { CLASSIFIERS, CORPUS } from "../server/src/intent-corpus";

/** What each classifier means, in the words Jev is asked. One sentence, no double negatives, no second hop. */
const ASKED: Record<string, string> = {
  world: "Does answering this need a look at the player's live game — entities, positions, what they are carrying — rather than recipe or technology data alone?",
  urgent: "Is the player acting right now, so the answer should be flat facts with no flavour?",
  bare: "Is this a short follow-up that only makes sense as a continuation of the previous question?",
  build: "Is the player asking for something to be built or placed in their game?",
  bp: "Is the player asking for a blueprint?",
  chart: "Is the player asking for a chart or a graph?",
  start: "Is the player asking what they should do or work on next?",
  packing: "Is the player describing a build they are about to go and make, listing what they need to bring?",
  stock: "Is the player asking where something is, or how many of it they have?",
  ready: "Is the player asking whether they have everything they need before setting off?",
  pic: "Is the player asking for a screenshot or picture?",
  around: "Is the player asking about their immediate surroundings, or telling the companion what they can see around them?",
  status: "Does answering this need to know what the player is carrying, crafting or holding?",
  spider: "Is the player asking for their spidertron to be sent somewhere?",
  stop: "Is the player telling the companion to stop what it is doing?",
  contents: "Is the player asking what is inside a container?",
  pointed: "Is the player asking about the particular thing their mouse is over?",
  measured: "Is the player asking what rate machines are actually achieving, rather than a theoretical rate?",
  fill: "Is the player asking for robots to fetch or deliver the things on their list?",
  paste: "Is the player asking for a blueprint to be placed in the world now, rather than just designed?",
  mark: "Is the player asking for something to be marked for deconstruction?",
  research: "Is the player asking for a technology to be queued for research?",
};

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const rows = CORPUS.slice(0, limit);
const names = Object.keys(CLASSIFIERS);
const missing = names.filter((n) => !ASKED[n]);
if (missing.length) {
  console.error(`no question written for: ${missing.join(", ")} — add it to ASKED`);
  process.exit(1);
}

const decisions = new Decisions({ log: console.log });
if (!decisions.available()) {
  console.error("No JEV_KEY in .env (or COMPANION_DECISIONS=local): nothing to benchmark against.");
  process.exit(1);
}

type Tally = { regexRight: number; jevRight: number; jevAsked: number; jevWrongTrue: number; jevWrongFalse: number };
const tally: Record<string, Tally> = Object.fromEntries(names.map((n) => [n, { regexRight: 0, jevRight: 0, jevAsked: 0, jevWrongTrue: 0, jevWrongFalse: 0 }]));
const disagreements: string[] = [];
const times: number[] = [];

for (const [question, expected] of rows) {
  const want = new Set(expected);
  const started = performance.now();
  const answers = await decisions.decide(
    `A player is playing Factorio with a companion that answers questions and can act in their game. They just said: "${question}"`,
    Object.fromEntries(names.map((n) => [n, { type: "noul" as const, instructions: ASKED[n]!, local: CLASSIFIERS[n]!(question) }])),
    { budgetMs: 10_000 },
  );
  times.push(performance.now() - started);
  for (const name of names) {
    const truth = want.has(name);
    const regex = CLASSIFIERS[name]!(question);
    const a = answers[name]!;
    const t = tally[name]!;
    if (regex === truth) t.regexRight++;
    // Scored on what Jev actually said, not on the fallback: an unsure answer is counted as the regex's, which is
    // what would happen in the turn, but tracked separately so "how often does it decline" is visible.
    if (a.via === "jev") t.jevAsked++;
    if (a.value === truth) t.jevRight++;
    else if (a.value) t.jevWrongTrue++;
    else t.jevWrongFalse++;
    if (regex === truth && a.value !== truth && a.via === "jev") disagreements.push(`  ${name.padEnd(9)} "${question.slice(0, 64)}" — regex right (${truth}), Jev said ${a.value} at ${a.confidence.toFixed(2)}`);
  }
}

const total = rows.length;
console.log(`FC-245 — ${total} reviewed questions × ${names.length} classifiers, one call per question\n`);
console.log(`${"classifier".padEnd(10)} ${"regex".padStart(7)} ${"jev".padStart(7)}   ${"jev asked".padStart(9)}  wrong-true/wrong-false`);
const better: string[] = [];
for (const name of names) {
  const t = tally[name]!;
  const flag = t.jevRight > t.regexRight ? " ←" : t.jevRight < t.regexRight ? " ✗" : "";
  if (t.jevRight > t.regexRight) better.push(name);
  console.log(`${name.padEnd(10)} ${`${t.regexRight}/${total}`.padStart(7)} ${`${t.jevRight}/${total}`.padStart(7)}   ${String(t.jevAsked).padStart(9)}  ${t.jevWrongTrue}/${t.jevWrongFalse}${flag}`);
}
const sum = (f: (t: Tally) => number) => names.reduce((n, name) => n + f(tally[name]!), 0);
console.log(`\noverall: regex ${sum((t) => t.regexRight)}/${total * names.length}, Jev ${sum((t) => t.jevRight)}/${total * names.length}`);
console.log(`Jev answered ${sum((t) => t.jevAsked)} of ${total * names.length} confidently; the rest fell to the regex.`);
const sorted = times.slice().sort((a, b) => a - b);
console.log(`per question (all ${names.length} classifiers in one call): p50 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(0)} ms`);
console.log(`${decisions.counts.calls} calls, ${decisions.counts.inputTokens} input tokens (about $${((decisions.counts.inputTokens / 1e6) * 0.042).toFixed(4)})`);
console.log(`\nclassifiers where Jev is ahead: ${better.length ? better.join(", ") : "none"}`);
if (disagreements.length) console.log(`\nwhere the regex was right and Jev was confidently wrong (${disagreements.length}):\n${disagreements.slice(0, 20).join("\n")}`);

const path = new URL(`../data/eval/bench-intents-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url).pathname;
await Bun.write(path, JSON.stringify({ at: new Date().toISOString(), total, tally, better, calls: decisions.counts }, null, 2));
console.log(`\nSaved to ${path}`);
process.exit(0);
