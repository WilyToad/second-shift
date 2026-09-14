import { expect, test } from "bun:test";
import type { Prototypes } from "@companion/interfaces";
import { applyResearchState } from "./research";

const recipe = (enabled: boolean, productivity_bonus?: number) => ({ category: "crafting", energy: 1, ingredients: [], products: [], enabled, maximum_productivity: 3, ...(productivity_bonus ? { productivity_bonus } : {}) });
const tech = (researched: boolean) => ({ prerequisites: [], unlocks: [], count: 10, ingredients: [], seconds_per_unit: 5, researched });
const data = {
  recipes: { "steel-plate": recipe(false), "iron-gear-wheel": recipe(true), "casting-steel": recipe(false, 0.1) },
  items: {}, fluids: {}, machines: {},
  technologies: { "steel-processing": tech(false), "steel-plate-productivity": tech(false) },
} as unknown as Prototypes;

test("a targeted state only touches the recipes and technologies in its scope", () => {
  const { data: next, changed } = applyResearchState(data, {
    recipes: ["steel-plate"], technologies: ["steel-processing"],
    enabled_recipes: ["steel-plate"], productivity_bonus: {}, researched_technologies: ["steel-processing"],
  });
  expect(changed).toEqual(["recipe steel-plate", "technology steel-processing"]);
  expect(next.recipes["steel-plate"]!.enabled).toBe(true);
  // Out of scope: left alone even though the state doesn't list it as enabled.
  expect(next.recipes["iron-gear-wheel"]!.enabled).toBe(true);
  expect(next.recipes["casting-steel"]!.productivity_bonus).toBe(0.1);
  expect(data.recipes["steel-plate"]!.enabled).toBe(false); // input not mutated
});

test("a whole-force state sets every recipe, removes zero bonuses, and reports no change when equal", () => {
  const full = { enabled_recipes: ["iron-gear-wheel", "steel-plate"], productivity_bonus: { "steel-plate": 0.2 }, researched_technologies: ["steel-processing"] };
  const { data: next, changed } = applyResearchState(data, full);
  expect(changed.sort()).toEqual(["recipe casting-steel", "recipe steel-plate", "technology steel-processing"]);
  expect(next.recipes["steel-plate"]).toMatchObject({ enabled: true, productivity_bonus: 0.2 });
  expect("productivity_bonus" in next.recipes["casting-steel"]!).toBe(false);
  const again = applyResearchState(next, full);
  expect(again.changed).toEqual([]);
  expect(again.data).toBe(next);
});

test("researched inserter hand size bonuses are patched too", () => {
  const parsed = { ...data, inserter_bonuses: { stack: 0, bulk: 0 } } as Prototypes;
  const state = { enabled_recipes: ["iron-gear-wheel"], productivity_bonus: {}, researched_technologies: [], recipes: [], technologies: [], inserter_bonuses: { stack: 1, bulk: 3 } };
  const { data: next, changed } = applyResearchState(parsed, state);
  expect(changed).toEqual(["inserter bonuses"]);
  expect(next.inserter_bonuses).toEqual({ stack: 1, bulk: 3 });
});
