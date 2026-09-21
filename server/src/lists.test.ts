import { expect, test } from "bun:test";
import { Lists, MAX_ITEMS, MAX_LISTS } from "./lists";

const lists = () => { let t = 1000; return new Lists(() => (t += 1)); };

test("FC-163: a list is started, added to, ticked off and cleared by asking", () => {
  const l = lists();
  expect(l.apply({ list: "packing", kind: "packing", add: ["20 stone furnace", "200 transport belt"] }))
    .toBe('Updated "packing": started the list "packing", added 20 stone furnace, added 200 transport belt.');
  expect(l.active()!.name).toBe("packing");
  expect(l.active()!.kind).toBe("packing");
  // "the belts" is how the player says "200 transport belt".
  expect(l.apply({ done: ["the belts"] })).toContain("ticked off 200 transport belt");
  expect(l.active()!.items.filter((i) => i.done).map((i) => i.text)).toEqual(["200 transport belt"]);
  expect(l.apply({ undone: ["belt"] })).toContain("put back 200 transport belt");
  expect(l.apply({ remove: ["stone furnace"] })).toContain("removed 20 stone furnace");
  expect(l.active()!.items).toHaveLength(1);
  expect(l.apply({ clear: true })).toContain("cleared 1 item");
});

test("FC-163: the same item twice, an unknown list, renaming and deleting", () => {
  const l = lists();
  l.apply({ list: "repairs", add: ["fix the wall"] });
  expect(l.apply({ list: "repairs", add: ["fix the wall"] })).toBe('Nothing to change on "repairs".');
  expect(l.apply({ list: "nope", delete: true })).toBe('There\'s no list called "nope".');
  expect(l.apply({ list: "repairs", rename: "wall repairs" })).toContain('renamed it to "wall repairs"');
  expect(l.get("wall repairs")).toBeDefined();
  expect(l.apply({ list: "wall repairs", delete: true })).toBe('Deleted the list "wall repairs".');
  expect(l.all()).toHaveLength(0);
  expect(l.apply({ done: ["anything"] })).toContain("there's no list yet");
});

test("FC-163: caps on lists, items and text keep the turn's tail small", () => {
  const l = lists();
  for (let i = 0; i < MAX_LISTS; i++) l.apply({ list: `list ${i}`, add: ["one thing"] });
  expect(l.apply({ list: "one too many", add: ["x"] })).toContain(`already ${MAX_LISTS} lists`);
  const full = lists();
  for (let i = 0; i < MAX_ITEMS; i++) full.apply({ list: "big", add: [`item ${i}`] });
  expect(full.apply({ list: "big", add: ["over the cap"] })).toContain(`full at ${MAX_ITEMS} items`);
  const long = lists();
  long.apply({ list: "x", add: ["y".repeat(200)] });
  expect(long.active()!.items[0]!.text.length).toBe(80);
});

test("FC-163: the turn's tail shows the active list in full and the others by name", () => {
  const l = lists();
  l.apply({ list: "packing", kind: "packing", add: ["20 stone furnace", "200 transport belt"] });
  l.update("packing", "200 transport belt", { done: true, note: "in your inventory" });
  l.apply({ list: "repairs", add: ["fix the wall"] });
  l.apply({ list: "packing" }); // asking about it again makes it active
  expect(l.format()).toEqual([
    'the player\'s list "packing" (1 of 2 done, a packing list kept in step with what they carry):',
    "- [ ] 20 stone furnace",
    "- [x] 200 transport belt — in your inventory",
    'the player\'s other lists: "repairs" (0/1)',
  ]);
  expect(lists().format()).toEqual([]);
});

