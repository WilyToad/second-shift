import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { powerCorrections, recipeCorrections } from "./recipe-claims";

const r = (ingredients: [string, number][], product: string) => ({ category: "crafting", energy: 1, enabled: true, maximum_productivity: 3, ingredients: ingredients.map(([name, amount]) => ({ type: "item", name, amount })), products: [{ type: "item", name: product, amount: 1 }] });
const p = PrototypesSchema.parse({
  recipes: {
    "burner-mining-drill": r([["iron-plate", 3], ["iron-gear-wheel", 3], ["stone-furnace", 1]], "burner-mining-drill"),
    "iron-gear-wheel": r([["iron-plate", 2]], "iron-gear-wheel"),
    "stone-furnace": r([["stone", 5]], "stone-furnace"),
    "lab": r([["electronic-circuit", 10], ["iron-gear-wheel", 10], ["transport-belt", 4]], "lab"),
  },
  items: Object.fromEntries(["burner-mining-drill", "iron-gear-wheel", "stone-furnace", "iron-plate", "stone", "iron-ore", "lab", "electronic-circuit", "transport-belt", "coal"].map((n) => [n, { type: "item", stack_size: 50, ...(n === "burner-mining-drill" || n === "lab" ? { place_result: n } : {}) }])),
  fluids: {}, technologies: {},
  machines: {
    "burner-mining-drill": { type: "mining-drill", size: [2, 2], energy_usage: 2500, mining_speed: 0.25, burner: true },
    lab: { type: "lab", size: [3, 3], energy_usage: 1000 },
  },
});

test("FC-257: the playtest's wrong burner-drill recipe gets the save's own recipe as a correction", () => {
  expect(recipeCorrections("A burner drill takes 2 iron gear wheels, 5 iron plate, 1 stone furnace.", p)).toEqual(["Correction: in this save a burner-mining-drill takes 3 iron-plate, 3 iron-gear-wheel, 1 stone-furnace."]);
  expect(recipeCorrections("Burner-mining-drill: 2 iron-gear-wheel, 5 iron-plate, 1 stone-furnace — by hand.", p)).toHaveLength(1);
});

test("FC-257: a right recipe, several of it, its rollups, and a passing mention are left alone", () => {
  for (const ok of [
    "Burner-mining-drill: 3 iron-plate, 3 iron-gear-wheel, 1 stone-furnace — by hand or in an assembling machine.",
    "Burner-mining-drill: 3 iron plate, 3 iron gear wheel, 1 stone furnace, by hand — 0.25 ore a second.",
    "Two burner drills means 6 iron plate, 6 iron gear wheels, 2 stone furnaces — so 10 stone for the furnaces.",
    "Burner-mining-drill: 3 iron plate, 3 iron gear wheels (6 plate total), 1 stone furnace — so 9 iron ore and 5 stone.",
    "Move the burner drill onto iron ore; it burns coal.",
    "The burner drill wants 3 plate and 3 gears.",
  ]) expect(recipeCorrections(ok, p)).toEqual([]);
});

test("FC-257: a power figure next to a machine is checked against its rated draw, times a count only when one is written", () => {
  expect(powerCorrections("A burner mining drill uses 30 MW, so keep it fed.", p)).toEqual(["Correction: a burner-mining-drill draws 150 kW in this save, not 30 MW."]);
  expect(powerCorrections("The burner drill draws 150 kW of coal.", p)).toEqual([]);
  expect(powerCorrections("Two burner drills draw 300 kW between them.", p)).toEqual([]);
  expect(powerCorrections("47 labs draw 2.8 MW.", p)).toEqual([]);
  expect(powerCorrections("Your labs are idle; the grid has 30 MW spare.", p)).toEqual([]);
});
