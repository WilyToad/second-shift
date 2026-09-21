import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { Decisions } from "./decisions";
import { itemCriteria, renamedNote, resolveListItems } from "./list-items";

/** The dev save's own dump: a modded save's names, not vanilla's. */
const protos = PrototypesSchema.parse(await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json());

const jev = (answers: Record<string, { choice: string; confidence: number }>) =>
  new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const out: Record<string, unknown> = {};
      for (const name of Object.keys(body.questions)) {
        const a = answers[name];
        if (a) out[name] = { type: "choice", choice: a.choice, confidence: a.confidence };
      }
      return new Response(JSON.stringify({ answers: out }));
    }) as never,
  });

test("FC-246: the lexical path resolves what it can, with no call at all", async () => {
  const d = jev({});
  const r = await resolveListItems(["20 stone furnace", "200 transport belt", "100 carbon"], protos, d);
  expect(r.map((x) => x.listText)).toEqual(["20 stone-furnace", "200 transport-belt", "100 carbon"]);
  expect(r.every((x) => x.via === "local")).toBe(true);
  expect(d.counts.calls).toBe(0);
  expect(renamedNote(r)).toBe("");
});

test("FC-246: what the lexical path misses, Jev names — and the answer says it did", async () => {
  const d = jev({ item0: { choice: "stone-furnace", confidence: 0.69 }, item1: { choice: "inserter", confidence: 0.62 } });
  const r = await resolveListItems(["20 ovens", "enough arms to feed them"], protos, d);
  expect(r.map((x) => x.listText)).toEqual(["20 stone-furnace", "inserter"]);
  expect(r.map((x) => x.via)).toEqual(["jev", "jev"]);
  expect(renamedNote(r)).toBe('read as this save\'s names: "20 ovens" → 20 stone-furnace, "enough arms to feed them" → inserter');
  expect(d.counts.calls).toBe(1); // both in one call
});

test("FC-246: an unsure answer, a name this save doesn't have, and no key all leave the words alone", async () => {
  // Below the threshold: measured, this is where the wrong answers live, so the player's words stand.
  expect((await resolveListItems(["a box to put things in"], protos, jev({ item0: { choice: "storage-chest", confidence: 0.34 } })))[0]!.listText).toBe("a box to put things in");
  // Jev answering with something that isn't one of our options is refused by the service itself.
  expect((await resolveListItems(["ovens"], protos, jev({ item0: { choice: "invented-machine", confidence: 0.99 } })))[0]!.listText).toBe("ovens");
  // No key: the lexical answers, and nothing leaves the Mac.
  const r = await resolveListItems(["20 ovens", "200 transport belt"], protos, new Decisions({ key: null }));
  expect(r.map((x) => x.listText)).toEqual(["20 ovens", "200 transport-belt"]);
  expect(r.every((x) => x.via === "local")).toBe(true);
  expect(await resolveListItems(["20 ovens"], protos, undefined)).toHaveLength(1);
});

test("FC-246: the candidates are this save's placeable items, and a long list is split across calls", async () => {
  const criteria = itemCriteria(protos);
  const names = Object.keys(criteria);
  expect(names.length).toBeLessThanOrEqual(255); // Jev's limit on a choice
  expect(names).toContain("stone-furnace");
  expect(names).toContain("roboport");
  expect(names).not.toContain("iron-plate"); // not placeable: not a candidate
  let batches = 0;
  const d = new Decisions({
    key: "k",
    mode: "auto",
    fetch: (async (_u: string, init?: RequestInit) => {
      batches++;
      expect(Object.keys(JSON.parse(String(init?.body)).questions).length).toBeLessThanOrEqual(10);
      return new Response(JSON.stringify({ answers: {} }));
    }) as never,
  });
  const many = Array.from({ length: 25 }, (_, i) => `mystery thing ${i}`);
  expect(await resolveListItems(many, protos, d)).toHaveLength(25);
  expect(batches).toBe(3);
});
