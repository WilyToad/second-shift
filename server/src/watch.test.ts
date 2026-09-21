import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { findings, howLongAgo, LOOK_EVERY_MS, REPEAT_AFTER_MS, Watcher } from "./watch";

const digest = (opts: { produced?: Record<string, number>; idleLabs?: number; researching?: string } = {}) =>
  DigestSchema.parse({
    tick: 1, alerts: [],
    research: { progress: 0, queue: [], ...(opts.researching ? { current: opts.researching } : {}) },
    surfaces: [{ name: "nauvis", produced: Object.entries(opts.produced ?? {}).map(([name, per_minute]) => ({ name, per_minute })), consumed: [], science: [], age_ticks: 0 }],
    machines: {
      progress: { machines: 100, scanned: true, refresh_ticks: 60 },
      stuck: opts.idleLabs ? [{ surface: "nauvis", recipes: [{ recipe: "(research)", stuck: opts.idleLabs, total: opts.idleLabs, statuses: { no_research_in_progress: opts.idleLabs } }] }] : [],
    },
  });

test("FC-193: it notices a real drop and idle labs, and stays quiet when nothing changed", () => {
  const before = digest({ produced: { "iron-plate": 240, "copper-plate": 120 } });
  // A third off is worth a line; a few per cent isn't.
  expect(findings(digest({ produced: { "iron-plate": 100, "copper-plate": 118 } }), before).map((f) => f.kind)).toEqual(["drop:iron-plate"]);
  expect(findings(digest({ produced: { "iron-plate": 235, "copper-plate": 119 } }), before)).toEqual([]);
  // Small numbers don't count: a line that falls from 8 to 2 a minute isn't news.
  expect(findings(digest({ produced: { tungsten: 2 } }), digest({ produced: { tungsten: 8 } }))).toEqual([]);
  // The turn's own root-cause rules come along.
  expect(findings(digest({ idleLabs: 47 }), null).map((f) => f.line)[0]).toContain("research has stopped");
  // Nothing at all on a healthy factory, which is most of the time.
  expect(findings(digest({ produced: { "iron-plate": 240 } }), digest({ produced: { "iron-plate": 240 } }))).toEqual([]);
});

test("FC-193: at most one note per look, and it doesn't say the same thing twice", async () => {
  let now = 1_000_000;
  const notes: string[] = [];
  const asked: number[] = [];
  const watcher = new Watcher({
    digest: () => digest({ idleLabs: 47 }),
    say: async (fresh) => { asked.push(fresh.length); return "Your labs are idle."; },
    emit: (n) => notes.push(n.text),
    now: () => now,
  });
  expect(await watcher.look()).not.toBeNull();
  expect(notes).toEqual(["Your labs are idle."]);

  // Same finding, ten minutes later: nothing said, and the model isn't even asked.
  now += 10 * 60 * 1000;
  expect(await watcher.look()).toBeNull();
  expect(asked).toHaveLength(1);

  // After the quiet period it may say it again, because it's still true and they've been away from it.
  now += REPEAT_AFTER_MS + 1000;
  expect(await watcher.look()).not.toBeNull();
  expect(notes).toHaveLength(2);
});

test("FC-193: nothing to say means no model round at all, and no game means no look", async () => {
  let asked = 0;
  const quiet = new Watcher({ digest: () => digest({ produced: { "iron-plate": 240 } }), say: async () => { asked++; return "x"; }, emit: () => {} });
  expect(await quiet.look()).toBeNull();
  expect(asked).toBe(0);

  const offline = new Watcher({ digest: () => undefined, say: async () => { asked++; return "x"; }, emit: () => {} });
  expect(await offline.look()).toBeNull();
  expect(asked).toBe(0);

  // The model can decline to say anything, and then nothing is emitted.
  const notes: unknown[] = [];
  const declining = new Watcher({ digest: () => digest({ idleLabs: 5 }), say: async () => null, emit: (n) => notes.push(n) });
  expect(await declining.look()).toBeNull();
  expect(notes).toEqual([]);
});

test("FC-193: it won't chatter, even when every look finds something new", async () => {
  let now = 1_000_000;
  // A different item collapses each look, so every finding is a new kind and the repeat rule never fires — which
  // is what makes this a test of the quiet floor rather than of the repeat rule.
  const items = ["iron-plate", "copper-plate", "steel-plate", "plastic-bar", "sulfur"];
  let look = 0;
  const notes: string[] = [];
  const watcher = new Watcher({
    digest: () => {
      const produced = Object.fromEntries(items.map((name, i) => [name, i === look - 1 ? 40 : 240]));
      look++;
      return digest({ produced });
    },
    say: async (fresh) => fresh[0]!.line,
    emit: (n) => notes.push(n.text),
    now: () => now,
  });
  watcher.start(60_000); // a minute between looks, so the floor is two minutes
  await watcher.look();
  await watcher.look();
  expect(notes).toHaveLength(1); // the second look found something new and still kept quiet
  now += 60_000;
  await watcher.look();
  expect(notes).toHaveLength(1);
  now += 61_000; // past two looks' worth of quiet
  await watcher.look();
  expect(notes).toHaveLength(2);
  watcher.stop();
});

