import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { decodeBlueprintString, encodeBlueprintString } from "./blueprint";
import { blueprintThroughput } from "./blueprint-throughput";
import { describeRow, productionRow } from "./blueprint-template";

const item = (name: string, amount: number) => ({ type: "item", name, amount });
const recipe = (category: string, energy: number, ingredients: object[], products: object[], extra = {}) => ({ category, energy, ingredients, products, enabled: true, maximum_productivity: 3, allows_productivity: true, ...extra });
const footprint = (type: string, size: number) => ({ type, size: [size, size], collision: [-size / 2 + 0.2, -size / 2 + 0.2, size / 2 - 0.2, size / 2 - 0.2] });
const base = {
  recipes: {
    "iron-gear-wheel": recipe("crafting", 0.5, [item("iron-plate", 2)], [item("iron-gear-wheel", 1)]),
    "electronic-circuit": recipe("electronics", 0.5, [item("iron-plate", 1), item("copper-cable", 3)], [item("electronic-circuit", 1)]),
    "engine-unit": recipe("advanced-crafting", 10, [item("steel-plate", 1), item("iron-gear-wheel", 1), item("pipe", 2)], [item("engine-unit", 1)]),
    "sulfuric-acid": recipe("chemistry", 1, [item("sulfur", 5), { type: "fluid", name: "water", amount: 100 }], [{ type: "fluid", name: "sulfuric-acid", amount: 50 }]),
    "assembling-machine-2": recipe("crafting", 0.5, [], [item("assembling-machine-2", 1)]),
    "transport-belt": recipe("crafting", 0.5, [], [item("transport-belt", 1)]),
    "fast-transport-belt": recipe("crafting", 0.5, [], [item("fast-transport-belt", 1)]),
    inserter: recipe("crafting", 0.5, [], [item("inserter", 1)]),
    "fast-inserter": recipe("crafting", 0.5, [], [item("fast-inserter", 1)]),
    "medium-electric-pole": recipe("crafting", 0.5, [], [item("medium-electric-pole", 1)]),
  },
  items: {}, fluids: { water: {}, "sulfuric-acid": {} }, technologies: {},
  machines: {
    "assembling-machine-2": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting", "electronics", "advanced-crafting"], crafting_speed: 0.75 },
    "chemical-plant": { type: "assembling-machine", size: [3, 3], crafting_categories: ["chemistry"], crafting_speed: 1 },
    "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 },
    "fast-transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.0625 },
    inserter: { type: "inserter", size: [1, 1], rotation_speed: 0.014, bulk: false, hand_bonus: 0, pickup: [0, -1], drop: [0, 1.2] },
    "fast-inserter": { type: "inserter", size: [1, 1], rotation_speed: 0.04, bulk: false, hand_bonus: 0, pickup: [0, -1], drop: [0, 1.2] },
  },
  entities: {
    "assembling-machine-2": footprint("assembling-machine", 3),
    "chemical-plant": footprint("assembling-machine", 3),
    "transport-belt": footprint("transport-belt", 1),
    "fast-transport-belt": footprint("transport-belt", 1),
    inserter: footprint("inserter", 1),
    "fast-inserter": footprint("inserter", 1),
    "medium-electric-pole": footprint("electric-pole", 1),
  },
  inserter_bonuses: { stack: 2, bulk: 0 },
};
const p = PrototypesSchema.parse(base);

test("a gear row: machine count, slowest inserter that keeps up, and a valid blueprint", () => {
  // am2: 90 gears/min each → 200/min needs 3 machines (270/min); 180 plates/min in per machine = 3/s.
  const r = productionRow(p, { item: "iron-gear-wheel", perMinute: 200 });
  if (!r.ok) throw new Error(r.reason);
  const b = r.build;
  expect([b.machines, b.perMinute, b.belt, b.pole]).toEqual([3, 270, "fast-transport-belt", "medium-electric-pole"]);
  // Hand 3: basic inserter 2.52/s < 3/s, fast inserter 7.2/s.
  expect([b.inserter, b.insertersPerMachine]).toEqual(["fast-inserter", 1]);
  expect(b.inputs).toEqual([{ name: "iron-plate", perMinute: 540 }]);
  // 540 plates/min is more than a yellow lane (450) but fits a red lane (900).
  const counts: Record<string, number> = {};
  for (const e of b.blueprint.entities) counts[e.name] = (counts[e.name] ?? 0) + 1;
  expect(counts).toEqual({ "fast-transport-belt": 18, "assembling-machine-2": 3, "fast-inserter": 6, "medium-electric-pole": 4 });
  // Round-trips as a string, and its own throughput analysis agrees.
  expect(decodeBlueprintString(encodeBlueprintString({ blueprint: b.blueprint }))).toEqual({ blueprint: b.blueprint });
  const t = blueprintThroughput(b.blueprint, p);
  expect(t.outputs).toEqual([{ name: "iron-gear-wheel", perMinute: 270, fluid: false, belts: 0.15 }]);
  expect(t.limits).toEqual([]);
  expect(describeRow(b)).toContain("3 assembling-machine-2 making iron-gear-wheel at 270/min");
});

test("poles reach every inserter and are wired together", () => {
  // 2 machines, a pole every 2 machines: one pair at the start and one past the end of the row.
  const r = productionRow(p, { item: "iron-gear-wheel", perMinute: 180 });
  if (!r.ok) throw new Error(r.reason);
  const poles = r.build.blueprint.entities.filter((e) => e.name === "medium-electric-pole");
  expect(poles.map((e) => [e.position.x, e.position.y])).toEqual([[0.5, 1.5], [0.5, 5.5], [6.5, 1.5], [6.5, 5.5]]);
  const numbers = poles.map((e) => e.entity_number) as [number, number, number, number];
  expect((r.build.blueprint as { wires?: number[][] }).wires).toEqual([
    [numbers[0], 5, numbers[1], 5],
    [numbers[2], 5, numbers[3], 5], [numbers[0], 5, numbers[2], 5], [numbers[1], 5, numbers[3], 5],
  ]);
});

test("two ingredients share the input belt, one per lane", () => {
  const r = productionRow(p, { item: "electronic-circuit", perMinute: 90 });
  if (!r.ok) throw new Error(r.reason);
  expect(r.build.machines).toBe(1);
  expect(r.build.notes[0]).toBe("input belt: iron-plate and copper-cable, one per lane");
});

test("out-of-scope requests get a reason instead of a broken build", () => {
  const reason = (req: { item: string; perMinute: number }, protos = p) => { const r = productionRow(protos, req); return r.ok ? "built" : r.reason; };
  expect(reason({ item: "engine-unit", perMinute: 10 })).toContain("has 3 ingredients");
  expect(reason({ item: "sulfuric-acid", perMinute: 10 })).toContain("no pipes yet");
  expect(reason({ item: "iron-gear-wheel", perMinute: 5000 })).toContain("ask for less and build several rows");
  expect(reason({ item: "copper-ore", perMinute: 10 })).toContain("isn't made by a machine recipe");
  const noFast = PrototypesSchema.parse({ ...base, recipes: { ...base.recipes, "fast-inserter": { ...base.recipes["fast-inserter"], enabled: false } }, inserter_bonuses: { stack: 0, bulk: 0 } });
  // Only basic inserters (0.84/s at hand 1): 3 plates/s needs more than the 2 columns a 3-wide machine leaves.
  expect(reason({ item: "iron-gear-wheel", perMinute: 90 }, noFast)).toContain("more than 2 × inserter can move");
});
