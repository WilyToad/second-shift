import { expect, test } from "bun:test";
import { AnthropicClient, toAnthropicMessages, toAnthropicTools } from "./anthropic-api";
import { ClaudeCliClient, subscriptionEnv, toolInstructions, transcript } from "./claude-cli";
import { engineName, makeEngine } from "./engines";
import { type ChatMessage, OmlxClient, type ToolSpec } from "./model";

const TOOL: ToolSpec = { type: "function", function: { name: "find_entities", description: "Find things near the player.", parameters: { type: "object", properties: { what: { type: "string" } }, required: ["what"] } } };

const CONVERSATION: ChatMessage[] = [
  { role: "system", content: "You are Ballast." },
  { role: "user", content: "Find the rails near me." },
  { role: "assistant", content: "", tool_calls: [
    { id: "c1", type: "function", function: { name: "find_entities", arguments: '{"what":"rail"}' } },
    { id: "c2", type: "function", function: { name: "find_entities", arguments: '{"what":"train-stop"}' } },
  ] },
  { role: "tool", tool_call_id: "c1", content: "12 rails" },
  { role: "tool", tool_call_id: "c2", content: "2 stops" },
];

test("FC-258: the engine is chosen by name, an unknown name refuses to start, and a URL alone still means OpenAI-compatible", () => {
  expect(engineName({})).toBe("omlx");
  expect(engineName({ COMPANION_ENGINE: "Claude-CLI" })).toBe("claude-cli");
  expect(() => engineName({ COMPANION_ENGINE: "codex" })).toThrow("isn't one of");
  expect(engineName({ COMPANION_MODEL_URL: "http://127.0.0.1:8000/" })).toBe("openai-compatible");
  expect(engineName({ COMPANION_MODEL_URL: "http://127.0.0.1:8888" })).toBe("omlx");
});

test("FC-258: a hosted engine without its key or model says what's missing instead of starting", async () => {
  await expect(makeEngine({ COMPANION_ENGINE: "anthropic" })).rejects.toThrow("ANTHROPIC_API_KEY");
  await expect(makeEngine({ COMPANION_ENGINE: "openai", OPENAI_API_KEY: "x" })).rejects.toThrow("COMPANION_MODEL");
  const cli = await makeEngine({ COMPANION_ENGINE: "claude-cli" });
  // Only a model on this Mac gets the keep-awake pings and the block padding.
  expect(cli.local).toBe(false);
  expect(cli.describe).toContain("leaves this Mac");
  expect((await makeEngine({ COMPANION_MODEL_URL: "http://127.0.0.1:8000", COMPANION_MODEL: "m" })).local).toBe(true);
  expect((await makeEngine({ COMPANION_MODEL_URL: "https://example.com", COMPANION_MODEL: "m" })).local).toBe(false);
});

test("FC-258: claude -p bills the subscription — API credentials never reach it", () => {
  const env = subscriptionEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "u", HOME: "/h" });
  expect(env).toEqual({ HOME: "/h" });
});

test("FC-258: claude -p reads the conversation as one labelled transcript and learns the tools from the system prompt", () => {
  const t = transcript(CONVERSATION);
  expect(t).not.toContain("You are Ballast");
  expect(t).toContain("Player:\nFind the rails near me.");
  expect(t).toContain('<tool_call>{"name": "find_entities", "arguments": {"what":"rail"}}</tool_call>');
  expect(t).toContain("Result of find_entities:\n12 rails");
  expect(t.endsWith("Reply to the player's last message now, as yourself.")).toBe(true);
  expect(toolInstructions([])).toBe("");
  expect(toolInstructions([TOOL])).toContain('- find_entities: Find things near the player.');
});

function fakeSpawn(lines: object[], seen: { args?: string[]; env?: Record<string, string | undefined>; input?: string }) {
  return (cmd: string[], o: { cwd: string; env: Record<string, string | undefined>; input?: string }) => {
    Object.assign(seen, { args: cmd, env: o.env, input: o.input });
    const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    return { stdout: new Response(body).body!, stderr: new Response("").body!, exited: Promise.resolve(0), kill() {} };
  };
}

test("FC-258: claude -p runs locked down, streams its words, and its written tool calls become real ones", async () => {
  const seen: { args?: string[]; env?: Record<string, string | undefined>; input?: string } = {};
  const tokens: string[] = [];
  const cli = new ClaudeCliClient({
    cwd: "/empty",
    env: { ANTHROPIC_API_KEY: "k", PATH: "/bin" },
    spawn: fakeSpawn([
      { type: "system", subtype: "init" },
      { type: "stream_event", event: { delta: { type: "text_delta", text: "Looking. " } } },
      { type: "stream_event", event: { delta: { type: "text_delta", text: '<tool_call>{"name": "find_entities", "arguments": {"what": "rail"}}</tool_call>' } } },
      { type: "result", is_error: false, usage: { input_tokens: 10, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 20 } },
    ], seen),
  });
  const r = await cli.stream(CONVERSATION.slice(0, 2), { tools: [TOOL], onToken: (t) => tokens.push(t) });
  // None of its own tools, MCP, settings or saved sessions.
  for (const flag of ["-p", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) expect(seen.args).toContain(flag);
  expect(seen.args?.[seen.args.indexOf("--tools") + 1]).toBe("");
  expect(seen.args?.[seen.args.indexOf("--setting-sources") + 1]).toBe("project");
  expect(seen.args?.[seen.args.indexOf("--system-prompt") + 1]).toContain("# Tools");
  expect(seen.env).toEqual({ PATH: "/bin" });
  expect(seen.input).toContain("Find the rails near me.");
  expect(tokens[0]).toBe("Looking. ");
  expect(r.toolCalls.map((c) => [c.function.name, JSON.parse(c.function.arguments)])).toEqual([["find_entities", { what: "rail" }]]);
  expect(r.text).not.toContain("<tool_call>");
  expect(r.usage).toMatchObject({ prompt_tokens: 9010, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 9000 } });
});

