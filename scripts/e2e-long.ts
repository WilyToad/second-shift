// FC-076: a long conversation through the real server; follow-ups should stay fast as history grows.
import type { ServerMessage } from "../server/src/messages";

const questions = [
  "What makes bioflux?", "And what makes jelly?", "What's my iron plate production on the factory floor?", "How is my science doing?",
  "What do maraxsis glass panes need?", "What unlocks them?", "What makes plastic bars?", "How do I make low density structures?",
  "What does a foundry craft?", "What makes holmium plates?", "What's the recipe for carbon fiber?", "How many copper cables in a green circuit?",
  "What does a biochamber need to run?", "What spoils fastest in my save?", "What makes sulfuric acid?", "Summarize what we talked about in one sentence.",
];
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
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000);
const startedAt = new Date().toISOString();

const ttfts: number[] = [];
for (const [i, q] of questions.entries()) {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: q }));
  const done = (await until((m) => m.type === "done" || m.type === "error", 120_000, from)) as Extract<ServerMessage, { type: "done" }> | null;
  const ms = done?.ttftMs ?? NaN;
  if (i > 0) ttfts.push(ms);
  console.log(`${String(i + 1).padStart(2)}  first ${(ms / 1000).toFixed(2)} s  prompt ${done?.promptTokens} (${done?.cachedTokens} cached)  ${q}`);
}
ws.close();

const lines = (await Bun.file(new URL("../data/eval/turns.jsonl", import.meta.url)).text()).trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.at >= startedAt);
const compactions = lines.filter((r) => r.kind === "compaction");
for (const c of compactions) console.log(`compaction: ~${c.beforeTokens} -> ~${c.afterTokens} tokens, re-warm ${(c.warmMs / 1000).toFixed(2)} s`);
const sorted = [...ttfts].sort((a, b) => a - b);
const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
console.log(`\nfollow-ups: median ${(sorted[Math.floor(sorted.length / 2)]! / 1000).toFixed(2)} s, p90 ${(p90 / 1000).toFixed(2)} s, max ${(sorted.at(-1)! / 1000).toFixed(2)} s; ${compactions.length} compaction(s)`);
process.exit(p90 <= 2500 && compactions.length > 0 ? 0 : 1);