test("FC-193: it's off until it's turned on, and says how long ago it looked", () => {
  const watcher = new Watcher({ digest: () => digest(), say: async () => "x", emit: () => {} });
  expect(watcher.on).toBe(false);
  watcher.start(LOOK_EVERY_MS);
  expect(watcher.on).toBe(true);
  watcher.stop();
  expect(watcher.on).toBe(false);

  expect(howLongAgo(20_000)).toBe("just now");
  expect(howLongAgo(60_000)).toBe("a minute ago");
  expect(howLongAgo(5 * 60_000)).toBe("5 minutes ago");
  expect(howLongAgo(60 * 60_000)).toBe("an hour ago");
});

test("FC-247: with no decisions service every finding is judged locally and the quiet floor rules, as before", async () => {
  const { triage } = await import("./watch");
  const found = [{ kind: "power", line: "the whole base is browning out" }, { kind: "drop:iron-plate", line: "iron-plate is down from 100 to 20 a minute" }];
  const judged = await triage(found, undefined);
  expect(judged.map((t) => [t.level, t.via])).toEqual([[3, "local"], [3, "local"]]);
});

test("FC-247: noise is never said, the worst thing is what gets said, and a bad enough one breaks the quiet floor", async () => {
  const { Decisions } = await import("./decisions");
  // A fake Jev that scores a finding by what its line says.
  const levelFor = (instructions: string) => (instructions.includes("research has stopped") ? noise : instructions.includes("iron-plate") ? iron : 3);
  let noise = 3;
  let iron = 3;
  const decisions = new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, { instructions: string }> };
      const answers = Object.fromEntries(Object.entries(body.questions).map(([name, q]) => [name, { type: "score", score: levelFor(q.instructions), confidence: 0.9 }]));
      return new Response(JSON.stringify({ answers }));
    }) as never,
  });
  let now = 1_000_000;
  const notes: string[] = [];
  const asked: string[][] = [];
  const watcher = new Watcher({
    digest: () => digest({ idleLabs: 47 }),
    decisions,
    say: async (fresh) => { asked.push(fresh.map((f) => f.kind)); return fresh[0]!.line; },
    emit: (n) => notes.push(n.text),
    now: () => now,
  });

  // Judged noise: not said, and the model is never asked to phrase it.
  noise = 1;
  expect(await watcher.look()).toBeNull();
  expect(asked).toHaveLength(0);

  // Worth a line: said, exactly as before.
  noise = 3;
  now += REPEAT_AFTER_MS + 1000;
  expect(await watcher.look()).not.toBeNull();
  expect(notes).toHaveLength(1);
});

test("FC-247: the most important finding is the one offered, and a bad enough one is said inside the quiet floor", async () => {
  const { Decisions } = await import("./decisions");
  const levels: Record<string, number> = { "research has stopped": 3, "iron-plate": 5 };
  const decisions = new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, { instructions: string }> };
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([name, q]) => [name, { type: "score", score: Object.entries(levels).find(([t]) => q.instructions.includes(t))?.[1] ?? 3, confidence: 0.9 }]),
      );
      return new Response(JSON.stringify({ answers }));
    }) as never,
  });
  let now = 1_000_000;
  const asked: string[][] = [];
  const notes: string[] = [];
  let state = digest({ idleLabs: 47 });
  const watcher = new Watcher({
    digest: () => state,
    decisions,
    say: async (fresh) => { asked.push(fresh.map((f) => f.kind)); return fresh[0]!.line; },
    emit: (n) => notes.push(n.text),
    now: () => now,
  });
  watcher.start(60_000); // a one-minute look, so the quiet floor is two minutes
  expect(await watcher.look()).not.toBeNull();
  expect(notes).toHaveLength(1);

  // Half a minute later, well inside the floor: an iron-plate collapse is level 5, so it is said anyway, and it is
  // offered first even though the rules found the idle labs first.
  now += 30_000;
  state = digest({ idleLabs: 47, produced: { "iron-plate": 10 } });
  const before = digest({ idleLabs: 47, produced: { "iron-plate": 240 } });
  const w2 = new Watcher({
    digest: () => state,
    decisions,
    say: async (fresh) => { asked.push(fresh.map((f) => f.kind)); return fresh[0]!.line; },
    emit: (n) => notes.push(n.text),
    now: () => now,
  });
  w2.start(60_000);
  // Seed what it saw last time, so the drop is a finding.
  (w2 as unknown as { before: unknown }).before = before;
  (w2 as unknown as { lastNoteAt: number }).lastNoteAt = now - 30_000;
  now += 60_000;
  expect(await w2.look()).not.toBeNull();
  expect(asked.at(-1)![0]).toBe("drop:iron-plate"); // the worst one leads
  watcher.stop();
  w2.stop();
});
