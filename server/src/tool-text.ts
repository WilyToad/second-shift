// A tool call the model wrote as text instead of sending as one (FC-184).
//
// Qwen's template emits calls in a `<tool_call>` block, and oMLX normally parses that into the API's own
// `tool_calls`. Sometimes it doesn't — the player asked about a red dot on the map and got the raw block as their
// answer, with the search never run and the question never answered. The surrounding turns of the same session used
// the parsed form and worked, so this recovers the call rather than treating the turn as prose.
import type { ToolCall } from "./model";

const BLOCK = /<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|$)/g;
const FUNCTION = /<function\s*=\s*([\w.-]+)\s*>/;
const PARAMETER = /<parameter\s*=\s*([\w.-]+)\s*>([\s\S]*?)(?:<\/parameter>|$)/g;

/** "128" becomes a number and "true" a boolean, because the tools' own schemas expect those types. */
function value(raw: string): unknown {
  const text = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return text;
}

function fromJson(body: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown; parameters?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name : null;
    if (!name) return null;
    const args = (parsed.arguments ?? parsed.parameters) as unknown;
    return { name, args: args && typeof args === "object" ? (args as Record<string, unknown>) : {} };
  } catch {
    return null;
  }
}

function fromXml(body: string): { name: string; args: Record<string, unknown> } | null {
  const fn = FUNCTION.exec(body);
  if (!fn) return null;
  const args: Record<string, unknown> = {};
  for (const m of body.matchAll(PARAMETER)) args[m[1]!] = value(m[2]!);
  return { name: fn[1]!, args };
}

/**
 * Pulls calls out of an answer's text and returns the text without them. Returns no calls for an answer that merely
 * talks about a tool ("I'll use find_entities"), because only a real block counts.
 */
export function toolCallsFromText(text: string, id = (n: number) => `call_text_${n}`): { calls: ToolCall[]; text: string } {
  if (!text.includes("<tool_call>")) return { calls: [], text };
  const calls: ToolCall[] = [];
  const stripped = text.replace(BLOCK, (_whole, body: string) => {
    const parsed = fromJson(body.trim()) ?? fromXml(body);
    // An unparseable block is still dropped: showing the player markup is never the right answer.
    if (parsed) calls.push({ id: id(calls.length + 1), type: "function", function: { name: parsed.name, arguments: JSON.stringify(parsed.args) } });
    return "";
  });
  return { calls, text: stripped.replace(/\n{3,}/g, "\n\n").trim() };
}
