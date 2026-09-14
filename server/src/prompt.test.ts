import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { alignToCacheBlock, buildMessages, formatSnapshot, systemPrompt, userTurn } from "./prompt";

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

test("production lines only when the question is about rates or names a tracked item", () => {
  const recipeQ = formatSnapshot(digest, 0, { question: "what's the recipe for carbon fiber?", items: ["carbon-fiber"] });
  expect(recipeQ).not.toContain("produced/min");
  expect(recipeQ).toContain("(production rates omitted");
  expect(recipeQ).toContain("research: carbon-fiber 62%"); // header always present
  expect(formatSnapshot(digest, 0, { question: "how much bioflux am I making?", items: ["bioflux"] })).toContain("gleba produced/min: bioflux 37.9");
  expect(formatSnapshot(digest, 0, { question: "is bioflux ok", items: ["bioflux"] })).toContain("gleba rates/min for items asked about: bioflux 37.9");
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

test("stable prefix is padded with reference lines until it crosses the next cache block", async () => {
  const measure = async (system: string) => Math.ceil(system.length / 3); // fake tokenizer: 3 chars per token
  const system = "x".repeat(3 * 3769);
  const lines = Array.from({ length: 200 }, (_, i) => `category-${i}: machine-a, machine-b`);
  const aligned = await alignToCacheBlock(system, lines, measure);
  expect(aligned.target).toBe(4096);
  expect(aligned.tokens).toBeGreaterThanOrEqual(4096 + 24); // clears the boundary despite the probe's user-turn tokens
  expect(aligned.tokens).toBeLessThan(4096 + 64); // just past the boundary, not a whole extra block
  expect(aligned.system.startsWith(system)).toBe(true);
});
