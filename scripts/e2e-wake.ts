// FC-158: does keeping the model awake while the player talks shorten first words? Alternates turns with and without
// wake-ups, each after the pause a spoken question takes (the model idles in that pause without them).
// Usage (server and dev save running): bun scripts/e2e-wake.ts   (resets the conversation)
import type { ServerMessage } from "../server/src/messages";

// Read-only questions from the first voice session (2026-09-15), twice over so both arms see similar history sizes.
const base = ["What's around me?", "What do I have in my inventory?", "How many transport belts are near me?", "What do I use these for?", "Where is the rocket silo?", "How many radars are near me?"];
const questions = [...base, ...base];
const PAUSE_MS = 6_000; // silence before the player starts talking: long enough for the model to idle
const TALK_MS = 4_000; // speaking plus the 2 s end-of-speech wait
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

const results: Record<"warm" | "cold", number[]> = { warm: [], cold: [] };
for (const [i, q] of questions.entries()) {
  const arm = (i % 2 === 0) === (i < base.length) ? "warm" : "cold"; // ABAB then BABA
  await Bun.sleep(PAUSE_MS);
  const talkEnd = performance.now() + TALK_MS;
  while (performance.now() < talkEnd) {
    if (arm === "warm") ws.send(JSON.stringify({ type: "wake" }));
    await Bun.sleep(1_200);
  }
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: q }));
  const done = (await until((m) => m.type === "done" || m.type === "error", 120_000, from)) as Extract<ServerMessage, { type: "done" }> | null;
  const approvals = got.slice(from).filter((m) => m.type === "approval") as Extract<ServerMessage, { type: "approval" }>[];
  for (const a of approvals) ws.send(JSON.stringify({ type: "decline", id: a.id }));
  const ms = done?.ttftMs ?? NaN;
  results[arm].push(ms);
  console.log(`${String(i + 1).padStart(2)} ${arm}  first ${(ms / 1000).toFixed(2)} s  prompt ${done?.promptTokens} (${done?.cachedTokens} cached)  ${q}`);
}
ws.close();
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
console.log(`\nfirst words, median: with wake-ups ${(median(results.warm) / 1000).toFixed(2)} s, without ${(median(results.cold) / 1000).toFixed(2)} s`);