test("FC-258: a claude -p error (say, logged out) is an error, not an empty answer", async () => {
  const cli = new ClaudeCliClient({ cwd: "/empty", spawn: fakeSpawn([{ type: "result", is_error: true, result: "Not logged in" }], {}) });
  await expect(cli.stream([{ role: "user", content: "hi" }])).rejects.toThrow("claude -p: Not logged in");
});

test("FC-258: the Anthropic API gets its own shapes — tool_use blocks, and all of one turn's results in one message", () => {
  const { system, messages } = toAnthropicMessages(CONVERSATION);
  expect(system).toBe("You are Ballast.");
  expect(messages).toHaveLength(3);
  expect(messages[1]).toEqual({ role: "assistant", content: [
    { type: "tool_use", id: "c1", name: "find_entities", input: { what: "rail" } },
    { type: "tool_use", id: "c2", name: "find_entities", input: { what: "train-stop" } },
  ] });
  expect(messages[2]).toEqual({ role: "user", content: [
    { type: "tool_result", tool_use_id: "c1", content: "12 rails" },
    { type: "tool_result", tool_use_id: "c2", content: "2 stops" },
  ] });
  expect(toAnthropicTools([TOOL])[0]).toEqual({ name: "find_entities", description: "Find things near the player.", input_schema: TOOL.function.parameters as never });
});

function fakeAnthropic(message: object, seen: { params?: Record<string, unknown> }) {
  return {
    beta: { messages: { stream(params: Record<string, unknown>) {
      seen.params = params;
      return { on() { return this; }, finalMessage: async () => message };
    } } },
  } as never;
}

const USAGE = { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 };

test("FC-258: the Anthropic request — no sampling settings, effort instead of a thinking switch, fallbacks on, system cached", async () => {
  const seen: { params?: Record<string, unknown> } = {};
  const client = new AnthropicClient({ model: "claude-opus-5", client: fakeAnthropic({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "find_entities", input: { what: "rail" } }], usage: USAGE }, seen) });
  const r = await client.stream(CONVERSATION.slice(0, 2), { tools: [TOOL] });
  const p = seen.params!;
  for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(p).not.toHaveProperty(k);
  expect(p.output_config).toEqual({ effort: "low" });
  expect(p.fallbacks).toBe("default");
  expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
  expect(p.system).toEqual([{ type: "text", text: "You are Ballast.", cache_control: { type: "ephemeral" } }]);
  expect(r.toolCalls).toEqual([{ id: "t1", type: "function", function: { name: "find_entities", arguments: '{"what":"rail"}' } }]);
  expect(r.usage).toMatchObject({ prompt_tokens: 105, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 100 } });
  await client.stream(CONVERSATION.slice(0, 2), { thinking: true });
  expect(seen.params!.output_config).toEqual({ effort: "high" });
});

test("FC-258: a refusal, or a tool call cut off at max_tokens, never reaches the agent as something to run", async () => {
  const refused = new AnthropicClient({ model: "m", client: fakeAnthropic({ stop_reason: "refusal", content: [], usage: USAGE }, {}) });
  await expect(refused.stream([{ role: "user", content: "hi" }])).rejects.toThrow("declined");
  const cut = new AnthropicClient({ model: "m", client: fakeAnthropic({ stop_reason: "max_tokens", content: [{ type: "tool_use", id: "t", name: "find_entities", input: { wh: "" } }], usage: USAGE }, {}) });
  await expect(cut.stream([{ role: "user", content: "hi" }])).rejects.toThrow("cut off");
});

test("FC-258: the OpenAI API gets no Qwen sampling settings or thinking switch, and its own token cap", () => {
  const openai = new OmlxClient({ baseUrl: "https://api.openai.com", apiKey: "k", model: "m", thinkingSwitch: "openai" });
  expect(openai.tuning(false, 100)).toEqual({ max_completion_tokens: 100 });
  const omlx = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: "k", model: "m" });
  expect(omlx.tuning(false, 100)).toMatchObject({ max_tokens: 100, chat_template_kwargs: { enable_thinking: false }, top_k: 20 });
});

test("FC-258: an assistant turn with nothing in it is left out rather than sent as an empty text block", () => {
  const { messages } = toAnthropicMessages([{ role: "user", content: "a" }, { role: "assistant", content: "" }, { role: "user", content: "b" }]);
  expect(messages).toEqual([{ role: "user", content: "a" }, { role: "user", content: "b" }]);
});

test("FC-262: oMLX pads past its 8,192-token cache block, another local engine past 2,048, and either can be set", async () => {
  expect((await makeEngine({ COMPANION_MODEL_URL: "http://127.0.0.1:8000", COMPANION_MODEL: "m" })).cacheBlock).toBe(2048);
  expect((await makeEngine({ COMPANION_MODEL_URL: "http://127.0.0.1:8000", COMPANION_MODEL: "m", COMPANION_CACHE_BLOCK: "4096" })).cacheBlock).toBe(4096);
  expect((await makeEngine({ COMPANION_ENGINE: "claude-cli" })).cacheBlock).toBeUndefined();
});
