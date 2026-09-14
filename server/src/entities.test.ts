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
  expect(resolveEntityFilterInText("how many rails are near me", null)?.types).toContain("straight-rail");
});
