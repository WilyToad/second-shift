// FC-158: first-token time against the uncached tail past a cached 4,096-token block, with nothing else changing.
// Usage (oMLX running): bun scripts/probes/suffix-prefill.ts
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const words = "iron plate copper cable assembler inserter belt furnace chest radar silo train stop signal pump refinery".split(" ");
const text = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `${words[(i * 7 + seed) % words.length]} ${(i * 13 + seed) % 997}`).join(" ");
const sys = { role: "system" as const, content: `nonce ${crypto.randomUUID()}\n${text(850, 1)}` };
const warm = await model.stream([sys, { role: "user", content: "OK?" }], { maxTokens: 1 });
console.log(`warm: prompt ${warm.usage?.prompt_tokens}, cached ${warm.usage?.prompt_tokens_details?.cached_tokens}`);
for (const round of [1, 2]) {
  for (const pairs of [40, 100, 200, 300, 400, 500]) {
    const r = await model.stream([sys, { role: "user", content: `${text(pairs, round * 1000 + pairs)}\nOK?` }], { maxTokens: 1 });
    const p = r.usage?.prompt_tokens ?? 0, c = r.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    console.log(`round ${round}: prompt ${p}, cached ${c}, uncached ${p - c}, first token ${(r.usage?.time_to_first_token ?? 0).toFixed(2)} s`);
  }
}
