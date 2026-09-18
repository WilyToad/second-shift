// FC-192: what a concurrent request does to the cached prefix, the decode rate and the memory guard.
//
// The interesting question isn't throughput. Lightning MTP speeds decode, and our time goes on the first token
// (PLAN §5) with 85–110 token answers — but everything rests on the 2,048-token block cache, ~2 s warm against
// ~42 s cold. If a background request evicts the player's blocks, a background pass trades 2 s for 42 s.
//
// Talks to oMLX directly, because our own server serialises turns (`busy = busy.then(...)`), so concurrency can
// only ever come from a second client. Reads nothing and changes nothing: no settings are touched.
// Usage (oMLX running): bun scripts/probe-concurrency.ts
import { OmlxClient, readOmlxApiKey } from "../server/src/model";
import { PrototypesSchema } from "../interfaces/src/index";
import { craftersByCategory } from "../server/src/grounding";
import { TOOLS } from "../server/src/agent";
import { alignToCacheBlock, buildMessages, systemPrompt } from "../server/src/prompt";

const OMLX = "http://127.0.0.1:8888";
const MODEL = process.env.COMPANION_MODEL ?? "Qwen3.8-Flash-Next-oQ4e-mtp";
const key = await readOmlxApiKey();
const protos = PrototypesSchema.parse(await Bun.file("data/captures/prototypes.json").json());
/**
 * The real thing, aligned exactly as the server aligns it at startup — otherwise nothing is measured: an
 * unpadded prompt is 1,746 tokens, never crosses a 2,048-token block, and reports `cached 0` forever.
 */
const base = systemPrompt(protos, ["base", "space-age", "maraxsis", "Cerys", "factorissimo-2"]);
const client = new OmlxClient({ baseUrl: OMLX, apiKey: key, model: MODEL });
const categories = [...craftersByCategory(protos)].sort(([a], [b]) => a.localeCompare(b)).map(([c, crafters]) => `crafting category ${c}: ${crafters.join(", ")}`);
const techTree = Object.entries(protos.technologies).sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => `technology ${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"}`);
// With the tools, as in play: they are ~2,000 tokens of the real prefix, and leaving them out aligned to one
// cached block instead of two, which is a different cache question from the one we're asking.
const measure = async (text: string) => (await client.stream(buildMessages(text, [], { role: "user", content: "." }), { tools: TOOLS, maxTokens: 1 })).usage?.prompt_tokens ?? 0;
const alignedPrompt = await alignToCacheBlock(base, [...categories, ...techTree], measure, "[save data: reference (crafting categories and the technology tree)]");
const SYSTEM = alignedPrompt.system;
/** A prefix that shares nothing with it, to see whether an unrelated job is what costs us the cache. */
const STRANGER = "You are a helpful assistant that summarises text.\n\n" + "Reference: ".padEnd(9000, "x y z ");

type Run = { label: string; ttftMs: number; decodeTokS: number; prompt: number; cached: number; out: number; prose: boolean };

