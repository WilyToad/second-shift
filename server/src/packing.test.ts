import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { check, describeEssentials, essentials, parseNeed, readiness, resolveItem, slots } from "./packing";

// A save with a burner furnace, an electric one, burner and electric inserters, belts, poles and two fuels.
const p = PrototypesSchema.parse({
  recipes: {
    "stone-furnace": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "stone", amount: 5 }], products: [{ type: "item", name: "stone-furnace", amount: 1 }] },
    "small-electric-pole": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "wood", amount: 1 }], products: [{ type: "item", name: "small-electric-pole", amount: 2 }] },
    "medium-electric-pole": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "steel-plate", amount: 2 }], products: [{ type: "item", name: "medium-electric-pole", amount: 1 }] },
  },
  items: {
    "stone-furnace": { type: "item", stack_size: 50, place_result: "stone-furnace" },
    "electric-furnace": { type: "item", stack_size: 50, place_result: "electric-furnace" },
    "burner-inserter": { type: "item", stack_size: 50, place_result: "burner-inserter" },
    inserter: { type: "item", stack_size: 50, place_result: "inserter" },
    "transport-belt": { type: "item", stack_size: 100, place_result: "transport-belt" },
    "iron-chest": { type: "item", stack_size: 50, place_result: "iron-chest" },
    "small-electric-pole": { type: "item", stack_size: 50, place_result: "small-electric-pole" },
    "medium-electric-pole": { type: "item", stack_size: 50, place_result: "medium-electric-pole" },
    coal: { type: "item", stack_size: 50, fuel_value: 4000000 },
    wood: { type: "item", stack_size: 100, fuel_value: 2000000 },
  },
  fluids: {}, technologies: {}, raw_resources: ["coal", "wood", "stone", "iron-ore"],
  machines: {
    "stone-furnace": { type: "furnace", size: [2, 2], crafting_categories: ["smelting"], crafting_speed: 1, burner: true },
    "electric-furnace": { type: "furnace", size: [3, 3], crafting_categories: ["smelting"], crafting_speed: 2, burner: false },
    "burner-inserter": { type: "inserter", size: [1, 1], rotation_speed: 0.013, burner: true },
    inserter: { type: "inserter", size: [1, 1], rotation_speed: 0.014, burner: false },
    "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 },
    "iron-chest": { type: "container", size: [1, 1] },
  },
  entities: {
    "small-electric-pole": { type: "electric-pole", size: [1, 1], collision: [-0.1, -0.1, 0.1, 0.1], supply_area: 2.5, wire_reach: 7.5 },
    "medium-electric-pole": { type: "electric-pole", size: [1, 1], collision: [-0.1, -0.1, 0.1, 0.1], supply_area: 3.5, wire_reach: 9 },
  },
});

test("FC-167: list text becomes an item and a count, including the player's own words", () => {
  expect(parseNeed("20 stone furnace", p)).toEqual({ item: "stone-furnace", count: 20, text: "20 stone furnace" });
  expect(parseNeed("200 transport belts", p)).toEqual({ item: "transport-belt", count: 200, text: "200 transport belts" });
  expect(parseNeed("iron chest", p)).toEqual({ item: "iron-chest", count: 1, text: "iron chest" });
  expect(parseNeed("1,000 coal", p)).toEqual({ item: "coal", count: 1000, text: "1,000 coal" });
  expect(parseNeed("a power source for the outpost", p)).toBeNull(); // nothing in the save is called that
  expect(resolveItem("furnace", p)).toBe("stone-furnace");
});

test("FC-167: a burner build gets fuel, an electric one gets poles and a power source, and each says why", () => {
  const burner = essentials([parseNeed("20 stone furnace", p)!, parseNeed("200 transport belt", p)!], p);
  expect(burner.map((a) => a.text)).toEqual(["100 coal"]);
  expect(burner[0]!.reason).toBe("stone-furnace burns fuel");
  const electric = essentials([parseNeed("8 electric furnace", p)!, parseNeed("16 inserter", p)!], p);
  // The pole covering the most ground, so there are fewer to carry.
  expect(electric.map((a) => a.text)).toEqual(["6 medium-electric-pole", "a power source for the outpost"]);
  expect(electric[0]!.reason).toContain("needs power (medium-electric-pole reaches 3.5 tiles)");
  expect(electric[1]!.reason).toContain("can't pick the generator");
  // Nothing added for things that need neither.
  expect(essentials([parseNeed("4 iron chest", p)!, parseNeed("50 transport belt", p)!], p)).toEqual([]);
  // A burner inserter counts as a burner, not as electric.
  expect(essentials([parseNeed("10 burner inserter", p)!], p).map((a) => a.item)).toEqual(["coal"]);
});

