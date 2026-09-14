import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { resolveEntityFilter } from "./entities";

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
