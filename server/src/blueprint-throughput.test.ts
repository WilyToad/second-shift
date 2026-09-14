import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { BlueprintSchema } from "./blueprint";
import { blueprintThroughput, describeThroughput } from "./blueprint-throughput";

const p = PrototypesSchema.parse({
  recipes: {
    "iron-gear-wheel": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "iron-plate", amount: 2 }], products: [{ type: "item", name: "iron-gear-wheel", amount: 1 }] },
    "electronic-circuit": { category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "iron-plate", amount: 1 }, { type: "item", name: "copper-cable", amount: 3 }], products: [{ type: "item", name: "electronic-circuit", amount: 1 }] },
    "copper-cable": { category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "copper-plate", amount: 1 }], products: [{ type: "item", name: "copper-cable", amount: 2 }] },
    bioflux: { category: "organic", energy: 6, enabled: true, maximum_productivity: 3, allows_productivity: true, productivity_bonus: 0.1, ingredients: [{ type: "item", name: "mash", amount: 15 }, { type: "fluid", name: "water", amount: 10 }], products: [{ type: "item", name: "bioflux", amount: 4 }] },
  },
  items: {}, fluids: { water: {} }, technologies: {},
  machines: {
    "assembling-machine-2": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting", "electronics"], crafting_speed: 0.75 },
    biochamber: { type: "assembling-machine", size: [3, 3], crafting_categories: ["organic"], crafting_speed: 2, base_productivity: 0.5 },
    "stone-furnace": { type: "furnace", size: [2, 2], crafting_categories: ["smelting"], crafting_speed: 1 },
    "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 },
    "fast-transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.0625 },
    beacon: { type: "beacon", size: [3, 3] },
  },
});
const bp = (entities: object[]) => BlueprintSchema.parse({ item: "blueprint", entities: entities.map((e, i) => ({ entity_number: i + 1, position: { x: i * 4, y: 0 }, ...e })) });

test("net flows per minute for a circuit build, with cables made inside", () => {
  // 3 cable : 2 circuit assemblers. Cable: 90 crafts/min × 2 = 180 cables each; circuit: 90/min, 270 cables each.
  const t = blueprintThroughput(bp([
    ...Array(3).fill({ name: "assembling-machine-2", recipe: "copper-cable" }),
    ...Array(2).fill({ name: "assembling-machine-2", recipe: "electronic-circuit" }),
    { name: "transport-belt" }, { name: "fast-transport-belt" },
  ]), p);
  expect(t.belt).toEqual({ name: "fast-transport-belt", perMinute: 1800 });
  expect(t.outputs).toEqual([{ name: "electronic-circuit", perMinute: 180, fluid: false, belts: 0.1 }]);
  expect(t.inputs).toEqual([{ name: "copper-plate", perMinute: 270, fluid: false, belts: 0.15 }, { name: "iron-plate", perMinute: 180, fluid: false, belts: 0.1 }]);
  expect(t.notes).toEqual([]);
  expect(describeThroughput(t)).toBe("throughput per minute, no modules or beacons: needs copper-plate 270 (15% of one fast-transport-belt), iron-plate 180 (10% of one fast-transport-belt) | makes electronic-circuit 180 (10% of one fast-transport-belt) | every item fits on one fast-transport-belt (1800/min)");
});

test("productivity (built-in plus researched), fluids and overloaded belts", () => {
  // Biochamber: 20 crafts/min, productivity 0.5 + 0.1 → 4 × 1.6 × 20 = 128 bioflux/min each; mash 300, water 200.
  const t = blueprintThroughput(bp([...Array(4).fill({ name: "biochamber", recipe: "bioflux" }), { name: "transport-belt" }]), p);
  expect(t.groups).toEqual([{ recipe: "bioflux", machine: "biochamber", count: 4, craftsPerMinute: 20, productivity: 0.6 }]);
  expect(t.outputs[0]!.perMinute).toBeCloseTo(512);
  expect(t.inputs.map((f) => [f.name, f.perMinute, f.fluid])).toEqual([["mash", 1200, false], ["water", 800, true]]);
  expect(t.inputs[1]!.belts).toBeUndefined();
  expect(describeThroughput(t)).toContain("more than one full transport-belt: mash");
});

test("rocket parts stay in the silo", () => {
  const withSilo = PrototypesSchema.parse({ ...p, recipes: { ...p.recipes, "rocket-part": { category: "rocket-building", energy: 3, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "rocket-fuel", amount: 1 }], products: [{ type: "item", name: "rocket-part", amount: 1 }] } }, machines: { ...p.machines, "rocket-silo": { type: "rocket-silo", size: [9, 9], crafting_categories: ["rocket-building"], crafting_speed: 1 } } });
  const t = blueprintThroughput(bp([{ name: "rocket-silo", recipe: "rocket-part" }]), withSilo);
  expect(t.outputs).toEqual([]);
  expect(t.inputs.map((f) => [f.name, f.perMinute])).toEqual([["rocket-fuel", 20]]);
  expect(t.notes).toEqual(["rocket silos build 20 rocket parts per minute (used inside the silo)"]);
});

test("says what it couldn't count", () => {
  const t = blueprintThroughput(bp([
    { name: "stone-furnace" }, { name: "beacon" },
    { name: "assembling-machine-2", recipe: "iron-gear-wheel", quality: "rare", items: [{ id: { name: "speed-module" } }] },
  ]), p);
  expect(t.notes).toEqual(["modules and beacons not counted (1 machines with modules, 1 beacons)", "1 machines of higher quality counted at normal speed", "1 furnaces pick their recipe from their input, not counted"]);
  expect(describeThroughput(blueprintThroughput(bp([{ name: "stone-furnace" }]), p))).toBe("throughput: nothing countable (1 furnaces pick their recipe from their input, not counted)");
});
