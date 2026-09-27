// The companion on the player's Claude subscription (FC-258): `claude -p`, the Claude Code CLI in print mode, as the
// model behind the same one-method `ChatModel` the oMLX client implements.
//
// `claude -p` is an agent, not a model — it ships its own shell and file tools. Here it is used as a model only,
// and locked down so it can't act (measured, `work/spikes/FC-258-subscription-engines.md`): asked to run `ls` and
// read a planted file, it could only write the command out as text.
//   --tools ""                  none of its own tools
//   --strict-mcp-config         no MCP servers
//   --setting-sources project   run from an empty folder: none of the player's settings, plugins or auto-memory,
//                               and no project CLAUDE.md (running from this repo would load ours)
//   --no-session-persistence    nothing saved
//   --system-prompt             ours replaces Claude Code's own ~9k-token prompt
// `--bare` would be tidier but also skips the login, so it can't authenticate.
//
// Tool calls travel as text — `<tool_call>{"name": …, "arguments": {…}}</tool_call>` — the form the server already
// recovers (FC-184), and every model tested used it unprompted beyond the instructions below. Our loop stays the one
// that runs tools, with every guard, card and correction it already has. Each round is a fresh process with the whole
// transcript, stateless like an API call; Anthropic caches the stable system prompt server-side.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, ChatModel, StreamOptions, StreamResult, ToolCall, ToolSpec, Usage } from "./model";
import { toolCallsFromText } from "./tool-text";

/** Measured fastest of the three: 1.1–2.3 s to first words (FC-258). */
export const DEFAULT_CLAUDE_MODEL = "sonnet";

type Spawn = (cmd: string[], opts: { cwd: string; env: Record<string, string | undefined>; input?: string }) => {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
};

/** A fresh empty folder to run in, so no project settings or CLAUDE.md are found. One per server run. */
function emptyFolder(): string {
  return mkdtempSync(join(tmpdir(), "second-shift-claude-"));
}

/**
 * The environment for the CLI, without API credentials: with `ANTHROPIC_API_KEY` set — say for the API engine —
 * `claude -p` would use it and bill the API instead of the player's subscription, silently.
 */
export function subscriptionEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _k, ANTHROPIC_AUTH_TOKEN: _t, ANTHROPIC_BASE_URL: _u, ...rest } = env;
  return rest;
}

/** How to call a tool, and which ones there are, in words a model reads once in the system prompt. */
export function toolInstructions(tools: ToolSpec[]): string {
  if (!tools.length) return "";
  const list = tools
    .map((t) => `- ${t.function.name}: ${t.function.description}\n  arguments (JSON Schema): ${JSON.stringify(t.function.parameters)}`)
    .join("\n");
  return `

# Tools
To use a tool, write the call exactly like this, and nothing after it:
<tool_call>{"name": "<tool name>", "arguments": {<arguments as JSON>}}</tool_call>
You may call more than one, each in its own block. Each result comes back in the next message, labelled with the
tool's name; then answer the player from it. Never describe a call instead of making it, and never say a tool ran
when you haven't called it.

${list}`;
}

/**
 * The conversation as one message: history, tool calls and their results, labelled by who said what. The system
 * prompt goes separately (`--system-prompt`), so the stable part stays a cacheable prefix.
 */
export function transcript(messages: ChatMessage[]): string {
  const names = new Map<string, string>();
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") lines.push(`Player:\n${m.content}`);
    else if (m.role === "assistant") {
      const calls = (m.tool_calls ?? []).map((c) => {
        names.set(c.id, c.function.name);
        return `<tool_call>{"name": ${JSON.stringify(c.function.name)}, "arguments": ${c.function.arguments || "{}"}}</tool_call>`;
      });
      lines.push(`You:\n${[m.content, ...calls].filter((s) => s?.trim()).join("\n")}`);
    } else if (m.role === "tool") lines.push(`Result of ${names.get(m.tool_call_id) ?? "the tool"}:\n${m.content}`);
  }
  return `${lines.join("\n\n")}\n\nReply to the player's last message now, as yourself.`;
}

export class ClaudeCliClient implements ChatModel {
  private cwd: string | null = null;

  constructor(
    private readonly opts: { model?: string; binary?: string; spawn?: Spawn; cwd?: string; env?: Record<string, string | undefined> } = {},
  ) {}

  get model(): string {
    return this.opts.model || DEFAULT_CLAUDE_MODEL;
  }

  // `thinking` and `maxTokens` are accepted and ignored: `claude -p` has no flag for either, so a capped call (the
  // watcher's 60 tokens, a 1-token warm-up) runs to the model's own end.
  async stream(messages: ChatMessage[], { signal, onToken, tools }: StreamOptions = {}): Promise<StreamResult> {
    const started = performance.now();
    this.cwd ??= this.opts.cwd ?? emptyFolder();
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") + toolInstructions(tools ?? []);
    const args = [
      this.opts.binary ?? "claude", "-p",
      "--tools", "", "--strict-mcp-config", "--setting-sources", "project",
      "--no-session-persistence", "--disable-slash-commands",
      "--output-format", "stream-json", "--include-partial-messages", "--verbose",
      "--model", this.model,
      "--system-prompt", system,
    ];
    // The conversation goes in on stdin: it grows with every turn, and a command-line argument is capped (1 MB on
    // macOS). The system prompt is bounded, so it stays an argument.
    const spawn: Spawn = this.opts.spawn ?? ((cmd, o) => Bun.spawn(cmd, { ...o, stdin: new TextEncoder().encode(o.input ?? ""), stdout: "pipe", stderr: "pipe" }));
    const proc = spawn(args, { cwd: this.cwd, env: subscriptionEnv(this.opts.env), input: transcript(messages) });
    const abort = () => proc.kill();
    signal?.addEventListener("abort", abort, { once: true });

    let text = "";
    let ttftMs: number | undefined;
    let usage: Usage | undefined;
    let failure: string | null = null;
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of proc.stdout) {
        buf += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let e: { type?: string; event?: { delta?: { type?: string; text?: string } }; is_error?: boolean; result?: string; usage?: Record<string, number> };
          try { e = JSON.parse(line); } catch { continue; }
          const delta = e.event?.delta;
          if (e.type === "stream_event" && delta?.type === "text_delta" && delta.text) {
            ttftMs ??= performance.now() - started;
            text += delta.text;
            onToken?.(delta.text);
          } else if (e.type === "result") {
            if (e.is_error) failure = e.result ?? "claude -p failed";
            const u = e.usage ?? {};
            const cached = u.cache_read_input_tokens ?? 0;
            usage = {
              prompt_tokens: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
              completion_tokens: u.output_tokens ?? 0,
              prompt_tokens_details: { cached_tokens: cached },
            };
          }
        }
      }
      const code = await proc.exited;
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (failure) throw new Error(`claude -p: ${failure}`);
      if (code !== 0 && !text) throw new Error(`claude -p exited ${code}: ${(await new Response(proc.stderr).text()).slice(0, 300)}`);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    const recovered = toolCallsFromText(text, (n) => `call_cli_${Date.now().toString(36)}_${n}`);
    const toolCalls: ToolCall[] = recovered.calls;
    return { text: recovered.text, toolCalls, ...(usage ? { usage } : {}), ...(ttftMs !== undefined ? { ttftMs } : {}), totalMs: performance.now() - started };
  }
}
