// What a blueprint makes and needs per minute, and how that compares with its belts (FC-097).
// Uses the save's recipes, machine speeds and productivity (built-in and researched). Modules, beacons and
// quality aren't counted; the notes say when a blueprint has any of them. Inserters are checked against the
// machines they serve, using swing time and researched hand size (FC-105).
//
// The numbers are approximate on purpose (FC-161, decided with the player): what matters is naming the real
// limit and being roughly right, so rates are given as a range with the cautious end first. Three effects that
// the swing-time estimate alone got badly wrong:
//   - A belt lane carries only `belt_speed × 240` items a second, so an inserter loading a slow belt is capped
//     by the lane, not by its own speed (a bulk inserter with a big hand on a yellow belt: ~7/s, not 30/s).
//   - Big hands are slower per item off a belt, because the arm waits for items to gather.
//   - A machine only accepts the ingredients for one craft plus what it can finish during one swing, so hand
//     sizes past that are wasted.
// The belt factors were fitted to the wiki's measured 2.0.26 tables (chest to belt, belt to chest) and checked
// against belt-fed rows measured in the dev game (`scripts/test-generated-builds.ts`, PLAN §5).
import type { Prototypes } from "@companion/interfaces";
import type { Blueprint } from "./blueprint";
import { outputPerCraft, productivityFor } from "./planner";

export type RecipeGroup = { recipe: string; machine: string; count: number; craftsPerMinute: number; productivity: number };
export type Flow = { name: string; perMinute: number; fluid: boolean; belts?: number };
export type InserterLimit = { machine: string; recipe: string; side: "input" | "output"; machines: number; inserters: number; needPerSecond: number; capacityPerSecond: number };
export type LaneLimit = { item: string; needPerMinute: number; lanePerMinute: number; belt: string };
export type Throughput = {
  groups: RecipeGroup[];
  inputs: Flow[]; // needed from outside, net of what the blueprint makes itself
  outputs: Flow[]; // left over for outside
  belt?: { name: string; perMinute: number; lanePerMinute: number }; // the fastest belt in the blueprint
  limits: InserterLimit[]; // machines whose inserters can't keep up
  lanes: LaneLimit[]; // items needing more than one lane of the blueprint's own belt carries
  // What the blueprint really makes once its inserters and belts are counted, and what holds it back.
  effective: { outputs: Flow[]; share: number; reasons: string[] };
  notes: string[];
};

const EPSILON = 1e-6;
/** One belt lane: 4 items a tile, `belt_speed` tiles a tick, 60 ticks a second. */
const lanePerSecond = (beltSpeed: number) => beltSpeed * 240;
/**
 * How a belt end changes an inserter's rate, as a share of its swing-time rate, by hand size. A hand of one or two
 * is barely affected; a big hand is much slower per item, because the arm waits for items to gather. Fitted to the
 * wiki's measured 2.0.26 tables and to a belt-fed row measured in the dev game (a plain inserter, hand of 3,
 * 0.84 cycles a second, taking from the row's own belt: 2.38/s measured, 2.39/s from this table).
 * A big hand taking from a fast belt is the weakest point: the wiki's numbers come from a perpendicular belt with
 * one lane, which measures lower than an in-line belt, so treat those cases as roughly right, not exact.
 */
const PICKUP_SHARE: [number, number][] = [[1, 1.0], [2, 0.98], [3, 0.95], [4, 0.8], [6, 0.7], [8, 0.6], [12, 0.5], [16, 0.45]];
const DROP_SHARE: [number, number][] = [[1, 0.99], [2, 0.96], [3, 0.95], [4, 0.85], [6, 0.7], [8, 0.6], [12, 0.5], [16, 0.45]];
/** Loading a belt needs gaps in it, so an inserter never gets a whole lane. */
const LOAD_LANE_SHARE = 0.85;

function beltShare(table: [number, number][], hand: number): number {
  if (hand <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [h, share] = table[i]!;
    const [prevH, prevShare] = table[i - 1]!;
    if (hand <= h) return prevShare + ((share - prevShare) * (hand - prevH)) / (h - prevH);
  }
  return table.at(-1)![1];
}

/**
 * How many items a second an inserter moves, given what it takes from and what it drops into.
 * `fromLane` / `toLane` are the lane capacity when that end is a belt.
 */
