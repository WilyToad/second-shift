import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
const m = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const filler = Array.from({ length: 900 }, (_, i) => `Rule ${i}: keep belts moving and science flowing on every surface.`).join("\n"); // ~12k tokens
const sys = { role: "system" as const, content: "You are a test.\n" + filler };
const run = async (label: string, msgs: any[]) => {
  const r = await m.stream(msgs, { maxTokens: 1 });
  console.log(`${label}: prompt ${r.usage?.prompt_tokens}, cached ${r.usage?.prompt_tokens_details?.cached_tokens}, server ttft ${r.usage?.time_to_first_token}s, client total ${(r.totalMs/1000).toFixed(2)}s`);
};
await run("A  same prompt #1", [sys, { role: "user", content: "Q1" }]);
await run("A  same prompt #2", [sys, { role: "user", content: "Q1" }]);
await run("B  same prefix, new question", [sys, { role: "user", content: "Q2 different" }]);
await run("C  prefix + appended turn", [sys, { role: "user", content: "Q1" }, { role: "assistant", content: "ok" }, { role: "user", content: "Q3" }]);
