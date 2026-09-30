import { expect, test } from "bun:test";
import { rowPrototypes } from "./fixtures/row-prototypes";
import { PrototypesSchema, type Prototypes } from "@companion/interfaces";
import { RecipeRetriever } from "./retrieval";

const capture = Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url));
const real: Prototypes | null = (await capture.exists()) ? PrototypesSchema.parse(await capture.json()) : null;

const mini = PrototypesSchema.parse({
  recipes: {
    "electronic-circuit": { category: "electronics", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [{ type: "item", name: "iron-plate", amount: 1 }, { type: "item", name: "copper-cable", amount: 3 }], products: [{ type: "item", name: "electronic-circuit", amount: 1 }] },
    "copper-cable": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [{ type: "item", name: "copper-plate", amount: 1 }], products: [{ type: "item", name: "copper-cable", amount: 2 }] },
  },
  items: { "electronic-circuit": { type: "item", stack_size: 200 }, "copper-cable": { type: "item", stack_size: 200 }, "iron-plate": { type: "item", stack_size: 100 } },
  fluids: {}, technologies: {},
  machines: { "assembling-machine-1": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting", "electronics"], crafting_speed: 0.5 } },
});

test("nicknames and plurals match, and ingredients' recipes come along", () => {
  const r = new RecipeRetriever(mini).retrieve("How many green circuits per minute?");
  expect(r.matched).toContain("item:electronic-circuit");
  expect(r.lines[0]).toStartWith("electronic-circuit: 1 iron-plate, 3 copper-cable -> 1 electronic-circuit");
  expect(r.lines[0]).toEndWith("(0.5s) made in: assembling-machine-1");
  expect(r.lines.some((l) => l.startsWith("copper-cable:"))).toBe(true);
});

test("nothing relevant yields no lines", () => {
  expect(new RecipeRetriever(mini).retrieve("hello there").lines).toEqual([]);
});

test.if(real !== null)("real save: Gleba and modded names resolve", () => {
  const retriever = new RecipeRetriever(real!);
  const bioflux = retriever.retrieve("What makes bioflux?");
  const line = bioflux.lines.find((l) => l.startsWith("bioflux: 15 yumako-mash, 12 jelly -> 4 bioflux"));
  expect(line).toBeDefined();
  expect(line).toEndWith("made in: biochamber"); // category "organic" only, not "organic-or-assembling" machines
  expect(retriever.retrieve("What's the crafting speed of a biochamber?").lines.some((l) => l.startsWith("machine biochamber: assembling-machine 3x3, speed 2"))).toBe(true);
  expect(retriever.retrieve("how do I build a hydro plant").matched).toContain("item:maraxsis-hydro-plant");
  expect(retriever.retrieve("carbon fiber recipe").matched).toContain("item:carbon-fiber");
  const agri = retriever.retrieve("What do I need before I can research agricultural science?");
  expect(agri.matched).toContain("item:agricultural-science-pack");
  expect(agri.lines[0]).toBe("technology agricultural-science-pack: needs artificial-soil, bacteria-cultivation, bioflux-processing | unlocks agricultural-science-pack | trigger: craft 100 bioflux | not researched");
});

test("recipe questions naming something that isn't in the save are recognised", () => {
  const r = new RecipeRetriever(PrototypesSchema.parse(rowPrototypes));
  expect(r.unknownName("How do I craft a quantum widget?")).toBe("quantum widget");
  expect(r.unknownName("What's the recipe for flux capacitors")).toBe("flux capacitors");
  expect(r.unknownName("what does a warp drive need")).toBe("warp drive");
  expect(r.unknownName("How do I craft iron gear wheels?")).toBeNull();
  expect(r.unknownName("How do I craft gear wheels for the mall?")).toBeNull(); // "gear" names something
  expect(r.unknownName("Can you make it faster?")).toBeNull();
  expect(r.unknownName("How many assemblers do I have?")).toBeNull();
});


