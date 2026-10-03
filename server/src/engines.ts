// Which model answers (FC-237, FC-258): oMLX on this Mac by default, or another engine the player chooses with
// `COMPANION_ENGINE`. Each is the same one-method `ChatModel`, so the agent loop, its guards, cards and corrections
// don't know or care which is behind it.
//
//   omlx        (default) oMLX on 127.0.0.1:8888 — local, nothing leaves the Mac
//   openai-compatible     any OpenAI-compatible server at COMPANION_MODEL_URL (Splash, FC-237)
//   claude-cli            the player's Claude subscription through `claude -p`, locked down (FC-258)
//   anthropic             the Anthropic API with ANTHROPIC_API_KEY
//   openai                the OpenAI API with OPENAI_API_KEY
//
// Everything but omlx sends the whole turn off the Mac: the system prompt with the save's mods, the retrieved lines,
// the live snapshot, the history and the question.
import { AnthropicClient } from "./anthropic-api";
import { ClaudeCliClient, DEFAULT_CLAUDE_MODEL } from "./claude-cli";
import { type ChatModel, OmlxClient, readOmlxApiKey } from "./model";

export type EngineName = "omlx" | "openai-compatible" | "claude-cli" | "anthropic" | "openai";
export const ENGINES: EngineName[] = ["omlx", "openai-compatible", "claude-cli", "anthropic", "openai"];

export type Engine = {
  name: EngineName;
  model: ChatModel;
  /** For the startup log: which engine, which model, and whether anything leaves the Mac. */
  describe: string;
  /** The model runs on this Mac. Only then is there a resident model to keep awake or a block cache to align to. */
  local: boolean;
  /** The engine's prefix-cache block, which the stable prompt is padded past (local engines only). */
  cacheBlock?: number;
};

/**
 * oMLX 0.7.0 runs Flash-Next with 8,192-token cache blocks — it widens the prefill step for Qwen's hybrid models on
 * 64 GB+ machines and enlarges the block to match, with no setting to turn it off — and its hybrid layers resume only
 * from a saved block boundary. Padded to the old 2,048, the stable prompt (~4,100 tokens) ended before the first
 * boundary and no new question was ever cached: first token 2.04 s against 0.56 s padded past 8,192 (FC-262). 8,192
 * is a multiple of 2,048, so it stays aligned if the block shrinks again. `COMPANION_CACHE_BLOCK` overrides.
 */
export const OMLX_CACHE_BLOCK = 8192;
/** The block oMLX used before 0.7.0, and the guess for another local engine. */
const OTHER_CACHE_BLOCK = 2048;

const OMLX_URL = "http://127.0.0.1:8888";
export const DEFAULT_OMLX_MODEL = "Qwen3.8-Flash-Next-oQ4e-mtp";
/**
 * Sonnet, as for `claude -p`: speed first (CLAUDE.md), and through the CLI it reached first words in about half
 * Opus's time (FC-258). `COMPANION_MODEL=claude-opus-5` for the stronger model.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** The engine asked for; an unknown name is an error, not a silent fall back to something that sends data out. */
export function engineName(env: Record<string, string | undefined> = process.env): EngineName {
  const asked = env.COMPANION_ENGINE?.trim().toLowerCase();
  if (asked) {
    if (!(ENGINES as string[]).includes(asked)) throw new Error(`COMPANION_ENGINE=${asked} isn't one of ${ENGINES.join(", ")}`);
    return asked as EngineName;
  }
  // Before FC-258 a URL alone chose an OpenAI-compatible engine (FC-237); that still works.
  const url = env.COMPANION_MODEL_URL?.replace(/\/$/, "");
  return url && url !== OMLX_URL ? "openai-compatible" : "omlx";
}

export async function makeEngine(env: Record<string, string | undefined> = process.env): Promise<Engine> {
  const name = engineName(env);
  const leaves = "— the whole turn leaves this Mac";
  switch (name) {
    case "omlx": {
      const model = env.COMPANION_MODEL ?? DEFAULT_OMLX_MODEL;
      return { name, local: true, cacheBlock: Number(env.COMPANION_CACHE_BLOCK) || OMLX_CACHE_BLOCK, describe: `oMLX on this Mac (${model})`, model: new OmlxClient({ baseUrl: OMLX_URL, apiKey: await readOmlxApiKey(), model, thinkingSwitch: "chat_template_kwargs" }) };
    }
    case "openai-compatible": {
      const url = env.COMPANION_MODEL_URL?.replace(/\/$/, "");
      if (!url) throw new Error("COMPANION_ENGINE=openai-compatible needs COMPANION_MODEL_URL");
      const model = env.COMPANION_MODEL;
      if (!model) throw new Error("COMPANION_ENGINE=openai-compatible needs COMPANION_MODEL");
      const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
      return { name, local, cacheBlock: Number(env.COMPANION_CACHE_BLOCK) || OTHER_CACHE_BLOCK, describe: `${url} (${model})${local ? "" : ` ${leaves}`}`, model: new OmlxClient({ baseUrl: url, apiKey: env.COMPANION_MODEL_KEY ?? "", model, thinkingSwitch: "reasoning_effort" }) };
    }
    case "claude-cli": {
      const model = env.COMPANION_MODEL || DEFAULT_CLAUDE_MODEL;
      return { name, local: false, describe: `your Claude subscription via claude -p (${model}) ${leaves}`, model: new ClaudeCliClient({ model }) };
    }
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) throw new Error("COMPANION_ENGINE=anthropic needs ANTHROPIC_API_KEY in .env");
      const model = env.COMPANION_MODEL || DEFAULT_ANTHROPIC_MODEL;
      return { name, local: false, describe: `the Anthropic API (${model}) ${leaves}`, model: new AnthropicClient({ model }) };
    }
    case "openai": {
      if (!env.OPENAI_API_KEY) throw new Error("COMPANION_ENGINE=openai needs OPENAI_API_KEY in .env");
      // No default model: OpenAI's names change, and guessing one is how a server starts on a model that isn't there.
      const model = env.COMPANION_MODEL;
      if (!model) throw new Error("COMPANION_ENGINE=openai needs COMPANION_MODEL (an OpenAI model name)");
      return { name, local: false, describe: `the OpenAI API (${model}) ${leaves}`, model: new OmlxClient({ baseUrl: "https://api.openai.com", apiKey: env.OPENAI_API_KEY, model, thinkingSwitch: "openai" }) };
    }
  }
}
