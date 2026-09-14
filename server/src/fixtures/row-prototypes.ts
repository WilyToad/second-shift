// Small prototype set for production row tests: gears, circuits, belts, inserters, poles.
const item = (name: string, amount: number) => ({ type: "item", name, amount });
const recipe = (category: string, energy: number, ingredients: object[], products: object[], extra = {}) => ({ category, energy, ingredients, products, enabled: true, maximum_productivity: 3, allows_productivity: true, ...extra });
const footprint = (type: string, size: number) => ({ type, size: [size, size], collision: [-size / 2 + 0.2, -size / 2 + 0.2, size / 2 - 0.2, size / 2 - 0.2] });
export const rowPrototypes = {
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
