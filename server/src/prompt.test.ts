import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { alignToCacheBlock, buildMessages, diagnose, formatMods, formatSnapshot, systemPrompt, userTurn } from "./prompt";

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
  expect(recipeQ).not.toContain("research:"); // research state only when it's relevant (S22)
  expect(formatSnapshot(digest, 0, { question: "what should I research next?", items: [] })).toContain("research: carbon-fiber 62%");
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

test("stuck machine lines appear for slowness questions, filtered to the asked-about item", () => {
  const d = DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: {} }, alerts: {}, surfaces: {},
    machines: { progress: { machines: 100, scanned: true, refresh_ticks: 120 }, stuck: [{ surface: "nauvis", recipes: [
      { recipe: "iron-gear-wheel", total: 20, stuck: 8, statuses: { item_ingredient_shortage: 6, full_output: 2 } },
      { recipe: "mining iron-ore", total: 50, stuck: 40, statuses: { waiting_for_space_in_destination: 40 } },
    ] }] },
  });
  const slow = formatSnapshot(d, 0, { question: "why are my iron gear wheels slow?", items: ["iron-gear-wheel"] });
  expect(slow).toContain("nauvis stuck machines (stuck/total by recipe): iron-gear-wheel 8/20 (item ingredient shortage 6, full output 2)");
  expect(slow).not.toContain("mining iron-ore");
  expect(slow).toContain("(machine status covers 100 machines, refreshed every 2 s)");
  expect(formatSnapshot(d, 0, { question: "what's the recipe for iron gear wheels?", items: ["iron-gear-wheel"] })).not.toContain("stuck machines");
});

test("diagnosis hints: stopped research backing up science, and output-blocked surfaces", () => {
  const d = DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: {} }, alerts: {}, surfaces: {},
    machines: { progress: { machines: 500, scanned: true, refresh_ticks: 120 }, stuck: [
      { surface: "nauvis-factory-floor", recipes: [
        { recipe: "iron-plate", total: 240, stuck: 218, statuses: { full_output: 218 } },
        { recipe: "(research)", total: 47, stuck: 47, statuses: { no_research_in_progress: 47 } },
      ] },
      { surface: "nauvis", recipes: [{ recipe: "automation-science-pack", total: 14, stuck: 14, statuses: { full_output: 14 } }] },
    ] },
  });
  const hints = diagnose(d);
  expect(hints[0]).toBe("root cause: research has stopped: 47 labs are idle with nothing queued, so science assemblers (automation-science-pack on nauvis) have full output and everything upstream backs up");
  expect(hints).toContain("symptom on nauvis-factory-floor: most stuck machines are output-blocked (218 of 265): products aren't being taken away downstream");
});

test("a question naming a surface only gets that surface's machine lines, plus root causes", () => {
  const d = DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: {} }, alerts: {}, surfaces: {},
    machines: { progress: { machines: 500, scanned: true, refresh_ticks: 120 }, stuck: [
      { surface: "nauvis", recipes: [{ recipe: "mining iron-ore", total: 50, stuck: 40, statuses: { waiting_for_space_in_destination: 40 } }, { recipe: "(research)", total: 10, stuck: 10, statuses: { no_research_in_progress: 10 } }] },
      { surface: "nauvis-factory-floor", recipes: [{ recipe: "iron-plate", total: 240, stuck: 218, statuses: { full_output: 218 } }] },
      { surface: "gleba", recipes: [{ recipe: "yumako-processing", total: 9, stuck: 3, statuses: { item_ingredient_shortage: 3 } }] },
    ] },
  });
  const text = formatSnapshot(d, 0, { question: "Why is my Nauvis factory floor so slow?", items: [] });
  expect(text).toContain("nauvis-factory-floor stuck machines");
  expect(text).not.toContain("gleba stuck machines");
  expect(text).toContain("root cause: research has stopped");
  expect(text).not.toContain("symptom on nauvis:");
});

