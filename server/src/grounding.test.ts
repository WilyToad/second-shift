import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { entityFacts, recognitionPhrases, vocabulary } from "./grounding";
test("FC-160: entity facts come from the save, and say nothing when the save has nothing", () => {
  const p = PrototypesSchema.parse({
    recipes: { "passive-provider-chest": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "steel-chest", amount: 1 }, { type: "item", name: "electronic-circuit", amount: 3 }], products: [{ type: "item", name: "passive-provider-chest", amount: 1 }] } },
    items: {}, fluids: {}, technologies: {},
    machines: { "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 } },
    entities: {
      "passive-provider-chest": { type: "logistic-container", size: [1, 1], collision: [-0.35, -0.35, 0.35, 0.35], inventory_size: 48, logistic_mode: "passive-provider" },
      "storage-tank": { type: "storage-tank", size: [3, 3], collision: [-1.3, -1.3, 1.3, 1.3], fluid_capacity: 25000 },
      "transport-belt": { type: "transport-belt", size: [1, 1], collision: [-0.4, -0.4, 0.4, 0.4] },
    },
  });
  expect(entityFacts("passive-provider-chest", p)).toBe("passive-provider-chest: logistic container; logistic job: passive provider; holds 48 stacks; built from 1 steel-chest + 3 electronic-circuit");
  expect(entityFacts("storage-tank", p)).toBe("storage-tank: storage tank; holds 25,000 fluid");
  expect(entityFacts("transport-belt", p)).toBe("transport-belt: transport belt; carries 15 items/s (7.5 a lane)");
  expect(entityFacts("crash-site-spaceship", p)).toBeNull();
});

test("FC-175: the vocabulary is the words this save's names are made of, plus what players call things", () => {
  const p = PrototypesSchema.parse({
    recipes: { "iron-gear-wheel": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [], products: [{ type: "item", name: "iron-gear-wheel", amount: 1 }] } },
    items: { "iron-gear-wheel": { type: "item", stack_size: 100 }, "copper-cable": { type: "item", stack_size: 200 } },
    fluids: { "sulfuric-acid": {} }, technologies: { "stone-wall": { researched: false, prerequisites: [], unlocks: [], count: 1, ingredients: [], seconds_per_unit: 5 } },
    machines: { "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 } },
    entities: { "transport-belt": { type: "transport-belt", size: [1, 1], collision: [-0.4, -0.4, 0.4, 0.4] } },
  });
  const words = new Set(vocabulary(p));
  for (const word of ["iron", "gear", "wheel", "copper", "cable", "sulfuric", "acid", "stone", "wall", "transport", "belt"]) {
    expect(words.has(word)).toBe(true);
  }
  // Words the player says that no prototype name contains.
  for (const word of ["wire", "biter", "outpost", "spidertron"]) expect(words.has(word)).toBe(true);
  // Nothing tiny or hyphen-shaped: the recognizer never hears punctuation.
  expect([...words].every((w) => w.length > 2 && /^[a-z]+$/.test(w))).toBe(true);
  expect(vocabulary(p, 5)).toHaveLength(5);
});

test("FC-177: the phrases to bias the recognizer are the save's own things, most talked-about first", () => {
  const p = PrototypesSchema.parse({
    recipes: {
      // The gear is an ingredient of two enabled recipes; the science pack is what every technology costs.
      "transport-belt": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "iron-gear-wheel", amount: 1 }], products: [{ type: "item", name: "transport-belt", amount: 2 }] },
      "inserter": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "iron-gear-wheel", amount: 1 }], products: [{ type: "item", name: "inserter", amount: 1 }] },
      "space-factory-2": { category: "crafting", energy: 0.5, enabled: false, maximum_productivity: 3, allows_productivity: true, ingredients: [{ type: "item", name: "iron-gear-wheel", amount: 50 }], products: [{ type: "item", name: "space-factory-2", amount: 1 }] },
    },
    items: {
      "iron-gear-wheel": { type: "item", stack_size: 100 },
      "automation-science-pack": { type: "item", stack_size: 200 },
      "transport-belt": { type: "item", stack_size: 100, place_result: "transport-belt" },
      "space-factory-2-instantiated": { type: "item", stack_size: 1, place_result: "space-factory-2-instantiated" },
    },
    fluids: { "sulfuric-acid": {} },
    technologies: { "logistics": { researched: false, prerequisites: [], unlocks: [], count: 20, ingredients: [{ type: "item", name: "automation-science-pack", amount: 1 }], seconds_per_unit: 5 } },
    machines: { "transport-belt": { type: "transport-belt", size: [1, 1], belt_speed: 0.03125 } },
    entities: { "transport-belt": { type: "transport-belt", size: [1, 1], collision: [-0.4, -0.4, 0.4, 0.4] } },
  });
  const list = recognitionPhrases(p);
  // Said the way the player says them, not the way the prototype spells them, and nothing repeats.
  expect(list).toContain("transport belt");
  expect(list).toContain("iron gear wheel");
  expect(list).toContain("sulfuric acid");
  expect(list.some((phrase) => phrase.includes("-"))).toBe(false);
  expect(new Set(list).size).toBe(list.length);
  // What the player builds outranks what they only craft; an internal variant is never spoken, so it's left out.
  expect(list.indexOf("transport belt")).toBeLessThan(list.indexOf("iron gear wheel"));
  expect(list).not.toContain("space factory 2 instantiated");
  // A recipe the save hasn't enabled doesn't lend its ingredients any weight, so the gear scores its two enabled uses.
  expect(list.indexOf("iron gear wheel")).toBeLessThan(list.indexOf("automation science pack"));
  expect(list).toContain("spidertron");
  expect(recognitionPhrases(p, 3)).toHaveLength(3);
});
