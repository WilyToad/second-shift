// FC-262: oMLX 0.7.0 runs Flash-Next with 8,192-token cache blocks (it logs "Enlarging paged cache block_size=256 to
// 8192 for ArraysCache hybrid model"), where the server pads the stable prefix to 2,048. Novel questions against both
// alignments, built exactly as main.ts builds the prompt: is padding past 8,192 worth its longer prefix?
import { PrototypesSchema } from "../../interfaces/src/index";
import { TOOLS } from "../../server/src/agent";
import { craftersByCategory } from "../../server/src/grounding";
import { OmlxClient, readOmlxApiKey } from "../../server/src/model";
import { alignToCacheBlock, buildMessages, systemPrompt, userTurn } from "../../server/src/prompt";
import { RecipeRetriever } from "../../server/src/retrieval";

const p = PrototypesSchema.parse((await Bun.file(new URL("../../data/cache/prototypes.json", import.meta.url)).json()).data);
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: "Qwen3.8-Flash-Next-oQ4e-mtp" });
const retriever = new RecipeRetriever(p);
const base = systemPrompt(p, []);
const categories = [...craftersByCategory(p)].sort(([a], [b]) => a.localeCompare(b)).map(([c, crafters]) => `crafting category ${c}: ${crafters.join(", ")}`);
const techTree = Object.entries(p.technologies).sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => `technology ${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"}`);
const measure = async (s: string) => (await model.stream(buildMessages(s, [], { role: "user", content: "." }), { tools: TOOLS, maxTokens: 1 })).usage?.prompt_tokens ?? 0;
const questions = ["What makes plastic bars?", "What goes into a rocket silo?", "How is sulfuric acid made?", "What does a foundry need?", "What makes holmium plates?", "How do I make low density structures?"];
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

async function trial(block: number) {
  const aligned = await alignToCacheBlock(base, [...categories, ...techTree], measure, "[save data: reference (crafting categories and the technology tree)]", block);
  // Warm the way the server does, then novel questions, each a turn the cache has never seen.
  await model.stream(buildMessages(aligned.system, [], userTurn("Reply with OK.")), { tools: TOOLS, maxTokens: 1 });
  const ttft: number[] = [];
  const cached: number[] = [];
  for (const q of questions) {
    const novel = `${q} (${crypto.randomUUID().slice(0, 8)})`;
    const r = await model.stream(buildMessages(aligned.system, [], userTurn(novel, { recipes: retriever.retrieve(q).lines })), { tools: TOOLS, maxTokens: 1 });
    ttft.push(r.usage!.time_to_first_token!);
    cached.push(r.usage!.prompt_tokens_details?.cached_tokens ?? 0);
  }
  console.log(`block ${block}: stable prefix ${aligned.tokens} tokens (boundary ${aligned.target}) | novel questions: cached ${cached.join(", ")} | server first token median ${median(ttft).toFixed(2)} s, max ${Math.max(...ttft).toFixed(2)} s`);
}

await trial(2048);
await trial(8192);
