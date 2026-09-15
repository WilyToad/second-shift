// FC-158: does a pause between questions (the player talking, playing) slow the next first token?
// Usage (oMLX running): bun scripts/probes/idle-gap.ts [gapSeconds...]
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const words = "iron plate copper cable assembler inserter belt furnace chest radar silo train stop signal pump refinery".split(" ");
const text = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `${words[(i * 7 + seed) % words.length]} ${(i * 13 + seed) % 997}`).join(" ");
const sys = { role: "system" as const, content: `nonce ${crypto.randomUUID()}\n${text(850, 1)}` };
await model.stream([sys, { role: "user", content: "OK?" }], { maxTokens: 1 });
const gaps = Bun.argv.slice(2).map(Number);
for (const [i, gap] of (gaps.length ? gaps : [0, 5, 20, 45, 0]).entries()) {
  await Bun.sleep(gap * 1000);
  const t0 = performance.now();
  const r = await model.stream([sys, { role: "user", content: `${text(200, i + 50)}\nOK?` }], { maxTokens: 1 });
  console.log(`after ${gap}s idle: uncached ${(r.usage?.prompt_tokens ?? 0) - (r.usage?.prompt_tokens_details?.cached_tokens ?? 0)}, first token ${(r.usage?.time_to_first_token ?? 0).toFixed(2)} s, wall ${((performance.now() - t0) / 1000).toFixed(2)} s`);
}
