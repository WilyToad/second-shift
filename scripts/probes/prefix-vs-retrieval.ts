import { PrototypesSchema } from "../../interfaces/src/index";
import { formatItemTraits, formatMachines, formatRecipes, recipeLine } from "../../server/src/grounding";
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
const p = PrototypesSchema.parse(await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json());
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const measure = async (label: string, prefix: string, tails: string[]) => {
  const sys = { role: "system" as const, content: `nonce ${crypto.randomUUID()}\n${prefix}` };
  for (const [i, tail] of tails.entries()) {
    const r = await model.stream([sys, { role: "user", content: tail }], { maxTokens: 1 });
    console.log(`${label} #${i + 1}: prompt ${r.usage?.prompt_tokens}, cached ${r.usage?.prompt_tokens_details?.cached_tokens}, first token ${(r.usage?.time_to_first_token ?? 0).toFixed(2)} s`);
  }
};
const retrieved = (names: string[]) => names.map((n) => recipeLine(n, p.recipes[n]!)).join("\n");
const tailA = `What makes bioflux?\n\n[relevant recipes]\n${retrieved(["bioflux", "yumako-processing", "jellynut-processing", "agricultural-science-pack", "nutrients-from-bioflux", "bioplastic"])}\n\n[game state] ...1.5k tokens of snapshot...` + " iron-plate 798".repeat(300);
const tailB = `What makes carbon fiber?\n\n[relevant recipes]\n${retrieved(["carbon-fiber", "carbon", "bioflux"])}\n\n[game state] ...` + " copper-plate 191".repeat(300);
const small = [formatMachines(p), formatItemTraits(p)].join("\n\n");
await measure("small prefix (machines+traits) + retrieval tail", small, [tailA, tailB]);
await measure("unlocked recipes prefix (22k) + tail", [small, formatRecipes(p, (_, r) => r.enabled)].join("\n\n"), [tailA, tailB]);
