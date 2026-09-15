// FC-158: how long oMLX stays awake after a request, and whether a tiny request wakes it for the next real one.
// Usage (oMLX running): bun scripts/probes/wake.ts
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const words = "iron plate copper cable assembler inserter belt furnace chest radar silo train stop signal pump refinery".split(" ");
const text = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `${words[(i * 7 + seed) % words.length]} ${(i * 13 + seed) % 997}`).join(" ");
const sys = { role: "system" as const, content: `nonce ${crypto.randomUUID()}\n${text(850, 1)}` };
let seed = 100;
const real = async (label: string) => {
  const t0 = performance.now();
  const r = await model.stream([sys, { role: "user", content: `${text(200, seed++)}\nOK?` }], { maxTokens: 1 });
  console.log(`${label}: first token ${(r.usage?.time_to_first_token ?? 0).toFixed(2)} s, wall ${((performance.now() - t0) / 1000).toFixed(2)} s`);
};
const ping = () => model.stream([{ role: "user", content: "hi" }], { maxTokens: 1 });
await real("warm-up");
for (const gap of [1, 2, 3, 4]) { await Bun.sleep(gap * 1000); await real(`after ${gap}s idle`); }
for (const lead of [0.5, 1.5, 3]) {
  await Bun.sleep(15_000);
  const t0 = performance.now();
  await ping();
  const pingS = (performance.now() - t0) / 1000;
  await Bun.sleep(lead * 1000);
  await real(`15s idle, ping (${pingS.toFixed(2)} s), then ${lead}s`);
}
