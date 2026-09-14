// Streaming client for the local oMLX server (OpenAI-compatible chat completions).
import { homedir } from "node:os";
import { join } from "node:path";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: object } };
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  time_to_first_token?: number;
  model_load_duration?: number;
  generation_tokens_per_second?: number;
};
export type StreamResult = { text: string; toolCalls: ToolCall[]; usage?: Usage; ttftMs?: number; totalMs: number };
export type StreamOptions = { thinking?: boolean; maxTokens?: number; signal?: AbortSignal; onToken?: (t: string) => void; tools?: ToolSpec[] };

/** What the agent needs from a model; lets tests use a fake. */
export interface ChatModel {
  stream(messages: ChatMessage[], opts?: StreamOptions): Promise<StreamResult>;
}

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

export class OmlxClient implements ChatModel {
  constructor(private readonly opts: { baseUrl: string; apiKey: string; model: string }) {}

  async stream(
    messages: ChatMessage[],
    { thinking = false, maxTokens = 1024, signal, onToken, tools }: StreamOptions = {},
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
        ...(tools?.length ? { tools } : {}),
        chat_template_kwargs: { enable_thinking: thinking },
        // Qwen's recommended sampling; oMLX's default temperature (1.0) is too loose for factual answers.
        ...(thinking ? { temperature: 0.6, top_p: 0.95, top_k: 20 } : { temperature: 0.7, top_p: 0.8, top_k: 20 }),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`oMLX ${res.status}: ${await res.text()}`);

    let text = "";
    let usage: Usage | undefined;
    let ttftMs: number | undefined;
    const calls: ToolCall[] = [];
    for await (const data of sseData(res.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model === "keepalive") continue;
      // Tool calls may arrive whole or in pieces; accumulate by index.
      for (const part of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
        const call = (calls[part.index ?? 0] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        ttftMs ??= performance.now() - started;
      }
      const token: string | undefined = chunk.choices?.[0]?.delta?.content;
      if (token) {
        ttftMs ??= performance.now() - started;
        text += token;
        onToken?.(token);
      }
    }
    return { text, toolCalls: calls.filter(Boolean), usage, ttftMs, totalMs: performance.now() - started };
  }
}