test("FC-167: a pole the player already carries wins over the one with the best coverage", () => {
  const stock = { items: [{ name: "small-electric-pole", count: 30, carried: 30 }] } as any;
  expect(essentials([parseNeed("8 electric furnace", p)!], p, stock)[0]!.text).toBe("2 small-electric-pole");
});

test("FC-167: nothing is added twice, and the fuel the player already has wins", () => {
  const needs = [parseNeed("20 stone furnace", p)!, parseNeed("100 coal", p)!];
  expect(essentials(needs, p)).toEqual([]); // coal is already on the list
  // What the player already carries wins, even when it isn't the save's best fuel.
  const stock = { items: [{ name: "wood", count: 300, carried: 300 }] } as any;
  expect(essentials([parseNeed("20 stone furnace", p)!], p, stock)[0]!.item).toBe("wood");
  expect(describeEssentials(essentials([parseNeed("20 stone furnace", p)!], p))).toEqual([
    "the save's data says the list also needs 100 coal — stone-furnace burns fuel",
  ]);
});

test("FC-167: no prototypes, no guesses", () => {
  expect(essentials([{ item: "stone-furnace", count: 20, text: "20 stone furnace" }], null)).toEqual([]);
  expect(parseNeed("20 stone furnace", null)).toBeNull();
});

test("FC-166: what's missing, what's ready, and whether the load fits", () => {
  const needs = [parseNeed("20 stone furnace", p)!, parseNeed("200 transport belt", p)!, parseNeed("40 inserter", p)!];
  const stock = {
    free_slots: 4, items: [
      { name: "stone-furnace", count: 20, carried: 8, container: "iron-chest", distance: 6 },
      { name: "transport-belt", count: 50, carried: 50 },
    ],
  } as any;
  const states = check(needs, stock, [{ name: "inserter", count: 12 }]);
  expect(states.map((s) => [s.need.item, s.have, s.missing, s.craftable])).toEqual([
    ["stone-furnace", 20, 0, 0],
    ["transport-belt", 50, 150, 0],
    ["inserter", 0, 40, 12],
  ]);
  // 20 furnaces = 1 stack (50), 200 belts = 2 stacks (100 each), 40 inserters = 1 stack.
  expect(slots(needs, p, 4)).toEqual({ needed: 4, free: 4, overBy: 0 });
  expect(slots(needs, p, 2).overBy).toBe(2);
  const lines = readiness(states, slots(needs, p, 2));
  expect(lines[0]).toBe("still missing: 150 transport-belt (50 of 200 in reach); 40 inserter (0 of 40 in reach, 12 craftable by hand now)");
  expect(lines[1]).toBe("ready: stone-furnace 20 (8 carried, the rest nearby)");
  expect(lines[2]).toContain("2 slots short, so something stays behind or it takes two trips");
  expect(readiness([], slots([], p, 10))).toEqual(["the packing list has nothing on it yet"]);
});

test("FC-250: a name with a word left out of the middle resolves, but only when one item fits", async () => {
  const { resolveItem } = await import("./packing");
  const p = await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json();
  // Live 2026-09-20: the model wrote "120 piercing-magazine" and nothing matched it, so the item sat on the list
  // untickable. Ammunition isn't placeable, so Jev's candidates couldn't help either.
  expect(resolveItem("piercing-magazine", p)).toBe("piercing-rounds-magazine");
  expect(resolveItem("uranium magazine", p)).toBe("uranium-rounds-magazine");
  expect(resolveItem("electric drill", p)).toBe("electric-mining-drill");
  expect(resolveItem("gear wheel", p)).toBe("iron-gear-wheel");
  // Words that fit nothing, and a single word, are left alone rather than guessed at.
  expect(resolveItem("shooty things", p)).toBeNull();
  expect(resolveItem("a power source", p)).toBeNull();
  // The plain cases still go the way they did.
  expect(resolveItem("iron plate", p)).toBe("iron-plate");
  expect(resolveItem("magazine", p)).toBe("firearm-magazine");
});
