import { expect, test } from "bun:test";
import { toolCallsFromText } from "./tool-text";

test("FC-184: a call written as text is recovered, in the shape the session actually produced", () => {
  // Verbatim from the player's session log (2026-09-17), where this became the answer and the search never ran.
  const answer = `<tool_call>
<function=find_entities>
<parameter=direction>
up
</parameter>
<parameter=radius>
128
</parameter>
<parameter=what>
enemy
</parameter>
</function>
</tool_call>`;
  const { calls, text } = toolCallsFromText(answer);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.function.name).toBe("find_entities");
  // Numbers come back as numbers, because the tools' schemas expect them.
  expect(JSON.parse(calls[0]!.function.arguments)).toEqual({ direction: "up", radius: 128, what: "enemy" });
  expect(text).toBe("");
});

test("FC-184: the JSON form works too, prose is left alone, and markup never survives", () => {
  const json = toolCallsFromText('Looking now.\n<tool_call>{"name": "find_entities", "arguments": {"what": "lab", "radius": 64}}</tool_call>');
  expect(json.calls.map((c) => c.function.name)).toEqual(["find_entities"]);
  expect(JSON.parse(json.calls[0]!.function.arguments)).toEqual({ what: "lab", radius: 64 });
  expect(json.text).toBe("Looking now.");

  // Talking about a tool is not calling one.
  const prose = toolCallsFromText("I'd use find_entities for that, but you haven't asked me to look yet.");
  expect(prose.calls).toEqual([]);
  expect(prose.text).toContain("find_entities");

  // Two calls in one answer, and a block cut off mid-stream: no call, and no markup shown either.
  const two = toolCallsFromText("<tool_call><function=a></function></tool_call><tool_call><function=b></function></tool_call>");
  expect(two.calls.map((c) => c.function.name)).toEqual(["a", "b"]);
  expect(two.calls.map((c) => c.id)).toEqual(["call_text_1", "call_text_2"]);
  const cut = toolCallsFromText("<tool_call>\n<function=find_ent");
  expect(cut.calls).toEqual([]);
  expect(cut.text).toBe("");
});