async function ask(system: string, question: string, label: string, maxTokens = 110): Promise<Run> {
  const started = performance.now();
  let ttftMs = 0;
  let prose = false;
  let out = 0;
  let prompt = 0;
  let cached = 0;
  const res = await fetch(`${OMLX}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: question }],
      // The tools stay in the prefix because they are ~2,000 tokens of what gets cached. `tool_choice: "none"`
      // would drop them from the prompt entirely (measured: 4,137 tokens down to 2,283), so the question asks for
      // prose instead — otherwise the model answers with a tool call that arrives in one chunk and "decode" reads
      // 27,000 tok/s.
      ...(system === SYSTEM ? { tools: TOOLS } : {}),
      chat_template_kwargs: { enable_thinking: false }, temperature: 0.7, top_p: 0.8, top_k: 20,
    }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      let chunk: { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens?: number }; choices?: { delta?: { content?: string; tool_calls?: unknown[] } }[] };
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.usage) {
        prompt = chunk.usage.prompt_tokens ?? prompt;
        cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? cached;
        out = chunk.usage.completion_tokens ?? out;
      }
      // Any delta counts as the first token: with tools in the prefix the model sometimes answers with a tool
      // call, which carries no content, and waiting for content left the clock at zero and polluted the decode rate.
      const delta = chunk.choices?.[0]?.delta as { content?: string; tool_calls?: unknown[] } | undefined;
      if ((delta?.content || delta?.tool_calls?.length) && !ttftMs) ttftMs = performance.now() - started;
      if (delta?.content) prose = true; // a tool call streams no content and lands in one chunk: not a decode sample
    }
    buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
  }
  const total = performance.now() - started;
  return { label, ttftMs, decodeTokS: out / Math.max((total - ttftMs) / 1000, 0.001), prompt, cached, out, prose };
}

/**
 * oMLX's memory. `ps` RSS reports ~5 GiB for a model that holds ~69 GB of weights, because MLX keeps them in
 * unified-memory buffers that don't count as resident, so this asks macOS for the process's real footprint.
 */
const memory = () => {
  const pid = Bun.spawnSync(["pgrep", "-x", "omlx-server"]).stdout.toString().trim().split("\n")[0];
  if (!pid) return "unknown";
  const out = Bun.spawnSync(["footprint", "-p", pid]).stdout.toString();
  const phys = /phys_footprint:\s+([\d.]+)\s*([KMG])/i.exec(out);
  const rss = Number(Bun.spawnSync(["ps", "-o", "rss=", "-p", pid]).stdout.toString().trim()) / 1024 / 1024;
  return phys ? `${phys[1]}${phys[2]}iB footprint (rss ${rss.toFixed(1)} GiB)` : `rss ${rss.toFixed(1)} GiB`;
};

/** Only a streamed prose answer of reasonable length is a decode sample; a tool call arrives whole. */
const MIN_TOKENS = 20;
const sample = (r: Run) => r.prose && r.out >= MIN_TOKENS;
const show = (r: Run) => `${r.label.padEnd(34)} ttft ${(r.ttftMs / 1000).toFixed(2)}s · ${sample(r) ? `${r.decodeTokS.toFixed(1)} tok/s` : r.prose ? "too few tokens" : "answered with a tool call"} · prompt ${r.prompt} cached ${r.cached} · ${r.out} out`;
const rate = (rs: Run[]) => { const ok = rs.filter(sample); return ok.length ? ok.reduce((n, r) => n + r.decodeTokS, 0) / ok.length : NaN; };

const PROSE = " Answer in about 60 words of prose, from the save data above. Don't call a tool.";
const QUESTION = "How many copper cables does a green circuit take, and what makes them?" + PROSE;
const OTHER = "What does a stone furnace smelt, and how fast?" + PROSE;

console.log(`oMLX ${OMLX} · model ${MODEL}\nsystem prompt ${alignedPrompt.tokens} tokens (boundary ${alignedPrompt.target}) · memory ${memory()}\n`);

// 1. Warm the prefix, then measure a lone request: this is what the player gets today.
await ask(SYSTEM, QUESTION, "warm-up");
const alone = await ask(SYSTEM, QUESTION, "1. alone (baseline)");
console.log(show(alone));

// 2. Two requests that share our system prompt — a background pass would look like this.
const [fgShared, bgShared] = await Promise.all([ask(SYSTEM, QUESTION, "2. foreground, shared prefix"), ask(SYSTEM, OTHER, "2. background, shared prefix")]);
console.log(show(fgShared));
console.log(show(bgShared));
console.log(`   memory during: ${memory()}`);

// 3. The player's next question, alone again: did the concurrency cost them their cached blocks?
const after = await ask(SYSTEM, QUESTION, "3. alone again, after sharing");
console.log(show(after));

// 4. A background job with an unrelated prefix, which is the case that could evict us.
const [fgStranger, bgStranger] = await Promise.all([ask(SYSTEM, QUESTION, "4. foreground, stranger alongside"), ask(STRANGER, "Summarise the reference in one line.", "4. stranger", 60)]);
console.log(show(fgStranger));
console.log(show(bgStranger));
const afterStranger = await ask(SYSTEM, QUESTION, "5. alone again, after the stranger");
console.log(show(afterStranger));

// 6. Three at once: the configured ceiling.
const three = await Promise.all([ask(SYSTEM, QUESTION, "6. three at once (a)"), ask(SYSTEM, OTHER, "6. three at once (b)"), ask(SYSTEM, "What is a transport belt's throughput?" + PROSE, "6. three at once (c)")]);
for (const r of three) console.log(show(r));
console.log(`   memory during three: ${memory()}`);
const afterThree = await ask(SYSTEM, QUESTION, "7. alone again, after three");
console.log(show(afterThree));

console.log(`\ncached on a lone request: ${alone.cached} → after sharing ${after.cached} → after a stranger ${afterStranger.cached} → after three ${afterThree.cached}`);
const lone = [alone, after, afterStranger, afterThree].filter(sample);
const pair = [fgShared, bgShared, fgStranger].filter(sample);
const trio = three.filter(sample);
console.log(`decode: alone ${rate(lone).toFixed(1)} tok/s (${lone.length} samples) · two at once ${rate(pair).toFixed(1)} each (${pair.length}) · three at once ${rate(trio).toFixed(1)} each (${trio.length}), ${(rate(trio) * 3).toFixed(1)} total if all three ran full`);
console.log(`first token: alone ${[alone, after, afterStranger, afterThree].map((r) => (r.ttftMs / 1000).toFixed(2)).join(", ")} s · with one alongside ${(fgShared.ttftMs / 1000).toFixed(2)} s · with a stranger ${(fgStranger.ttftMs / 1000).toFixed(2)} s · in a three ${(three[0]!.ttftMs / 1000).toFixed(2)} s`);
console.log(`memory now ${memory()}`);
