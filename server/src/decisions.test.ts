import { expect, test } from "bun:test";
import { type Choice, Decisions, decisionsMode, jevKey, type Noul, type Score, viaCounts } from "./decisions";

const questions = {
  world: { type: "noul", instructions: "about the world?", local: false } as Noul,
  pick: { type: "choice", instructions: "which?", criteria: { "stone-furnace": "a furnace", inserter: "an arm" }, local: "inserter" } as Choice<"stone-furnace" | "inserter">,
  urgency: { type: "score", instructions: "how urgent?", criteria: ["quiet", "worth a line", "now"], local: 1 } as Score,
};

const reply = (answers: unknown, status = 200) =>
  (async () => new Response(JSON.stringify({ answers, usage: { input_tokens: 42 } }), { status, headers: { "content-type": "application/json" } })) as never;

const good = {
  world: { type: "noul", noul: 0.94 },
  pick: { type: "choice", choice: "stone-furnace", probabilities: { "stone-furnace": 0.9, inserter: 0.1 }, confidence: 0.88 },
  urgency: { type: "score", score: 2.7, confidence: 0.8 },
};

test("FC-244: with a key, Jev's confident answers replace the local ones and say so", async () => {
  const d = new Decisions({ key: "k", mode: "auto", fetch: reply(good) });
  expect(d.available()).toBe(true);
  const a = await d.decide("state", questions);
  expect(a.world).toEqual({ value: true, via: "jev", confidence: expect.closeTo(0.88, 2), raw: 0.94 });
  expect(a.pick.value).toBe("stone-furnace");
  expect(a.urgency.value).toBe(2.7);
  expect(viaCounts(a)).toEqual({ jev: 3, local: 0 });
});

test("FC-244: no key, pinned local, a bad status, a timeout or a reply that doesn't parse — the local answers stand", async () => {
  const cases: [string, ConstructorParameters<typeof Decisions>[0]][] = [
    ["no key", { key: null, fetch: reply(good) }],
    ["pinned local", { key: "k", mode: "local", fetch: reply(good) }],
    ["bad status", { key: "k", mode: "auto", fetch: reply(good, 500) }],
    ["nonsense reply", { key: "k", mode: "auto", fetch: (async () => new Response("<html>", { status: 200 })) as never }],
    ["timeout", { key: "k", mode: "auto", fetch: ((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as never }],
  ];
  for (const [name, opts] of cases) {
    const a = await new Decisions(opts).decide("state", questions, { budgetMs: 20 });
    expect(`${name}: ${a.world.value} ${a.pick.value} ${a.urgency.value}`).toBe(`${name}: false inserter 1`);
    expect(viaCounts(a)).toEqual({ jev: 0, local: 3 });
  }
});

test("FC-244: an unsure answer is not an answer, and an option Jev invented is refused", async () => {
  const unsure = new Decisions({
    key: "k",
    mode: "auto",
    fetch: reply({
      world: { type: "noul", noul: 0.55 }, // a coin toss: the local answer stands, but the number is kept
      pick: { type: "choice", choice: "assembling-machine-3", confidence: 0.99 }, // not one of ours
      urgency: { type: "score", score: 3, confidence: 0.2 },
    }),
  });
  const a = await unsure.decide("state", questions);
  expect(viaCounts(a)).toEqual({ jev: 0, local: 3 });
  expect(a.world).toMatchObject({ value: false, via: "local", raw: 0.55 });
  expect(a.pick.value).toBe("inserter");
  // A question's own threshold overrides the default: 0.05 lets the coin toss through.
  const loose = { ...questions, world: { ...questions.world, threshold: 0.05 } as Noul };
  expect((await unsure.decide("state", loose)).world.value).toBe(true);
});

test("FC-244: after three failures it rests, says so once, and keeps answering locally", async () => {
  const said: string[] = [];
  let at = 1000;
  let calls = 0;
  const d = new Decisions({
    key: "k",
    mode: "auto",
    now: () => at,
    log: (l) => said.push(l),
    fetch: (async () => {
      calls++;
      return new Response("", { status: 503 });
    }) as never,
  });
  for (let i = 0; i < 3; i++) await d.decide("state", questions);
  expect(calls).toBe(3);
  expect(said).toHaveLength(1);
  expect(said[0]).toContain("using the local paths");
  expect(d.available()).toBe(false);
  await d.decide("state", questions);
  expect(calls).toBe(3); // resting: not called again
  at += 61_000;
  expect(d.available()).toBe(true);
  await d.decide("state", questions);
  expect(calls).toBe(4);
  expect(d.counts.local).toBe(15); // every question of all five batches
});

test("FC-244: an empty batch never calls, and the key is read from the environment", async () => {
  let calls = 0;
  const d = new Decisions({ key: "k", mode: "auto", fetch: (async () => { calls++; return new Response("{}"); }) as never });
  expect(await d.decide("state", {})).toEqual({});
  expect(calls).toBe(0);
  expect(jevKey({ JEV_KEY: " sk-abc " })).toBe("sk-abc");
  expect(jevKey({ JEV_KEY: "" })).toBeNull();
  expect(jevKey({})).toBeNull();
  expect(decisionsMode({ COMPANION_DECISIONS: "local" })).toBe("local");
  expect(decisionsMode({ COMPANION_DECISIONS: "LOCAL" })).toBe("local");
  expect(decisionsMode({})).toBe("auto");
  expect(new Decisions({ key: null }).describe()).toContain("no JEV_KEY");
  expect(new Decisions({ key: "k", mode: "local" }).describe()).toContain("COMPANION_DECISIONS=local");
  expect(new Decisions({ key: "k", mode: "auto" }).describe()).toContain("with the local paths as the fallback");
});

test("FC-244: one call carries the whole batch, in Jev's own shape", async () => {
  let sent: any;
  const d = new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ answers: good }));
    }) as never,
  });
  await d.decide("the state", questions);
  expect(sent.model).toBe("jev-latest");
  expect(sent.state).toBe("the state");
  expect(Object.keys(sent.questions)).toEqual(["world", "pick", "urgency"]);
  // The local answers are ours alone: they never go over the wire.
  expect(JSON.stringify(sent)).not.toContain("local");
  expect(sent.questions.pick.criteria).toEqual({ "stone-furnace": "a furnace", inserter: "an arm" });
  expect(d.counts.calls).toBe(1);
  expect(d.counts.inputTokens).toBe(0); // this reply carried no usage
});

test("FC-244: the counts are per question, so a turn can record which path answered it", async () => {
  const d = new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async () => new Response(JSON.stringify({ answers: { world: { type: "noul", noul: 0.95 }, pick: { type: "choice", choice: "inserter", confidence: 0.2 } } }))) as never,
  });
  const before = { ...d.counts };
  await d.decide("state", { world: questions.world, pick: questions.pick });
  expect({ jev: d.counts.jev - before.jev, local: d.counts.local - before.local }).toEqual({ jev: 1, local: 1 });
});
