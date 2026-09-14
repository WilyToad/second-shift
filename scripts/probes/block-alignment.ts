// S05: does padding the stable prefix past a 2,048-token cache block speed up novel questions?
import { PrototypesSchema } from "../../interfaces/src/index";
import { TOOLS } from "../../server/src/agent";
import { craftersByCategory } from "../../server/src/grounding";
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
import { buildMessages, systemPrompt, userTurn } from "../../server/src/prompt";
import { RecipeRetriever } from "../../server/src/retrieval";

const p = PrototypesSchema.parse((await Bun.file(new URL("../../data/cache/prototypes.json", import.meta.url)).json()).data);
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const retriever = new RecipeRetriever(p);
const base = systemPrompt(p);
const categories = [...craftersByCategory(p)].sort(([a], [b]) => a.localeCompare(b)).map(([c, m]) => `${c}: ${m.join(", ")}`);

const stableTokens = async (system: string) => (await model.stream(buildMessages(system, [], { role: "user", content: "." }), { tools: TOOLS, maxTokens: 1 })).usage!.prompt_tokens;
const questions = ["What makes plastic bars?", "What goes into a rocket silo?", "How is sulfuric acid made?", "What does a foundry need?", "What makes holmium plates?", "How do I make low density structures?"];

async function trial(label: string, system: string) {
  console.log(`${label}: stable prefix ≈ ${await stableTokens(system)} tokens`);
  const times: number[] = [];
  for (const q of questions) {
    const novel = `${q} (${crypto.randomUUID().slice(0, 8)})`; // never seen before
    const r = await model.stream(buildMessages(system, [], userTurn(novel, { recipes: retriever.retrieve(q).lines })), { tools: TOOLS, maxTokens: 1 });
    times.push(r.usage!.time_to_first_token!);
    console.log(`  prompt ${r.usage!.prompt_tokens}, cached ${r.usage!.prompt_tokens_details?.cached_tokens}, server ttft ${r.usage!.time_to_first_token!.toFixed(2)} s`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`  median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(2)} s\n`);
}

await trial("current system prompt", base);
// Add category reference lines until the stable prefix crosses the next 2,048 boundary.
let padded = base;
const target = Math.ceil((await stableTokens(base)) / 2048) * 2048;
for (const line of categories) {
  if ((await stableTokens(padded)) >= target + 8) break;
  padded += (padded.includes("[save data: recipe categories") ? "\n" : "\n\n[save data: recipe categories and what crafts them]\n") + line;
}
await trial(`padded to cross ${target}`, padded);