/** A new map's worth of drills, chests, furnaces and arms (FC-256): the basics unlocked, the rest behind research. */
function newMap(unlockAll = false) {
  const r = (ingredients: [string, number][], enabled: boolean) => ({ category: "crafting", energy: 1, enabled: enabled || unlockAll, maximum_productivity: 3, ingredients: ingredients.map(([name, amount]) => ({ type: "item", name, amount })), products: [] as { type: string; name: string; amount: number }[] });
  const recipes: Record<string, ReturnType<typeof r>> = {
    "burner-mining-drill": r([["iron-gear-wheel", 3], ["stone-furnace", 1], ["iron-plate", 3]], true),
    "electric-mining-drill": r([["electronic-circuit", 3], ["iron-gear-wheel", 5], ["iron-plate", 10]], true),
    "big-mining-drill": r([["tungsten-carbide", 20], ["electric-engine-unit", 10]], false),
    "wooden-chest": r([["wood", 2]], true),
    "iron-chest": r([["iron-plate", 8]], true),
    "steel-chest": r([["steel-plate", 8]], false),
    "stone-furnace": r([["stone", 5]], true),
    "burner-inserter": r([["iron-plate", 1], ["iron-gear-wheel", 1]], true),
    "inserter": r([["electronic-circuit", 1], ["iron-gear-wheel", 1], ["iron-plate", 1]], true),
    "bulk-inserter": r([["fast-inserter", 1], ["iron-gear-wheel", 15]], false),
  };
  for (const [name, recipe] of Object.entries(recipes)) recipe.products = [{ type: "item", name, amount: 1 }];
  const items = Object.fromEntries([...Object.keys(recipes), "iron-ore", "copper-ore", "iron-plate", "stone-wall"].map((n) => [n, { type: "item", stack_size: 50 }]));
  return PrototypesSchema.parse({
    recipes, items, fluids: {}, raw_resources: ["iron-ore", "copper-ore"],
    technologies: {
      "steel-processing": { prerequisites: [], unlocks: ["steel-chest"], researched: unlockAll, count: 50, ingredients: [], seconds_per_unit: 10 },
      "big-mining-drill": { prerequisites: ["steel-processing"], unlocks: ["big-mining-drill"], researched: unlockAll, count: 50, ingredients: [], seconds_per_unit: 10 },
      "bulk-inserter": { prerequisites: ["steel-processing"], unlocks: ["bulk-inserter"], researched: unlockAll, count: 50, ingredients: [], seconds_per_unit: 10 },
    },
    machines: { "assembling-machine-1": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting"], crafting_speed: 0.5 } },
  });
}

test("FC-256: the player's own words find the item — 'a second drill' is the drills they can make, and the answer is told so", () => {
  const retriever = new RecipeRetriever(newMap());
  for (const q of ["I don't have a second drill.", "I need another drill", "what does a drill need?", "is this miner thing working?"]) {
    const r = retriever.retrieve(q);
    expect(r.items).toEqual(["burner-mining-drill", "electric-mining-drill"]);
    expect(r.lines.some((l) => l.startsWith("burner-mining-drill: 3 iron-gear-wheel, 1 stone-furnace, 3 iron-plate"))).toBe(true);
    // Said once, so the answer can name what it took the word to mean.
    expect(r.lines[0]).toContain("read as burner-mining-drill, electric-mining-drill");
  }
  expect(retriever.retrieve("I think I need a chest").items).toEqual(["iron-chest", "wooden-chest"]);
  expect(retriever.retrieve("arms to feed the ovens").items).toEqual(["burner-inserter", "inserter", "stone-furnace"]);
  expect(retriever.retrieve("point me to the nearest ore").items).toEqual(["iron-ore", "copper-ore"]);
  // The whole name still wins over a guess, and "mining drill" isn't read as any drill.
  expect(retriever.retrieve("burner mining drill").items).toEqual(["burner-mining-drill"]);
  expect(retriever.retrieve("burner mining drill").lines[0]).not.toContain("read as");
  // "what does a drill need?" is no longer an unknown name.
  expect(retriever.unknownName("what does a drill need?")).toBeNull();
});

test("FC-256: on a late save, where everything is unlocked, an everyday word still means the basic ones first", () => {
  const retriever = new RecipeRetriever(newMap(true));
  expect(retriever.retrieve("I think I need a chest").items).toEqual(["iron-chest", "wooden-chest", "steel-chest"]);
  expect(retriever.retrieve("arms").items).toEqual(["burner-inserter", "inserter", "bulk-inserter"]);
});

test("FC-256: ordinary talk doesn't pick up items", () => {
  const retriever = new RecipeRetriever(newMap());
  for (const q of ["k, I found it", "start the gathering list", "This here is running", "I'm just starting, so I need some guidance.", "what should I do next?", "the second one is on coal"]) {
    expect(retriever.retrieve(q).items).toEqual([]);
  }
});
