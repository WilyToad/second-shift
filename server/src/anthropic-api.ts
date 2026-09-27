// The Anthropic API as the companion's model (FC-258), behind the same one-method `ChatModel` as oMLX. Uses the
// official SDK, per the Claude API reference; the shapes below come from it, not from memory.
//
// What differs from the OpenAI-shaped client, and why:
// - Sampling parameters (temperature, top_p, top_k) are gone: Claude Opus 5 rejects them with a 400.
// - Thinking isn't switched off for quick lookups. On Opus 5, disabled thinking can make the model write a tool call
//   into its visible text instead of making it, so a quick lookup asks for `low` effort, and a planning question for
//   `high`.
// - Refusal fallbacks are on (`fallbacks: "default"`), as the reference recommends for Opus 5: a declined request is
//   re-run on a fallback model inside the same call. A refusal that survives that is an error, never a half-answer.
// - Tool inputs are *not* streamed as they're generated (`eager_input_streaming`): that hands validation to us, and
//   only pays off for large inputs. Ours are a few words, so the API keeps validating them.
// - The system prompt carries a cache breakpoint: it is the stable prefix, exactly as it is for oMLX.
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatModel, StreamOptions, StreamResult, ToolCall, ToolSpec } from "./model";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;

/** Our OpenAI-shaped tools as the Messages API's. */
export function toAnthropicTools(tools: ToolSpec[]): BetaTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as BetaTool["input_schema"],
  }));
}

/**
 * Our messages as the Messages API's: the system prompt separate; an assistant's tool calls as `tool_use` blocks; and
 * every tool result that follows one assistant turn in a *single* user message — splitting them across messages
 * teaches the model to stop calling tools in parallel (the reference's parallel-tool rule).
 */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Beta[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: Beta[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const blocks: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
      if (m.content?.trim()) blocks.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(c.function.arguments || "{}"); } catch { /* an unparseable call is sent back empty */ }
        blocks.push({ type: "tool_use", id: c.id, name: c.function.name, input });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
    } else if (m.role === "tool") {
      const result: Anthropic.Beta.Messages.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content };
      const last = out.at(-1);
      // Consecutive results belong to the same assistant turn: one user message holding all of them.
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) last.content.push(result);
      else out.push({ role: "user", content: [result] });
    }
  }
  return { system, messages: out };
}

export class AnthropicClient implements ChatModel {
  private readonly client: Anthropic;

  constructor(private readonly opts: { model: string; client?: Anthropic }) {
    // The zero-argument client reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
    this.client = opts.client ?? new Anthropic();
  }

  async stream(messages: ChatMessage[], { thinking = false, maxTokens = 1024, signal, onToken, tools }: StreamOptions = {}): Promise<StreamResult> {
    const started = performance.now();
    const { system, messages: body } = toAnthropicMessages(messages);
    let ttftMs: number | undefined;
    const stream = this.client.beta.messages.stream(
      {
        model: this.opts.model,
        // A warm-up asks for one token; with thinking on the model needs a little room to finish at all.
        max_tokens: Math.max(maxTokens, 64),
        ...(system ? { system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }] } : {}),
        messages: body,
        ...(tools?.length ? { tools: toAnthropicTools(tools) } : {}),
        output_config: { effort: thinking ? "high" : "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      signal ? { signal } : undefined,
    );
    stream.on("text", (delta) => {
      ttftMs ??= performance.now() - started;
      onToken?.(delta);
    });
    const message = await stream.finalMessage();
    // A refusal can cut a tool call off mid-input: never hand the agent that turn's tools, or a partial answer.
    if (message.stop_reason === "refusal") throw new Error(`the model declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}`);
    const text = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const toolCalls: ToolCall[] = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
    // A tool input cut off at max_tokens parses as a valid-looking partial object: don't run it.
    if (message.stop_reason === "max_tokens" && toolCalls.length) throw new Error("a tool call was cut off at max_tokens");
    const u = message.usage;
    const cached = u.cache_read_input_tokens ?? 0;
    return {
      text,
      toolCalls,
      usage: {
        prompt_tokens: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
        completion_tokens: u.output_tokens,
        prompt_tokens_details: { cached_tokens: cached },
      },
      ...(ttftMs !== undefined ? { ttftMs } : {}),
      totalMs: performance.now() - started,
    };
  }
}
