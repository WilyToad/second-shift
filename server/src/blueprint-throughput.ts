// What a blueprint makes and needs per minute, and how that compares with its belts (FC-097).
// Uses the save's recipes, machine speeds and productivity (built-in and researched). Modules, beacons and
// quality aren't counted; the notes say when a blueprint has any of them. Inserters are checked against the
// machines they serve, using swing time and researched hand size (FC-105).
import type { Prototypes } from "@companion/interfaces";
import type { Blueprint } from "./blueprint";
import { outputPerCraft, productivityFor } from "./planner";

export type RecipeGroup = { recipe: string; machine: string; count: number; craftsPerMinute: number; productivity: number };
export type Flow = { name: string; perMinute: number; fluid: boolean; belts?: number };
export type InserterLimit = { machine: string; recipe: string; side: "input" | "output"; machines: number; inserters: number; needPerSecond: number; capacityPerSecond: number };
export type Throughput = {
  groups: RecipeGroup[];
  inputs: Flow[]; // needed from outside, net of what the blueprint makes itself
  outputs: Flow[]; // left over for outside
  belt?: { name: string; perMinute: number }; // the fastest belt in the blueprint
  limits: InserterLimit[]; // machines whose inserters can't keep up
  notes: string[];
};

const EPSILON = 1e-6;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Pickup and drop offsets of an inserter facing `direction` (2.0 blueprint directions: 0 north, 4 east).
 * The prototype gives them facing north; each quarter turn maps (x, y) to (-y, x). Checked in the dev
 * game against inserters built from a blueprint (scripts/test-inserters.ts). */
export function inserterReach(proto: { pickup?: [number, number]; drop?: [number, number] }, direction: number): { pickup: [number, number]; drop: [number, number] } | null {
  if (!proto.pickup || !proto.drop) return null;
  const turns = Math.round(direction / 4) % 4;
  const rotate = ([x, y]: [number, number]): [number, number] => {
    for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    return [x, y];
  };
  return { pickup: rotate(proto.pickup), drop: rotate(proto.drop) };
}
const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const percent = (share: number) => `${share >= 0.1 ? Math.round(share * 100) : Math.round(share * 1000) / 10}%`;

export function blueprintThroughput(bp: Blueprint, p: Prototypes): Throughput {
  const groups = new Map<string, RecipeGroup>();
  const made = new Map<string, number>();
  const used = new Map<string, number>();
  const fluids = new Set(Object.keys(p.fluids));
  let belt: Throughput["belt"];
  let furnacesWithoutRecipe = 0, drills = 0, beacons = 0, withModules = 0, quality = 0, rocketParts = 0;
  type Placed = { name: string; recipe: string; needIn: number; needOut: number; capIn: number; capOut: number; inserters: { in: number; out: number } };
  const placed: Placed[] = [];
  const tiles = new Map<string, Placed>();
  const inserters: { x: number; y: number; direction: number; name: string }[] = [];

  for (const e of bp.entities) {
    const machine = p.machines[e.name];
    if (!machine) continue;
    if (machine.type === "transport-belt" && machine.belt_speed) {
      // Both lanes: 4 items per lane per tile, belt_speed in tiles per tick.
      const perMinute = machine.belt_speed * 8 * 60 * 60;
      if (!belt || perMinute > belt.perMinute) belt = { name: e.name, perMinute };
      continue;
    }
    if (machine.type === "inserter") { inserters.push({ x: e.position.x, y: e.position.y, direction: e.direction ?? 0, name: e.name }); continue; }
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

    // Item flow through this one machine (fluids go through pipes), for the inserter check.
    const perSecond = craftsPerMinute / 60;
    const itemProducts = new Set(recipe.products.filter((x) => x.type === "item").map((x) => x.name));
    const needOut = machine.type === "rocket-silo" ? 0 : [...itemProducts].reduce((n, name) => n + outputPerCraft(recipe, name, productivity) * perSecond, 0);
    const needIn = recipe.ingredients.filter((i) => i.type !== "fluid").reduce((n, i) => n + i.amount * perSecond, 0);
    const entry: Placed = { name: e.name, recipe: e.recipe, needIn, needOut, capIn: 0, capOut: 0, inserters: { in: 0, out: 0 } };
    placed.push(entry);
    const [w, h] = p.entities[e.name]?.size ?? machine.size;
    for (let tx = Math.floor(e.position.x - w / 2 + 0.01); tx < e.position.x + w / 2 - 0.01; tx++) {
      for (let ty = Math.floor(e.position.y - h / 2 + 0.01); ty < e.position.y + h / 2 - 0.01; ty++) tiles.set(`${tx},${ty}`, entry);
    }
  }

  const bonuses = p.inserter_bonuses;
  for (const ins of inserters) {
    const proto = p.machines[ins.name]!;
    const reach = inserterReach(proto, ins.direction);
    if (!proto.rotation_speed || !reach) continue;
    const at = ([dx, dy]: [number, number]) => tiles.get(`${Math.floor(ins.x + dx)},${Math.floor(ins.y + dy)}`);
    // Chest-to-chest estimate: one full swing there and back per hand; belts make it slower.
    const hand = 1 + (proto.hand_bonus ?? 0) + (proto.bulk ? bonuses.bulk : bonuses.stack);
    const capacity = hand * proto.rotation_speed * 60;
    const from = at(reach.pickup), to = at(reach.drop);
    if (from && from !== to) { from.capOut += capacity; from.inserters.out++; }
    if (to && from !== to) { to.capIn += capacity; to.inserters.in++; }
  }
  const limitGroups = new Map<string, InserterLimit>();
  const addLimit = (m: Placed, side: "input" | "output", need: number, capacity: number, count: number) => {
    const key = `${m.name} ${m.recipe} ${side}`;
    const limit = limitGroups.get(key);
    if (limit) {
      limit.machines++;
      if (capacity < limit.capacityPerSecond) Object.assign(limit, { capacityPerSecond: capacity, inserters: count });
      limit.needPerSecond = Math.max(limit.needPerSecond, need);
    } else limitGroups.set(key, { machine: m.name, recipe: m.recipe, side, machines: 1, inserters: count, needPerSecond: need, capacityPerSecond: capacity });
  };
  for (const m of placed) {
    if (m.inserters.out && m.needOut > m.capOut + EPSILON) addLimit(m, "output", m.needOut, m.capOut, m.inserters.out);
    if (m.inserters.in && m.needIn > m.capIn + EPSILON) addLimit(m, "input", m.needIn, m.capIn, m.inserters.in);
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
  return { groups: [...groups.values()], inputs, outputs, ...(belt ? { belt } : {}), limits: [...limitGroups.values()], notes };
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
  if (t.limits.length) {
    const lines = t.limits.map((l) => {
      const needed = Math.ceil(l.needPerSecond / (l.capacityPerSecond / l.inserters));
      return `${l.machines}× ${l.machine} (${l.recipe}) ${l.side} needs ${round(l.needPerSecond)}/s but its ${plural(l.inserters, "inserter")} ${l.inserters === 1 ? "moves" : "move"} about ${round(l.capacityPerSecond)}/s (${needed} like ${l.inserters === 1 ? "it" : "them"} would keep up)`;
    });
    parts.push(`inserters too slow (estimated from swing time): ${lines.join("; ")}`);
  }
  if (t.notes.length) parts.push(`not counted: ${t.notes.join("; ")}`);
  return parts.join(" | ");
}
