import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { buildMessages, formatSnapshot, systemPrompt, userTurn } from "./prompt";

const digest = DigestSchema.parse({
  tick: 100, player: { name: "p", surface: "gleba", position: { x: 1, y: 2 } },
  research: { current: "carbon-fiber", progress: 0.62, queue: ["carbon-fiber", "stack-inserter"] },
  surfaces: [{ name: "gleba", produced: [{ name: "bioflux", per_minute: 37.94 }], consumed: {}, science: [{ name: "agricultural-science-pack", per_minute: 0, per_minute_10h: 15.64 }], age_ticks: 30 }],
  alerts: {},
});

test("snapshot is compact text with rounded rates", () => {
  const text = formatSnapshot(digest, 4200);
  expect(text).toContain("[game state at tick 100, 4 s old]");
  expect(text).toContain("research: carbon-fiber 62%; queued: stack-inserter");
  expect(text).toContain("gleba produced/min: bioflux 37.9");
  expect(text).toContain("gleba science/min (now | 10h avg): agricultural-science-pack 0 | 15.6");
  expect(text).toContain("urgent alerts: none");
});

test("messages keep a stable prefix: system, history as sent, then the new turn last", () => {
  const first = userTurn("why?", { snapshot: "state A" });
  const history = [first, { role: "assistant" as const, content: "because" }];
  const next = userTurn("and now?", { recipes: ["bioflux: 15 yumako-mash, 12 jelly -> 4 bioflux (6s organic)"], snapshot: "state B" });
  const system = systemPrompt(null);
  const msgs = buildMessages(system, history, next);
  expect(msgs[0]).toEqual({ role: "system", content: system });
  expect(msgs.slice(1, 3)).toEqual(history); // identical to what was sent last turn
  const last = msgs.at(-1)!.content;
  expect(last.endsWith("state B")).toBe(true); // snapshot always last
  expect(last.indexOf("bioflux:")).toBeLessThan(last.indexOf("state B"));
});
