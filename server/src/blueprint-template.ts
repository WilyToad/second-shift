// Blueprints built in code from a request (FC-048). The model picks the item and rate; code picks the
// machine, counts, belt, inserters and poles from the save's data, then checks the result like any
// pasted blueprint. Template: a production row.
//
//   y=0        input belt  →   (ingredient A on one lane, B on the other)
//   y=1        pole  ins  ins | pole ...
//   y=2..2+H   [machine][machine][machine] ...
//   y=2+H      pole  ins  ins | pole ...
//   y=3+H      output belt →
import type { Prototypes } from "@companion/interfaces";
import { BlueprintSchema, type Blueprint } from "./blueprint";
import { checkBlueprint, describeIssue } from "./blueprint-check";
import { blueprintThroughput } from "./blueprint-throughput";
import { outputPerCraft, Planner, productivityFor } from "./planner";

export type RowRequest = { item: string; perMinute: number };
export type RowBuild = {
  blueprint: Blueprint;
  item: string;
  recipe: string;
  machine: string;
  machines: number;
  perMinute: number; // what the row makes with this many machines
  inputs: { name: string; perMinute: number }[];
  belt: string;
  inserter: string;
  insertersPerMachine: number;
  pole: string;
  notes: string[];
};
export type RowResult = { ok: true; build: RowBuild } | { ok: false; reason: string };

// Base game constants the dump doesn't carry: supply area half-width and wire reach.
const POLES = [
  { name: "medium-electric-pole", supply: 3.5, reach: 9 },
  { name: "small-electric-pole", supply: 2.5, reach: 7.5 },
];
const BELTS = ["turbo-transport-belt", "express-transport-belt", "fast-transport-belt", "transport-belt"];
const INSERTERS = ["inserter", "fast-inserter", "bulk-inserter", "stack-inserter"];
const BLUEPRINT_VERSION = 562949958467584; // 2.0.77, as exported by the game
const COPPER = 5; // defines.wire_connector_id.pole_copper; blueprints store wires as [entity, connector, entity, connector]
const INSERTER_HALF = 0.15; // inserter collision half-width: it must overlap a pole's supply area

const round = (n: number) => Math.round(n * 100) / 100;

