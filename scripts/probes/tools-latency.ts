import { PrototypesSchema } from "../../interfaces/src/index";
import { TOOLS } from "../../server/src/agent";
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
import { buildMessages, systemPrompt, userTurn } from "../../server/src/prompt";
import { RecipeRetriever } from "../../server/src/retrieval";
const p = PrototypesSchema.parse((await Bun.file(new URL("../../data/cache/prototypes.json", import.meta.url)).json()).data);
const m = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const r = new RecipeRetriever(p); const sys = systemPrompt(p);
for (const [label, tools] of [["with tools", TOOLS], ["without tools", undefined]] as const) {
  for (const q of ["What's the recipe for carbon fiber?", "What goes into a Cerys charging rod?", "What's the recipe for carbon fiber?"]) {
    const t0 = performance.now(); let firstChunk = 0;
    const res = await m.stream(buildMessages(sys, [], userTurn(`${q}\n\n(Answer from the data provided; no tool call is needed for this question.)`, { recipes: r.retrieve(q).lines })), { tools, maxTokens: 60, onToken: () => { firstChunk ||= performance.now() - t0; } });
    console.log(`${label.padEnd(13)} server ttft ${res.usage?.time_to_first_token?.toFixed(2)} s, first visible ${(firstChunk / 1000).toFixed(2)} s, prompt ${res.usage?.prompt_tokens} cached ${res.usage?.prompt_tokens_details?.cached_tokens}, ttfvt ${(res.usage as any)?.time_to_first_visible_token?.toFixed?.(2)}  ${q}`);
  }
}
