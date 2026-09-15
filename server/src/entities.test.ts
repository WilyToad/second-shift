import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { resolveEntityFilter, resolveEntityFilterInText } from "./entities";

const p = PrototypesSchema.parse({
  recipes: {}, fluids: {}, technologies: {},
  items: { biochamber: { type: "item", stack_size: 20, place_result: "biochamber" } },
  machines: { biochamber: { type: "assembling-machine", size: [3, 3], module_slots: 4 } },
});

test("groups: rails, tracks and belts resolve to entity types", () => {
  expect(resolveEntityFilter("rails", null)?.types).toContain("straight-rail");
  expect(resolveEntityFilter("train tracks", null)?.types).toContain("curved-rail-a");
  expect(resolveEntityFilter("belts", null)?.types).toContain("underground-belt");
});

test("specific things resolve through prototypes to entity names", () => {
  expect(resolveEntityFilter("biochambers", p)?.names).toEqual(["biochamber"]);
  expect(resolveEntityFilter("quantum widgets", p)).toBeNull();
});

test("the player's own words pick the entity: nicknames first, then groups", () => {
  const withBelts = PrototypesSchema.parse({
    recipes: {}, fluids: {}, technologies: {}, machines: {},
    items: { "transport-belt": { type: "item", stack_size: 100, place_result: "transport-belt" }, "fast-transport-belt": { type: "item", stack_size: 100, place_result: "fast-transport-belt" } },
    entities: { "transport-belt": { type: "transport-belt", size: [1, 1], collision: [-0.4, -0.4, 0.4, 0.4] }, "fast-transport-belt": { type: "transport-belt", size: [1, 1], collision: [-0.4, -0.4, 0.4, 0.4] } },
  });
  expect(resolveEntityFilterInText("How many yellow belts are near me on the right?", withBelts)?.names).toEqual(["transport-belt"]);
  // Plain "belts" means every belt type (it used to mean yellow belts only, and missed the player's express belts).
  expect(resolveEntityFilterInText("How many belts are near me?", withBelts)).toMatchObject({ types: expect.arrayContaining(["transport-belt", "underground-belt", "splitter"]) });
  expect(resolveEntityFilterInText("How many belts are near me?", withBelts)?.names).toBeUndefined();
  expect(resolveEntityFilterInText("how many rails are near me", null)?.types).toContain("straight-rail");
});

test("S22: ore searches: 'ore' is every resource tile, a named ore is that resource", () => {
  const ores = PrototypesSchema.parse({ recipes: {}, items: { "iron-ore": { type: "item", stack_size: 50 } }, fluids: {}, technologies: {}, machines: {}, raw_resources: ["iron-ore"] });
  expect(resolveEntityFilter("ore", ores)).toEqual({ label: "ore", types: ["resource"] });
  expect(resolveEntityFilter("ore patches", null)?.types).toEqual(["resource"]);
  expect(resolveEntityFilter("iron ore", ores)?.names).toEqual(["iron-ore"]);
});