export function productionRow(p: Prototypes, req: RowRequest): RowResult {
  const planner = new Planner(p);
  const recipeName = planner.recipeFor(req.item);
  if (!recipeName) return { ok: false, reason: `${req.item} isn't made by a machine recipe in this save` };
  const recipe = p.recipes[recipeName]!;
  const fluid = [...recipe.ingredients, ...recipe.products].find((x) => x.type === "fluid");
  if (fluid) return { ok: false, reason: `${recipeName} uses ${fluid.name}, and this template has no pipes yet` };
  const solid = recipe.ingredients.filter((i) => i.type === "item");
  if (solid.length > 2) return { ok: false, reason: `${recipeName} has ${solid.length} ingredients; one input belt carries at most 2 (one per lane)` };
  const products = [...new Set(recipe.products.map((x) => x.name))];
  const choice = planner.machineFor(recipe.category);
  if (!choice) return { ok: false, reason: `no machine in this save crafts ${recipe.category}` };
  const machineProto = p.machines[choice.name]!;
  if (machineProto.type === "furnace") return { ok: false, reason: `${recipeName} is smelted; furnaces pick their recipe from their input, and this template sets recipes on assemblers` };
  if (machineProto.burner) return { ok: false, reason: `${choice.name} burns fuel, and this template only powers machines with electricity` };
  if (!choice.unlocked) return { ok: false, reason: `${choice.name} isn't unlocked yet` };
  const unlocked = (name: string) => p.recipes[name]?.enabled === true && p.entities[name] !== undefined;

  const productivity = productivityFor(recipe, machineProto.base_productivity ?? 0);
  const craftsPerMinute = (60 * (machineProto.crafting_speed ?? 1)) / recipe.energy;
  const perMachine = outputPerCraft(recipe, req.item, productivity) * craftsPerMinute;
  const machines = Math.max(1, Math.ceil(req.perMinute / perMachine - 1e-9));
  const [w, h] = machineProto.size;

  // Inserters place items on the belt's far lane only, and each input lane carries one ingredient: a lane is half a belt.
  const itemsOut = products.reduce((n, name) => n + outputPerCraft(recipe, name, productivity) * craftsPerMinute, 0) * machines;
  const laneNeed = Math.max(itemsOut, ...solid.map((i) => i.amount * craftsPerMinute * machines));
  const belts = BELTS.filter(unlocked).map((name) => ({ name, lane: (p.machines[name]?.belt_speed ?? 0) * 4 * 3600 }));
  const belt = belts.find((b) => b.lane >= laneNeed) ?? null;
  if (!belt) {
    const best = belts[0];
    return { ok: false, reason: best ? `${round(laneNeed)}/min on one lane is more than a ${best.name} lane carries (${round(best.lane)}/min); ask for less and build several rows` : "no belt is unlocked yet" };
  }

  const pole = POLES.find((x) => unlocked(x.name));
  if (!pole) return { ok: false, reason: "no electric pole is unlocked yet" };

  // Per machine: slowest unlocked inserter that keeps up; a second one per side when even the fastest can't.
  const hand = (name: string) => 1 + (p.machines[name]!.hand_bonus ?? 0) + (p.machines[name]!.bulk ? p.inserter_bonuses.bulk : p.inserter_bonuses.stack);
  const capacity = (name: string) => hand(name) * (p.machines[name]!.rotation_speed ?? 0) * 60;
  const needPerSecond = Math.max(itemsOut / machines, solid.reduce((n, i) => n + i.amount * craftsPerMinute, 0)) / 60;
  const available = INSERTERS.filter((name) => unlocked(name) && p.machines[name]?.rotation_speed);
  if (!available.length) return { ok: false, reason: "no inserter is unlocked yet" };
  // Columns that can hold an inserter: every column except the pole column (column 0) of each machine.
  const maxPerMachine = Math.max(1, w - 1);
  let inserter = "", perMachineInserters = 0;
  for (let count = 1; count <= maxPerMachine && !inserter; count++) {
    const fits = available.find((name) => capacity(name) * count >= needPerSecond);
    if (fits) { inserter = fits; perMachineInserters = count; }
  }
  if (!inserter) return { ok: false, reason: `${choice.name} needs ${round(needPerSecond)} items/s through its inserters, more than ${maxPerMachine} × ${available.at(-1)} can move` };

  // Poles sit in column 0 of a machine, in both inserter rows. One pole can power the inserters of the
  // machine on each side of it when both are within its supply area (and the next pole within wire
  // reach); otherwise every machine gets its own.
  const columns = [...Array(w).keys()].filter((c) => c > 0).sort((a, b) => Math.abs(a - w / 2) - Math.abs(b - w / 2)).slice(0, perMachineInserters);
  const polesEvery = columns.every((c) => Math.max(c, w - c) + INSERTER_HALF <= pole.supply) && 2 * w <= pole.reach ? 2
    : columns.every((c) => c + INSERTER_HALF <= pole.supply) && w <= pole.reach ? 1 : 0;
  if (!polesEvery) return { ok: false, reason: `${choice.name} is too wide to power its inserters with ${pole.name}` };

  const entities: Record<string, unknown>[] = [];
  const add = (e: Record<string, unknown>) => entities.push({ entity_number: entities.length + 1, ...e });
  // Blueprints keep copper wires explicitly (a pasted blueprint doesn't auto-connect its poles).
  const wires: [number, number, number, number][] = [];
  const polePairs: [number, number][] = [];
  const addPoles = (x: number) => {
    add({ name: pole.name, position: { x: x + 0.5, y: 1.5 } });
    const top = entities.length;
    add({ name: pole.name, position: { x: x + 0.5, y: outRow + 0.5 } });
    const bottom = entities.length;
    wires.push([top, COPPER, bottom, COPPER]);
    const previous = polePairs.at(-1);
    if (previous) wires.push([previous[0], COPPER, top, COPPER], [previous[1], COPPER, bottom, COPPER]);
    polePairs.push([top, bottom]);
  };
  const outRow = 2 + h, beltOut = 3 + h, length = machines * w;
  for (let x = 0; x < length; x++) add({ name: belt.name, position: { x: x + 0.5, y: 0.5 }, direction: 4 });
  for (let i = 0; i < machines; i++) {
    const left = i * w;
    add({ name: choice.name, position: { x: left + w / 2, y: 2 + h / 2 }, recipe: recipeName });
    // Inserter columns from the middle outwards, skipping column 0 (poles).
    for (const c of columns) {
      // Facing north (direction 0): picks up from the north tile, drops to the south.
      add({ name: inserter, position: { x: left + c + 0.5, y: 1.5 }, direction: 0 });
      add({ name: inserter, position: { x: left + c + 0.5, y: outRow + 0.5 }, direction: 0 });
    }
    if (i % polesEvery === 0) addPoles(left);
  }
  // With a pole every 2 machines, an even-numbered last machine has no pole on its right: add one past the row.
  if (polesEvery === 2 && (machines - 1) % 2 === 1) addPoles(length);
  for (let x = 0; x < length; x++) add({ name: belt.name, position: { x: x + 0.5, y: beltOut + 0.5 }, direction: 4 });

  const perMinute = perMachine * machines;
  const blueprint = BlueprintSchema.parse({
    item: "blueprint",
    label: `${req.item} ${round(perMinute)}/min (${machines} ${choice.name})`,
    icons: [{ signal: { name: req.item }, index: 1 }],
    entities,
    wires,
    version: BLUEPRINT_VERSION,
  });

  // The same checks as a pasted blueprint: a generated build with problems is a bug, not an answer.
  const check = checkBlueprint(blueprint, p);
  if (check.issues.length) return { ok: false, reason: `generated row failed its own checks: ${check.issues.map(describeIssue).join("; ")}` };
  const throughput = blueprintThroughput(blueprint, p);
  if (throughput.limits.length) return { ok: false, reason: `generated row has slow inserters: ${JSON.stringify(throughput.limits)}` };

  const notes: string[] = [`input belt: ${solid.map((i) => i.name).join(" and ")}${solid.length === 2 ? ", one per lane" : ""}`];
  if (perMinute > req.perMinute * 1.05) notes.push(`rounded up to whole machines: ${round(perMinute)}/min`);
  if (productivity > 0) notes.push(`includes ${Math.round(productivity * 100)}% productivity`);
  if (recipe.surface_conditions?.length) notes.push(`${recipeName} only works where ${recipe.surface_conditions.map((c) => `${c.property} ${c.min ?? "-"}..${c.max ?? "-"}`).join(", ")}`);
  if (!recipe.enabled) notes.push(`recipe ${recipeName} isn't unlocked yet`);
  return {
    ok: true,
    build: {
      blueprint, item: req.item, recipe: recipeName, machine: choice.name, machines, perMinute,
      inputs: solid.map((i) => ({ name: i.name, perMinute: i.amount * craftsPerMinute * machines })),
      belt: belt.name, inserter, insertersPerMachine: perMachineInserters, pole: pole.name, notes,
    },
  };
}

/** One line for the model: what was built and what to feed it. */
export function describeRow(b: RowBuild): string {
  // "about": the rate comes from machine speed and productivity, and the review gives the same number as a range (FC-161).
  return `[generated blueprint: ${b.machines} ${b.machine} making ${b.item} at about ${round(b.perMinute)}/min (recipe ${b.recipe}) | needs ${b.inputs.map((i) => `${i.name} ${round(i.perMinute)}/min`).join(", ")} | ${b.belt}, ${b.insertersPerMachine} ${b.inserter} in and out per machine, ${b.pole} | ${b.notes.join("; ")}]`;
}
