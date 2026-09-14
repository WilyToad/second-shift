// Streaming client for the local oMLX server (OpenAI-compatible chat completions).
import { homedir } from "node:os";
import { join } from "node:path";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  time_to_first_token?: number;
  model_load_duration?: number;
  generation_tokens_per_second?: number;
};
export type StreamResult = { text: string; usage?: Usage; ttftMs?: number; totalMs: number };

export async function readOmlxApiKey(): Promise<string> {
  const settings = await Bun.file(join(homedir(), ".omlx/settings.json")).json();
  const key = settings?.auth?.api_key;
  if (!key) throw new Error("No API key in ~/.omlx/settings.json (auth.api_key)");
  return key;
}

/** Parses an SSE byte stream into `data:` payloads. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

export class OmlxClient {
  constructor(private readonly opts: { baseUrl: string; apiKey: string; model: string }) {}

  async stream(
    messages: ChatMessage[],
    { thinking = false, maxTokens = 1024, signal, onToken }: { thinking?: boolean; maxTokens?: number; signal?: AbortSignal; onToken?: (t: string) => void } = {},
  ): Promise<StreamResult> {
    const started = performance.now();
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: thinking },
        // Qwen's recommended sampling; oMLX's default temperature (1.0) is too loose for factual answers.
        ...(thinking ? { temperature: 0.6, top_p: 0.95, top_k: 20 } : { temperature: 0.7, top_p: 0.8, top_k: 20 }),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`oMLX ${res.status}: ${await res.text()}`);

    let text = "";
    let usage: Usage | undefined;
    let ttftMs: number | undefined;
    for await (const data of sseData(res.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model === "keepalive") continue;
      const token: string | undefined = chunk.choices?.[0]?.delta?.content;
      if (token) {
        ttftMs ??= performance.now() - started;
        text += token;
        onToken?.(token);
      }
    }
    return { text, usage, ttftMs, totalMs: performance.now() - started };
  }
}
