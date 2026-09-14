// FC-011 spike: how big is the save's recipe data as prompt text, and how fast is it cold and warm?
import { PrototypesSchema } from "../../interfaces/src/index";
import { formatItemTraits, formatMachines, formatRecipes, formatTechnologies } from "../../server/src/grounding";
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";

const p = PrototypesSchema.parse(await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json());
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });

const sections = {
  "recipes (all)": formatRecipes(p),
  "recipes (unlocked only)": formatRecipes(p, (_, r) => r.enabled),
  technologies: formatTechnologies(p),
  machines: formatMachines(p),
  "item traits (spoil/fuel)": formatItemTraits(p),
};
await Bun.write(new URL("../../data/captures/grounding-sample.txt", import.meta.url), Object.entries(sections).map(([k, v]) => `## ${k}\n${v}`).join("\n\n"));

// Token counts: a unique nonce up front so nothing is served from cache.
const tokens = async (text: string) => (await model.stream([{ role: "system", content: `nonce ${crypto.randomUUID()}\n${text}` }, { role: "user", content: "ok" }], { maxTokens: 1 })).usage!.prompt_tokens;
const base = await tokens("");
for (const [name, text] of Object.entries(sections)) {
  console.log(`${name.padEnd(26)} ${String(text.split("\n").length).padStart(4)} lines ${String(text.length).padStart(7)} chars ${String((await tokens(text)) - base).padStart(6)} tokens`);
}

const full = [sections["recipes (all)"], sections.technologies, sections.machines, sections["item traits (spoil/fuel)"]].join("\n\n");
const sys = { role: "system" as const, content: `Save data (nonce ${crypto.randomUUID()}):\n${full}` };
const ask = async (label: string, q: string) => {
  const r = await model.stream([sys, { role: "user", content: q }], { maxTokens: 1 });
  console.log(`${label}: prompt ${r.usage?.prompt_tokens}, cached ${r.usage?.prompt_tokens_details?.cached_tokens}, first token ${(r.usage?.time_to_first_token ?? 0).toFixed(2)} s`);
};
await ask("full grounding, cold", "What makes bioflux?");
await ask("full grounding, warm", "What makes carbon fiber?");
