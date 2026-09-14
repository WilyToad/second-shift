import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { formatPlan, Planner } from "./planner";

const item = (name: string) => ({ type: "item", name, amount: 1 });
const p = PrototypesSchema.parse({
  recipes: {
    "electronic-circuit": { category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [{ ...item("iron-plate") }, { type: "item", name: "copper-cable", amount: 3 }], products: [{ type: "item", name: "electronic-circuit", amount: 1 }] },
    "copper-cable": { category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [{ ...item("copper-plate") }], products: [{ type: "item", name: "copper-cable", amount: 2 }] },
    "iron-gear-wheel": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [{ type: "item", name: "iron-plate", amount: 2 }], products: [{ type: "item", name: "iron-gear-wheel", amount: 1 }] },
    "scrap-recycling": { category: "recycling", energy: 0.2, enabled: true, maximum_productivity: 3, ingredients: [{ ...item("scrap") }], products: [{ type: "item", name: "iron-gear-wheel", amount: 1, probability: 0.2 }] },
  },
  items: {}, fluids: {}, technologies: {},
  machines: {
    "assembling-machine-2": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting", "electronics"], crafting_speed: 0.75 },
    "assembling-machine-3": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting", "electronics"], crafting_speed: 1.25 },
    recycler: { type: "furnace", size: [2, 4], crafting_categories: ["recycling"], crafting_speed: 0.5 },
  },
  entities: {},
});
// Machine unlock state comes from each machine's own recipe.
p.recipes["assembling-machine-2"] = { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [], products: [{ type: "item", name: "assembling-machine-2", amount: 1 }] };
p.recipes["assembling-machine-3"] = { category: "crafting", energy: 0.5, enabled: false, maximum_productivity: 3, ingredients: [], products: [{ type: "item", name: "assembling-machine-3", amount: 1 }] };

test("120 circuits/min with assembling machine 2 (hand-checked)", () => {
  const plan = new Planner(p).plan("electronic-circuit", 120);
  // circuits: 120/min, 0.5 s recipe at speed 0.75 -> 90/min per machine -> 1.33 machines
  expect(plan.steps.find((s) => s.item === "electronic-circuit")).toMatchObject({ machine: "assembling-machine-2", machines: 1.33, perMinute: 120 });
  // cables: 360/min, 2 per 0.5 s craft at 0.75 -> 180/min per machine -> 2 machines
  expect(plan.steps.find((s) => s.item === "copper-cable")).toMatchObject({ machines: 2, perMinute: 360 });
  expect(plan.raw).toEqual({ "iron-plate": 120, "copper-plate": 180 });
  expect(formatPlan(plan)).toContain("electronic-circuit 120/min: 1.33× assembling-machine-2");
});

test("recycling recipes and locked machines are avoided", () => {
  const plan = new Planner(p).plan("iron-gear-wheel", 60);
  expect(plan.steps[0]).toMatchObject({ recipe: "iron-gear-wheel", machine: "assembling-machine-2", machines: 0.67 });
  expect(plan.raw).toEqual({ "iron-plate": 120 });
});

test("catalysts only count what the recipe doesn't return, and raw resources stop expansion", () => {
  const q = PrototypesSchema.parse({
    recipes: {
      salt: { category: "chemistry", energy: 1, enabled: true, maximum_productivity: 3, ingredients: [{ type: "fluid", name: "brine", amount: 100 }, { type: "item", name: "filter", amount: 1 }], products: [{ type: "item", name: "salt", amount: 2 }, { type: "item", name: "filter", amount: 1, probability: 0.9 }] },
      filter: { category: "chemistry", energy: 1, enabled: true, maximum_productivity: 3, ingredients: [{ type: "item", name: "iron-plate", amount: 5 }], products: [{ type: "item", name: "filter", amount: 1 }] },
      brine: { category: "chemistry", energy: 1, enabled: true, maximum_productivity: 3, ingredients: [{ type: "fluid", name: "water", amount: 10 }], products: [{ type: "fluid", name: "brine", amount: 10 }] },
    },
    items: {}, fluids: { water: {} }, technologies: {}, entities: {}, raw_resources: ["brine"],
    machines: { "chemical-plant": { type: "assembling-machine", size: [3, 3], crafting_categories: ["chemistry"], crafting_speed: 1 } },
  });
  const plan = new Planner(q).plan("salt", 120);
  expect(plan.raw.brine).toBe(6000); // 60 crafts/min * 100, not expanded (raw)
  expect(plan.steps.find((s) => s.item === "filter")!.perMinute).toBe(6); // 60 crafts * (1 - 0.9)
});
