import { expect, test } from "bun:test";
import { PrototypesSchema, RecipeSchema } from "./prototypes";

const recipe = {
  category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3,
  ingredients: [{ type: "item", name: "iron-plate", amount: 1 }],
  products: [{ type: "item", name: "electronic-circuit", amount: 1, probability: 1 }],
};

test("a recipe entry validates, with {} for empty Lua arrays", () => {
  expect(RecipeSchema.parse({ ...recipe, ingredients: {} }).ingredients).toEqual([]);
});

test("a renamed field fails validation", () => {
  const { category, ...rest } = recipe;
  expect(RecipeSchema.safeParse({ ...rest, crafting_category: category }).success).toBe(false);
});

test("the capture from the dev save validates", async () => {
  const file = Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url));
  if (!(await file.exists())) return; // captures are local-only
  const data = await file.json();
  const parsed = PrototypesSchema.safeParse(data);
  if (!parsed.success) console.error(parsed.error.issues.slice(0, 5));
  expect(parsed.success).toBe(true);
  expect(Object.keys(parsed.data!.recipes).length).toBeGreaterThan(900);
});
