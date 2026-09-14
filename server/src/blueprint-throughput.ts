// What a blueprint makes and needs per minute, and how that compares with its belts (FC-097).
// Uses the save's recipes, machine speeds and productivity (built-in and researched). Modules, beacons,
// quality and inserter limits aren't counted; the notes say when a blueprint has any of them.
import type { Prototypes } from "@companion/interfaces";
import type { Blueprint } from "./blueprint";
import { outputPerCraft, productivityFor } from "./planner";

export type RecipeGroup = { recipe: string; machine: string; count: number; craftsPerMinute: number; productivity: number };
export type Flow = { name: string; perMinute: number; fluid: boolean; belts?: number };
export type Throughput = {
  groups: RecipeGroup[];
  inputs: Flow[]; // needed from outside, net of what the blueprint makes itself
  outputs: Flow[]; // left over for outside
  belt?: { name: string; perMinute: number }; // the fastest belt in the blueprint
  notes: string[];
};

const EPSILON = 1e-6;
const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const percent = (share: number) => `${share >= 0.1 ? Math.round(share * 100) : Math.round(share * 1000) / 10}%`;

export function blueprintThroughput(bp: Blueprint, p: Prototypes): Throughput {
  const groups = new Map<string, RecipeGroup>();
  const made = new Map<string, number>();
  const used = new Map<string, number>();
  const fluids = new Set(Object.keys(p.fluids));
  let belt: Throughput["belt"];
  let furnacesWithoutRecipe = 0, drills = 0, beacons = 0, withModules = 0, quality = 0, rocketParts = 0;

  for (const e of bp.entities) {
    const machine = p.machines[e.name];
    if (!machine) continue;
    if (machine.type === "transport-belt" && machine.belt_speed) {
      // Both lanes: 4 items per lane per tile, belt_speed in tiles per tick.
      const perMinute = machine.belt_speed * 8 * 60 * 60;
      if (!belt || perMinute > belt.perMinute) belt = { name: e.name, perMinute };
      continue;
    }
    if (machine.type === "beacon") { beacons++; continue; }
    if (machine.type === "mining-drill") { drills++; continue; }
    if (!machine.crafting_categories) continue;
    if (!e.recipe) { if (machine.type === "furnace") furnacesWithoutRecipe++; continue; }
    const recipe = p.recipes[e.recipe];
    if (!recipe || !machine.crafting_categories.includes(recipe.category)) continue; // the checker reports these
    if ((e as { items?: unknown[] }).items?.length) withModules++;
    if (e.quality && e.quality !== "normal") quality++;

    const productivity = productivityFor(recipe, machine.base_productivity ?? 0);
    const craftsPerMinute = (60 * (machine.crafting_speed ?? 1)) / recipe.energy;
    const key = `${e.name} ${e.recipe}`;
    const group = groups.get(key) ?? { recipe: e.recipe, machine: e.name, count: 0, craftsPerMinute, productivity };
    group.count++;
    groups.set(key, group);
    // Rocket parts stay in the silo and become a rocket, so they aren't an output.
    if (machine.type === "rocket-silo") rocketParts += outputPerCraft(recipe, e.recipe, productivity) * craftsPerMinute;
    else for (const name of new Set(recipe.products.map((x) => x.name))) {
      made.set(name, (made.get(name) ?? 0) + outputPerCraft(recipe, name, productivity) * craftsPerMinute);
    }
    for (const i of recipe.ingredients) used.set(i.name, (used.get(i.name) ?? 0) + i.amount * craftsPerMinute);
  }

  const flow = (name: string, perMinute: number): Flow => {
    const fluid = fluids.has(name);
    return { name, perMinute, fluid, ...(belt && !fluid ? { belts: perMinute / belt.perMinute } : {}) };
  };
  const inputs: Flow[] = [], outputs: Flow[] = [];
  for (const name of new Set([...made.keys(), ...used.keys()])) {
    const net = (made.get(name) ?? 0) - (used.get(name) ?? 0);
    if (net > EPSILON) outputs.push(flow(name, net));
    else if (net < -EPSILON) inputs.push(flow(name, -net));
  }
  inputs.sort((a, b) => b.perMinute - a.perMinute);
  outputs.sort((a, b) => b.perMinute - a.perMinute);

  const notes: string[] = [];
  if (rocketParts) notes.push(`rocket silos build ${round(rocketParts)} rocket parts per minute (used inside the silo)`);
  if (withModules || beacons) notes.push(`modules and beacons not counted (${withModules} machines with modules, ${beacons} beacons)`);
  if (quality) notes.push(`${quality} machines of higher quality counted at normal speed`);
  if (furnacesWithoutRecipe) notes.push(`${furnacesWithoutRecipe} furnaces pick their recipe from their input, not counted`);
  if (drills) notes.push(`${drills} mining drills not counted (output depends on the resource)`);
  return { groups: [...groups.values()], inputs, outputs, ...(belt ? { belt } : {}), notes };
}

/** One compact line for the model: net flows per minute, belt load, and what wasn't counted. */
export function describeThroughput(t: Throughput, maxFlows = 8): string {
  if (!t.groups.length) return t.notes.length ? `throughput: nothing countable (${t.notes.join("; ")})` : "";
  const flows = (list: Flow[]) =>
    list.slice(0, maxFlows).map((f) => `${f.name} ${round(f.perMinute)}${f.fluid ? " (fluid)" : ""}${f.belts !== undefined ? ` (${percent(f.belts)} of one ${t.belt!.name})` : ""}`).join(", ") || "none";
  const parts = [`throughput per minute, no modules or beacons: needs ${flows(t.inputs)} | makes ${flows(t.outputs)}`];
  if (t.belt) {
    const overloaded = [...t.inputs, ...t.outputs].filter((f) => (f.belts ?? 0) > 1);
    parts.push(overloaded.length ? `more than one full ${t.belt.name}: ${overloaded.map((f) => f.name).join(", ")}` : `every item fits on one ${t.belt.name} (${round(t.belt.perMinute)}/min)`);
  }
  if (t.notes.length) parts.push(`not counted: ${t.notes.join("; ")}`);
  return parts.join(" | ");
}
