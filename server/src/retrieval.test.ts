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