test("FC-163: lists come back from a saved session, capped and cleaned", () => {
  const l = lists();
  l.apply({ list: "packing", kind: "packing", add: ["20 stone furnace"] });
  const saved = JSON.parse(JSON.stringify(l.save()));
  const back = lists();
  back.load(saved);
  expect(back.active()!.name).toBe("packing");
  expect(back.active()!.items).toEqual([{ text: "20 stone furnace", done: false }]);
  const messy = lists();
  messy.load({ lists: [{ name: "  odd   name ", kind: "nonsense" as any, items: [{ text: "  spaced   out ", done: 1 as any }], updatedAt: "x" as any }], active: "missing" });
  expect(messy.all()[0]).toEqual({ name: "odd name", kind: "plain", items: [{ text: "spaced out", done: true }], updatedAt: 1001 });
  expect(messy.active()!.name).toBe("odd name");
});

test("FC-166: a changed count replaces the item instead of adding another line", () => {
  const l = lists();
  l.apply({ list: "packing", kind: "packing", add: ["20 stone furnace", "200 transport belt"] });
  expect(l.apply({ set: ["30 stone furnace"] })).toContain('changed "20 stone furnace" to 30 stone furnace');
  expect(l.active()!.items.map((i) => i.text)).toEqual(["30 stone furnace", "200 transport belt"]);
  // Adding the same thing again on a packing list means the same thing.
  expect(l.apply({ add: ["24 stone furnace"] })).toContain('changed "30 stone furnace" to 24 stone furnace');
  expect(l.active()!.items).toHaveLength(2);
  // A plain list keeps both lines: "call mum" and "call mum again" are two jobs.
  const plain = lists();
  plain.apply({ list: "jobs", add: ["walk the wall", "walk the wall again"] });
  expect(plain.active()!.items).toHaveLength(2);
  // Setting a count also clears the tick and the note, because the number to reach changed.
  l.update("packing", "200 transport belt", { done: true, note: "have 200" });
  l.apply({ set: ["400 transport belt"] });
  expect(l.active()!.items.find((i) => /belt/.test(i.text))).toEqual({ text: "400 transport belt", done: false });
});

test("FC-163: items that merely share a word are not the same item", () => {
  const l = lists();
  l.apply({ list: "packing", kind: "packing", add: ["5 iron chest", "20 iron plate"] });
  // "50 iron gear wheel" shares "iron" with both, so it's a new line, not a replacement.
  l.apply({ add: ["50 iron gear wheel"] });
  expect(l.active()!.items.map((i) => i.text)).toEqual(["5 iron chest", "20 iron plate", "50 iron gear wheel"]);
  // The same item with a new count still replaces.
  l.apply({ add: ["12 iron chest"] });
  expect(l.active()!.items.map((i) => i.text)).toEqual(["12 iron chest", "20 iron plate", "50 iron gear wheel"]);
  // An ambiguous word ticks nothing off; a clear one works.
  expect(l.apply({ done: ["iron"] })).toBe('Nothing to change on "packing".');
  expect(l.apply({ done: ["the gear wheels"] })).toContain("ticked off 50 iron gear wheel");
  expect(l.apply({ remove: ["plate"] })).toContain("removed 20 iron plate");
});

test("FC-246: an untracked item survives being saved and loaded, and stays out of the count", () => {
  const lists = new Lists(() => 1);
  lists.apply({ list: "packing", kind: "packing", add: ["20 stone-furnace", "a power source"] });
  lists.update("packing", "20 stone-furnace", { done: true });
  lists.update("packing", "a power source", { untracked: true });
  expect(lists.format()[0]).toContain("1 of 1 done");

  const reloaded = new Lists(() => 1);
  reloaded.load(JSON.parse(JSON.stringify(lists.save())));
  expect(reloaded.active()!.items.map((i) => [i.text, i.done, i.untracked ?? false])).toEqual([
    ["20 stone-furnace", true, false],
    ["a power source", false, true],
  ]);
  expect(reloaded.format()[0]).toContain("1 of 1 done");
  // Nothing can tick an untracked item, even if something tries.
  reloaded.update("packing", "a power source", { done: true });
  expect(reloaded.active()!.items.at(-1)!.done).toBe(false);
});
