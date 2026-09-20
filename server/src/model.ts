// Streaming client for the local oMLX server (OpenAI-compatible chat completions).
import { homedir } from "node:os";
import { join } from "node:path";
import { toolCallsFromText } from "./tool-text";

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
  /**
   * `thinkingSwitch`: how the engine is told to skip reasoning on quick lookups. oMLX reads Qwen's
   * `chat_template_kwargs.enable_thinking`; Splash ignores that and reads `reasoning_effort: "none"` (FC-237, measured:
   * every other spelling left it reasoning through the whole token budget).
   */
  constructor(private readonly opts: { baseUrl: string; apiKey: string; model: string; thinkingSwitch?: "chat_template_kwargs" | "reasoning_effort" }) {}

  async stream(
    messages: ChatMessage[],
    { thinking = false, maxTokens = 1024, signal, onToken, tools }: StreamOptions = {},
  ): Promise<StreamResult> {
    const started = performance.now();
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal,
      headers: { ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: maxTokens,
        ...(tools?.length ? { tools } : {}),
        ...(this.opts.thinkingSwitch === "reasoning_effort" ? (thinking ? {} : { reasoning_effort: "none" }) : { chat_template_kwargs: { enable_thinking: thinking } }),
        // Qwen's recommended sampling; oMLX's default temperature (1.0) is too loose for factual answers.
        ...(thinking ? { temperature: 0.6, top_p: 0.95, top_k: 20 } : { temperature: 0.7, top_p: 0.8, top_k: 20 }),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`model server ${res.status}: ${await res.text()}`);

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
    // A call the model wrote as text instead of sending as one (FC-184): recover it, and never leave the markup
    // in the answer. Only when nothing was parsed for us, so a well-behaved round is untouched.
    const parsed = calls.filter(Boolean);
    const fromText = parsed.length ? { calls: [], text } : toolCallsFromText(text);
    return { text: fromText.text, toolCalls: [...parsed, ...fromText.calls], usage, ttftMs, totalMs: performance.now() - started };
  }
}