test("alignment converges when reference lines tokenize differently from the system prompt", async () => {
  // System text at 2 chars/token, reference lines at ~3.2 chars/token (like the real save).
  const sys = "y".repeat(2 * 2367);
  const measure = async (s: string) => 2367 + Math.ceil((s.length - sys.length) / 3.2);
  const lines = Array.from({ length: 400 }, (_, i) => `technology t${i}: needs a, b | unlocks c, d`);
  const aligned = await alignToCacheBlock(sys, lines, measure);
  expect(aligned.tokens).toBeGreaterThanOrEqual(4096 + 24);
  expect(aligned.tokens).toBeLessThan(4096 + 24 + 40);
});

test("a paused game is called out in the snapshot header", () => {
  const d = DigestSchema.parse({ tick: 7, paused: true, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {} });
  expect(formatSnapshot(d, 0)).toStartWith("[game state at tick 7, 0 s old, game is PAUSED: rates and machine status are frozen]");
});

test("planned rate questions skip machine and production blocks", () => {
  const d = DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: {} }, alerts: {},
    surfaces: [{ name: "gleba", produced: [{ name: "bioflux", per_minute: 38 }, { name: "jelly", per_minute: 90 }], consumed: {}, science: {}, age_ticks: 0 }],
    machines: { progress: { machines: 10, scanned: true, refresh_ticks: 60 }, stuck: [{ surface: "gleba", recipes: [{ recipe: "bioflux", total: 4, stuck: 2, statuses: { full_output: 2 } }] }] },
  });
  const text = formatSnapshot(d, 0, { question: "how many biochambers for 60 bioflux per minute?", items: ["bioflux"], planned: true });
  expect(text).not.toContain("stuck machines");
  expect(text).toContain("gleba rates/min for items asked about: bioflux 38");
  expect(text).not.toContain("jelly");
});

test("FC-156: research only for research, science, rate, machine and what-next questions, idle labs or not", () => {
  const craft = formatSnapshot(digest, 0, { question: "what can I craft right now?", items: [] });
  expect(craft).toContain("player: p on gleba at (1, 2)");
  expect(craft).not.toContain("research:");
  const idle = DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {},
    machines: { progress: { machines: 4, scanned: true, refresh_ticks: 1 }, stuck: [{ surface: "nauvis", recipes: [{ recipe: "(research)", total: 4, stuck: 4, statuses: { no_research_in_progress: 4 } }] }] },
  });
  // The first voice session's questions (2026-09-15): none is about research.
  for (const question of ["Testing hello", "No what's around me", "Where is the rocket silo can you point it out to me", "What do I have in my inventory", "What do I use these for", "How many radars are near me"]) {
    expect(formatSnapshot(idle, 0, { question, items: [] })).not.toContain("research:");
  }
  for (const question of ["what's being researched?", "why is my science slow?", "what should I do next?", "are my labs working?", "what's my iron production?"]) {
    expect(formatSnapshot(idle, 0, { question, items: [] })).toContain("research: nothing researching (4 labs idle)");
  }
});

test("FC-131: the system prompt lists the save's own mods, not the author's", () => {
  expect(systemPrompt(null)).not.toContain("maraxsis");
  expect(formatMods(["base", "core", "second-shift"])).toContain("none: an unmodded base game");
  expect(formatMods(["space-age", "base", "quality", "elevated-rails", "second-shift"])).toBe("[save data: mods]\nelevated-rails, quality, space-age");
  expect(systemPrompt(null, ["base", "space-age"])).toContain("[save data: mods]\nspace-age");
});

test("S25: a long padding line that overshoots the boundary is swapped for a shorter one", async () => {
  const measure = async (system: string) => Math.ceil(system.length / 3);
  const system = "x".repeat(3 * 4080);
  // The first line is long (~90 tokens): taking it would land ~70 tokens past the goal.
  const lines = ["technology long-one: " + "y".repeat(250), "short: a", "medium line: machine-a, machine-b, machine-c, machine-d", "tiny"];
  const aligned = await alignToCacheBlock(system, lines, measure);
  expect(aligned.tokens).toBeGreaterThanOrEqual(4096 + 24);
  expect(aligned.tokens).toBeLessThan(4096 + 24 + 12);
  expect(aligned.system).not.toContain("long-one");
});
