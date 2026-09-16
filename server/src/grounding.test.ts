import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { entityFacts } from "./grounding";
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