export function inserterCapacity(hand: number, cyclesPerSecond: number, ends: { fromLane?: number; toLane?: number }): number {
  const swing = hand * cyclesPerSecond;
  let capacity = swing;
  if (ends.fromLane !== undefined) capacity = Math.min(swing * beltShare(PICKUP_SHARE, hand), ends.fromLane);
  if (ends.toLane !== undefined) capacity = Math.min(swing * beltShare(DROP_SHARE, hand), ends.toLane * LOAD_LANE_SHARE, capacity);
  return capacity;
}

/**
 * The ingredients a machine will hold: one craft plus what it can finish during one standard swing (1.166 s),
 * at least 2 crafts, at most 100 (Factorio's insertion rule). Hand sizes past this are wasted swings.
 */
export function insertionLimitCrafts(craftsPerSecond: number): number {
  return Math.min(100, Math.max(2, 1 + Math.ceil(1.166 * craftsPerSecond)));
}
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
  type Flowing = { name: string; perMinute: number };
  type Placed = {
    name: string; recipe: string; needIn: number; needOut: number; capIn: number; capOut: number;
    inserters: { in: number; out: number };
    // The most ingredients of one kind the machine will hold, so a bigger hand is wasted (insertion rule).
    handCap: number;
    products: Flowing[]; ingredients: Flowing[];
  };
  const placed: Placed[] = [];
  const tiles = new Map<string, Placed>();
  // Belt, underground belt and splitter tiles, by lane capacity: an inserter's end on one of these is capped by it.
  const beltTiles = new Map<string, number>();
  const inserters: { x: number; y: number; direction: number; name: string }[] = [];
  const BELT_TYPES = new Set(["transport-belt", "underground-belt", "splitter", "lane-splitter", "loader", "loader-1x1"]);

  for (const e of bp.entities) {
    const machine = p.machines[e.name];
    if (!machine) continue;
    if (machine.belt_speed && BELT_TYPES.has(machine.type)) {
      const lane = lanePerSecond(machine.belt_speed);
      // Both lanes, per minute, for the "fits on one belt" note; the lane is what one inserter can use.
      const perMinute = lane * 2 * 60;
      if (!belt || perMinute > belt.perMinute) belt = { name: e.name, perMinute, lanePerMinute: lane * 60 };
      const [bw, bh] = p.entities[e.name]?.size ?? machine.size;
      for (let tx = Math.floor(e.position.x - bw / 2 + 0.01); tx < e.position.x + bw / 2 - 0.01; tx++) {
        for (let ty = Math.floor(e.position.y - bh / 2 + 0.01); ty < e.position.y + bh / 2 - 0.01; ty++) beltTiles.set(`${tx},${ty}`, lane);
      }
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
    const itemProducts = [...new Set(recipe.products.filter((x) => x.type === "item").map((x) => x.name))];
    const products = machine.type === "rocket-silo" ? [] : itemProducts.map((name) => ({ name, perMinute: outputPerCraft(recipe, name, productivity) * craftsPerMinute }));
    const ingredients = recipe.ingredients.filter((i) => i.type !== "fluid").map((i) => ({ name: i.name, perMinute: i.amount * craftsPerMinute }));
    const needOut = products.reduce((n, x) => n + x.perMinute / 60, 0);
    const needIn = ingredients.reduce((n, x) => n + x.perMinute / 60, 0);
    const crafts = insertionLimitCrafts(perSecond);
    const handCap = crafts * Math.max(1, ...recipe.ingredients.filter((i) => i.type !== "fluid").map((i) => i.amount));
    const entry: Placed = { name: e.name, recipe: e.recipe, needIn, needOut, capIn: 0, capOut: 0, inserters: { in: 0, out: 0 }, handCap, products, ingredients };
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
    const key = ([dx, dy]: [number, number]) => `${Math.floor(ins.x + dx)},${Math.floor(ins.y + dy)}`;
    const hand = 1 + (proto.hand_bonus ?? 0) + (proto.bulk ? bonuses.bulk : bonuses.stack);
    const from = tiles.get(key(reach.pickup)), to = tiles.get(key(reach.drop));
    const fromLane = beltTiles.get(key(reach.pickup)), toLane = beltTiles.get(key(reach.drop));
    if (from === to && from) continue; // both ends in the same machine: it does nothing
    // A machine only holds so many ingredients, so a bigger hand doesn't help when loading one.
    const effectiveHand = to ? Math.min(hand, to.handCap) : hand;
    const capacity = inserterCapacity(effectiveHand, proto.rotation_speed * 60, { fromLane, toLane });
    if (from) { from.capOut += capacity; from.inserters.out++; }
    if (to) { to.capIn += capacity; to.inserters.in++; }
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
  // A build with inserters but none on a machine's side can't move items there at all (FC-161): a missing
  // inserter is a common blueprint mistake, and it stops the machine dead.
  const wired = inserters.length > 0;
  const missing = new Map<string, { machine: string; recipe: string; side: "input" | "output"; machines: number }>();
  for (const m of placed) {
    if (m.inserters.out && m.needOut > m.capOut + EPSILON) addLimit(m, "output", m.needOut, m.capOut, m.inserters.out);
    if (m.inserters.in && m.needIn > m.capIn + EPSILON) addLimit(m, "input", m.needIn, m.capIn, m.inserters.in);
    for (const side of ["input", "output"] as const) {
      const need = side === "input" ? m.needIn : m.needOut;
      const count = side === "input" ? m.inserters.in : m.inserters.out;
      if (!wired || count > 0 || need <= EPSILON) continue;
      const key = `${m.name} ${m.recipe} ${side}`;
      const seen = missing.get(key);
      if (seen) seen.machines++;
      else missing.set(key, { machine: m.name, recipe: m.recipe, side, machines: 1 });
    }
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

  // Each item rides one lane of the blueprint's own belt, so a lane is the limit, not the whole belt (FC-161).
  const lanes: LaneLimit[] = belt && beltTiles.size
    ? [...inputs, ...outputs].filter((f) => !f.fluid && f.perMinute > belt!.lanePerMinute + EPSILON)
        .map((f) => ({ item: f.name, needPerMinute: f.perMinute, lanePerMinute: belt!.lanePerMinute, belt: belt!.name }))
    : [];
  const laneShare = lanes.length ? Math.min(...lanes.map((l) => l.lanePerMinute / l.needPerMinute)) : 1;

  // What it really makes: every machine held to its slowest side, and the whole row to its tightest belt lane.
  const effectiveOutputs = new Map<string, number>();
  const reasons = new Set<string>();
  let share = 1;
  for (const m of placed) {
    const ratios = [1];
    if (m.inserters.in && m.needIn > EPSILON) ratios.push(m.capIn / m.needIn);
    if (m.inserters.out && m.needOut > EPSILON) ratios.push(m.capOut / m.needOut);
    if (wired && m.needIn > EPSILON && !m.inserters.in) ratios.push(0);
    if (wired && m.needOut > EPSILON && !m.inserters.out) ratios.push(0);
    const ratio = Math.min(...ratios, laneShare);
    if (ratio < 0.98) {
      share = Math.min(share, ratio);
      if (wired && m.needOut > EPSILON && !m.inserters.out) reasons.add(`nothing taking the output of ${m.name} (${m.recipe})`);
      else if (wired && m.needIn > EPSILON && !m.inserters.in) reasons.add(`nothing loading ${m.name} (${m.recipe})`);
      else if (m.inserters.in && m.capIn / m.needIn === ratio) reasons.add(`the inserters loading ${m.name} (${m.recipe})`);
      else if (m.inserters.out && m.capOut / m.needOut === ratio) reasons.add(`the inserters unloading ${m.name} (${m.recipe})`);
    }
    for (const x of m.products) effectiveOutputs.set(x.name, (effectiveOutputs.get(x.name) ?? 0) + x.perMinute * ratio);
    for (const x of m.ingredients) {
      // Ingredients made inside the blueprint are consumed at the same held-back rate.
      if (!effectiveOutputs.has(x.name) && !made.has(x.name)) continue;
    }
  }
  for (const l of lanes) reasons.add(`one ${l.belt} lane for ${l.item} (${round(l.lanePerMinute)}/min)`);
  const effective = {
    outputs: outputs.map((f) => {
      const net = (effectiveOutputs.get(f.name) ?? f.perMinute) - (used.get(f.name) ?? 0) * Math.min(1, share);
      return flow(f.name, Math.max(0, Math.min(f.perMinute, net)));
    }),
    share,
    reasons: [...reasons],
  };

  const notes: string[] = [];
  if (rocketParts) notes.push(`rocket silos build ${round(rocketParts)} rocket parts per minute (used inside the silo)`);
  if (withModules || beacons) notes.push(`modules and beacons not counted (${withModules} machines with modules, ${beacons} beacons)`);
  if (quality) notes.push(`${quality} machines of higher quality counted at normal speed`);
  if (furnacesWithoutRecipe) notes.push(`${furnacesWithoutRecipe} furnaces pick their recipe from their input, not counted`);
  if (drills) notes.push(`${drills} mining drills not counted (output depends on the resource)`);
  for (const m of missing.values()) notes.push(`${m.machines}× ${m.machine} (${m.recipe}) has no inserter on its ${m.side} side, so nothing moves items there`);
  return { groups: [...groups.values()], inputs, outputs, ...(belt ? { belt } : {}), limits: [...limitGroups.values()], lanes, effective, notes };
}

/** One compact line for the model: what it makes (a cautious range), what limits it, belt load, and what wasn't counted. */
export function describeThroughput(t: Throughput, maxFlows = 8): string {
  if (!t.groups.length) return t.notes.length ? `throughput: nothing countable (${t.notes.join("; ")})` : "";
  const flows = (list: Flow[]) =>
    list.slice(0, maxFlows).map((f) => `${f.name} ${round(f.perMinute)}${f.fluid ? " (fluid)" : ""}${f.belts !== undefined ? ` (${percent(f.belts)} of one ${t.belt!.name})` : ""}`).join(", ") || "none";
  // Rates are approximate, so they're given as a range with the cautious end first (FC-161).
  const ranged = (list: Flow[]) => {
    const low = new Map(t.effective.outputs.map((f) => [f.name, f.perMinute]));
    return list.slice(0, maxFlows).map((f) => {
      const l = low.get(f.name);
      const range = l !== undefined && l < f.perMinute * 0.98 ? `about ${round(l)}–${round(f.perMinute)}` : `about ${round(f.perMinute)}`;
      return `${f.name} ${range}${f.fluid ? " (fluid)" : ""}${f.belts !== undefined ? ` (${percent(f.belts)} of one ${t.belt!.name})` : ""}`;
    }).join(", ") || "none";
  };
  const parts = [`throughput per minute, approximate, no modules or beacons: needs ${flows(t.inputs)} | makes ${ranged(t.outputs)}`];
  if (t.effective.share < 0.98 && t.effective.reasons.length) {
    parts.push(`held back to about ${percent(t.effective.share)} of the machines' own speed by ${t.effective.reasons.join(" and ")}`);
  }
  if (t.belt) {
    const overloaded = [...t.inputs, ...t.outputs].filter((f) => (f.belts ?? 0) > 1);
    parts.push(overloaded.length ? `more than one full ${t.belt.name}: ${overloaded.map((f) => f.name).join(", ")}` : `every item fits on one ${t.belt.name} (${round(t.belt.perMinute)}/min)`);
  }
  if (t.lanes.length) {
    // Each item rides one lane, and one lane is half a belt.
    parts.push(`more than one lane carries: ${t.lanes.map((l) => `${l.item} needs ${round(l.needPerMinute)}/min, a ${l.belt} lane carries ${round(l.lanePerMinute)}/min`).join("; ")}`);
  }
  if (t.limits.length) {
    const lines = t.limits.map((l) => {
      const needed = Math.ceil(l.needPerSecond / (l.capacityPerSecond / l.inserters));
      return `${l.machines}× ${l.machine} (${l.recipe}) ${l.side} needs ${round(l.needPerSecond)}/s but its ${plural(l.inserters, "inserter")} ${l.inserters === 1 ? "moves" : "move"} about ${round(l.capacityPerSecond)}/s (${needed} like ${l.inserters === 1 ? "it" : "them"} would keep up)`;
    });
    parts.push(`inserters too slow (estimated from swing time, belt lanes and what a machine will hold): ${lines.join("; ")}`);
  }
  if (t.notes.length) parts.push(`not counted: ${t.notes.join("; ")}`);
  return parts.join(" | ");
}
