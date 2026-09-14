import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { buildMessages, formatSnapshot, SYSTEM_RULES, userTurn } from "./prompt";

const digest = DigestSchema.parse({
  tick: 100, player: { name: "p", surface: "gleba", position: { x: 1, y: 2 } },
  research: { current: "carbon-fiber", progress: 0.62, queue: ["carbon-fiber", "stack-inserter"] },
  surfaces: [{ name: "gleba", produced: [{ name: "agricultural-science-pack", per_minute: 37.94 }], consumed: {}, age_ticks: 30 }],
  alerts: {},
});

test("snapshot is compact text with rounded rates", () => {
  const text = formatSnapshot(digest, 4200);
  expect(text).toContain("[game state at tick 100, 4 s old]");
  expect(text).toContain("research: carbon-fiber 62%; queued: stack-inserter");
  expect(text).toContain("gleba produced/min: agricultural-science-pack 37.9");
  expect(text).toContain("urgent alerts: none");
});

test("messages keep a stable prefix: system, history as sent, then the new turn last", () => {
  const first = userTurn("why?", "state A");
  const history = [first, { role: "assistant" as const, content: "because" }];
  const next = userTurn("and now?", "state B");
  const msgs = buildMessages(history, next);
  expect(msgs[0]).toEqual({ role: "system", content: SYSTEM_RULES });
  expect(msgs.slice(1, 3)).toEqual(history); // identical to what was sent last turn
  expect(msgs.at(-1)!.content.endsWith("state B")).toBe(true);
});
