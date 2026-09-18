import { expect, test } from "bun:test";
import { parseClientMessage } from "./console";

test("FC-200: every well-formed console message parses, with its optional parts", () => {
  const good: unknown[] = [
    { type: "ask", text: "how many rails are near me?" },
    { type: "ask", text: "okay I'm running wire", thinking: false, spoken: true, heard: { first: "okay I'm running wine", picked: "okay I'm running wire", alternatives: 2, offered: ["okay I'm running wine", "okay I'm running wire"], phrases: 100, where: "speech-service", carried: false } },
    { type: "approve", id: "card_12" },
    { type: "decline", id: "card_12" },
    { type: "reset" },
    { type: "wake" },
    { type: "watch", on: true },
  ];
  for (const m of good) {
    const parsed = parseClientMessage(JSON.stringify(m));
    expect(parsed.reason).toBeUndefined();
    expect(parsed.message).toEqual(m);
  }
});

test("FC-200: a malformed message is refused with a reason, never thrown", () => {
  const bad: [unknown, RegExp][] = [
    ["not json at all", /not JSON/],
    [JSON.stringify({ type: "ask" }), /ask: text/],
    [JSON.stringify({ type: "ask", text: 42 }), /ask: text/],
    [JSON.stringify({ type: "approve" }), /approve: id/],
    [JSON.stringify({ type: "approve", id: "" }), /approve: id/],
    [JSON.stringify({ type: "watch", on: "yes" }), /watch: on/],
    [JSON.stringify({ type: "teleport", x: 0 }), /teleport/],
    [JSON.stringify({ type: "ask", text: "x".repeat(9000) }), /ask: text/],
    [JSON.stringify(null), /\?/],
  ];
  for (const [raw, reason] of bad) {
    const parsed = parseClientMessage(raw);
    expect(parsed.message).toBeUndefined();
    expect(parsed.reason).toMatch(reason);
  }
});
