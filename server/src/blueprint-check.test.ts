import { expect, test } from "bun:test";
import { PrototypesSchema } from "@companion/interfaces";
import { blueprintsIn, BlueprintSchema, decodeBlueprintString } from "./blueprint";
import { checkBlueprint, describeIssue } from "./blueprint-check";

const capture = Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url));
const bpFile = Bun.file(new URL("../../data/captures/blueprint-gleba.txt", import.meta.url));
const haveCaptures = (await capture.exists()) && (await bpFile.exists());

const mini = PrototypesSchema.parse({
  recipes: { "iron-gear-wheel": { category: "crafting", energy: 0.5, enabled: true, maximum_productivity: 3, ingredients: [], products: [] }, bioflux: { category: "organic", energy: 6, enabled: true, maximum_productivity: 3, ingredients: [], products: [] } },
  items: {}, fluids: {}, technologies: {},
  machines: { "assembling-machine-2": { type: "assembling-machine", size: [3, 3], crafting_categories: ["crafting"] } },
  entities: {
    "assembling-machine-2": { type: "assembling-machine", size: [3, 3], collision: [-1.2, -1.2, 1.2, 1.2] },
    inserter: { type: "inserter", size: [1, 1], collision: [-0.15, -0.15, 0.15, 0.15] },
    "straight-rail": { type: "straight-rail", size: [2, 2], collision: [-0.7, -0.99, 0.7, 0.99] },
  },
});
const bp = (entities: object[]) => BlueprintSchema.parse({ item: "blueprint", entities });

test("a clean layout passes, with counts, recipes and size", () => {
  const r = checkBlueprint(bp([
    { entity_number: 1, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, recipe: "iron-gear-wheel" },
    { entity_number: 2, name: "inserter", position: { x: 3.5, y: 1.5 }, direction: 4 },
    { entity_number: 3, name: "assembling-machine-2", position: { x: 5.5, y: 1.5 }, recipe: "iron-gear-wheel" },
  ]), mini);
  expect(r.issues).toEqual([]);
  expect(r.counts).toEqual({ "assembling-machine-2": 2, inserter: 1 });
  expect(r.recipes).toEqual({ "assembling-machine-2: iron-gear-wheel": 2 });
  expect(r.size).toEqual({ width: 7, height: 3 });
});

test("flags unknown entities, overlaps and recipes the machine can't craft", () => {
  const r = checkBlueprint(bp([
    { entity_number: 1, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, recipe: "bioflux" },
    { entity_number: 2, name: "inserter", position: { x: 2.5, y: 2.5 } }, // inside the assembler
    { entity_number: 3, name: "quantum-widget", position: { x: 9, y: 9 } },
    { entity_number: 4, name: "straight-rail", position: { x: 1, y: 1 } }, // rails skip overlap checks
  ]), mini);
  expect(r.issues.map(describeIssue)).toEqual([
    "1× quantum-widget doesn't exist in this save",
    "assembling-machine-2 can't craft bioflux (category organic)",
    "assembling-machine-2#1 and inserter#2 overlap at tile (2, 2)",
  ]);
  expect(r.skippedOverlap).toBe(1);
});

test.if(haveCaptures)("the real blueprint from the dev save passes against the real prototypes", async () => {
  const p = PrototypesSchema.parse(await capture.json());
  const real = blueprintsIn(decodeBlueprintString(await bpFile.text()))[0]!.blueprint;
  const r = checkBlueprint(real, p);
  expect(r.issues.map(describeIssue)).toEqual([]);
  expect(r.entities).toBe(49);
});
