// The packing list: turning "20 ovens, a couple hundred belt, arms to feed them" into items with counts, adding
// what the save's own data says the build also needs, and keeping the list in step with what the player carries.
//
// FC-167 is the part that stops the trek back: a stone furnace burns fuel, an electric one needs poles and a power
// source, an inserter needs power unless it's a burner. All of that comes from the save's prototypes, never from
// the model's memory of vanilla (the lesson of FC-160), and every addition says why it's there.
import type { Prototypes, Stock } from "@companion/interfaces";

export type Need = { item: string; count: number; text: string };
export type Addition = Need & { reason: string };

/** "20 stone furnace", "200 transport belt": what the tool writes on a list, back into an item and a count. */
export function parseNeed(text: string, p: Prototypes | null): Need | null {
  const m = /^\s*(?:x\s*)?(\d[\d,]*)?\s*(?:x\s+)?(.+?)\s*$/.exec(text);
  if (!m) return null;
  const count = m[1] ? Number(m[1].replace(/,/g, "")) : 1;
  const said = m[2]!.toLowerCase().trim();
  const item = resolveItem(said, p);
  return item ? { item, count, text } : null;
}

const key = (s: string) => s.toLowerCase().replace(/[_\s]+/g, "-").replace(/-+/g, "-").replace(/s$/, "");

/** An item name in this save from what the player or the model called it. */
export function resolveItem(said: string, p: Prototypes | null): string | null {
  if (!p) return null;
  const names = Object.keys(p.items);
  const wanted = key(said);
  return (
    names.find((n) => n === said) ??
    names.find((n) => key(n) === wanted) ??
    // "oven" for a furnace, "arms" for inserters: the plural and the odd word out.
    names.find((n) => key(n).endsWith(`-${wanted}`)) ??
    names.find((n) => key(n) === wanted.replace(/^(stone|iron|steel|electric|fast|express|turbo|bulk|long-handed)-/, "")) ??
    null
  );
}

/** Does this item place a machine that runs on fuel, on electricity, or on nothing? */
function power(item: string, p: Prototypes): "fuel" | "electric" | "none" {
  const placed = p.items[item]?.place_result;
  const machine = placed ? p.machines[placed] : undefined;
  if (!machine) return "none";
  if (machine.burner) return "fuel";
  const runs = machine.crafting_categories?.length || machine.type === "inserter" || machine.type === "mining-drill" || machine.type === "lab" || machine.type === "assembling-machine" || machine.type === "furnace";
  return runs ? "electric" : "none";
}

/**
 * The fuel to suggest: whatever the player already has, else the most energetic fuel they can simply gather
 * (coal on most saves), else the most energetic fuel in the save. Straight from `fuel_value` and the dump's list
 * of gathered resources, so a modded save picks its own.
 */
function fuelFor(p: Prototypes, stock?: Stock | null): string | null {
  const fuels = Object.entries(p.items).filter(([, i]) => (i.fuel_value ?? 0) > 0).map(([name, i]) => ({ name, value: i.fuel_value! }));
  if (!fuels.length) return null;
  const held = stock?.items.filter((s) => fuels.some((f) => f.name === s.name)).sort((a, b) => b.count - a.count)[0];
  if (held) return held.name;
  const raw = new Set(p.raw_resources);
  const gathered = fuels.filter((f) => raw.has(f.name)).sort((a, b) => b.value - a.value);
  return (gathered[0] ?? fuels.sort((a, b) => b.value - a.value)[0]!).name;
}

/**
 * The pole to suggest: one the player already has in reach, else the one covering the most ground (fewest to
 * carry). Picking the smallest supply area chose a big electric pole, which reaches far between poles but powers
 * almost nothing around it.
 */
function poleFor(p: Prototypes, stock?: Stock | null): { name: string; supply: number } | null {
  const poles = Object.entries(p.entities)
    .filter(([name, e]) => e.type === "electric-pole" && e.supply_area && p.recipes[name]?.enabled !== false)
    .map(([name, e]) => ({ name, supply: e.supply_area! }));
  if (!poles.length) return null;
  const held = stock?.items.filter((i) => poles.some((pole) => pole.name === i.name)).sort((a, b) => b.count - a.count)[0];
  const inStock = held && poles.find((pole) => pole.name === held.name);
  return inStock ?? poles.sort((a, b) => b.supply - a.supply)[0]!;
}

const stackOf = (item: string, p: Prototypes) => p.items[item]?.stack_size ?? 50;

/**
 * What the list is missing that the save's data proves it needs: fuel for burners, poles and a power source for
 * anything electric. Counts are deliberately generous and each one says where it came from.
 */
export function essentials(needs: Need[], p: Prototypes | null, stock?: Stock | null): Addition[] {
  if (!p || !needs.length) return [];
  const have = new Set(needs.map((n) => n.item));
  // Covered by kind, not just by name: any fuel counts as fuel, any pole as a pole. Without this, a second pass
  // whose stock-pick differs (a substation instead of a big pole) puts a second pole on the list.
  const hasFuel = needs.some((n) => (p.items[n.item]?.fuel_value ?? 0) > 0);
  const hasPole = needs.some((n) => p.entities[p.items[n.item]?.place_result ?? ""]?.type === "electric-pole");
  const out: Addition[] = [];
  const burners = needs.filter((n) => power(n.item, p) === "fuel");
  const electric = needs.filter((n) => power(n.item, p) === "electric");

  if (burners.length && !hasFuel) {
    const fuel = fuelFor(p, stock);
    if (fuel && !have.has(fuel)) {
      // A stack per burner, capped at two stacks: enough to start, and the player can ask for more.
      const stack = stackOf(fuel, p);
      const machines = burners.reduce((n, b) => n + b.count, 0);
      const count = Math.min(stack * 2, Math.max(stack, machines * 10));
      out.push({ item: fuel, count, text: `${count} ${fuel}`, reason: `${burners.map((b) => b.item).join(" and ")} burns fuel` });
    }
  }
  if (electric.length) {
    const pole = poleFor(p, stock);
    const machines = electric.reduce((n, e) => n + e.count, 0);
    if (pole && !hasPole && !have.has(pole.name)) {
      // One pole per four machines, rounded up, and never fewer than two: spares cost nothing to carry.
      const count = Math.max(2, Math.ceil(machines / 4));
      out.push({ item: pole.name, count, text: `${count} ${pole.name}`, reason: `${electric.map((e) => e.item).join(" and ")} needs power (${pole.name} reaches ${pole.supply} tiles)` });
    }
    out.push({ item: "", count: 0, text: "a power source for the outpost", reason: "the electric machines need power from somewhere; the save's data can't pick the generator" });
  }
  return out;
}

/** Lines for the turn: what the data says is missing, with the reason attached so the answer can say it. */
export function describeEssentials(additions: Addition[]): string[] {
  return additions.map((a) => `the save's data says the list also needs ${a.text} — ${a.reason}`);
}

export type ItemState = { need: Need; have: number; carried: number; missing: number; craftable: number; where?: string };

/** What the player has of each thing on the list, and what's still missing. Stock counts what they can reach. */
export function check(needs: Need[], stock: Stock | null, craftable: { name: string; count: number }[] = []): ItemState[] {
  return needs.map((need) => {
    const held = stock?.items.find((i) => i.name === need.item);
    const have = held?.count ?? 0;
    const carried = held?.carried ?? 0;
    return {
      need, have, carried,
      missing: Math.max(0, need.count - have),
      craftable: craftable.find((c) => c.name === need.item)?.count ?? 0,
      ...(held && held.carried < held.count && held.container ? { where: `nearest in a ${held.container} ${held.distance} tiles away` } : {}),
    };
  });
}

/** Slots the load needs against the slots the player has free: the check that stops two trips (FC-166). */
export function slots(needs: Need[], p: Prototypes | null, free: number): { needed: number; free: number; overBy: number } {
  const needed = p ? needs.reduce((n, x) => n + Math.ceil(x.count / stackOf(x.item, p)), 0) : 0;
  return { needed, free, overBy: Math.max(0, needed - free) };
}

/** The "am I ready?" answer, in lines the turn can hand to the model. */
export function readiness(states: ItemState[], slotCheck: { needed: number; free: number; overBy: number }): string[] {
  if (!states.length) return ["the packing list has nothing on it yet"];
  const ready = states.filter((s) => s.missing === 0);
  const short = states.filter((s) => s.missing > 0);
  const lines = [
    short.length
      ? `still missing: ${short.map((s) => `${s.missing} ${s.need.item} (${s.have} of ${s.need.count} in reach${s.craftable ? `, ${s.craftable} craftable by hand now` : ""}${s.where ? `, ${s.where}` : ""})`).join("; ")}`
      : "nothing missing: everything on the list is in reach",
  ];
  if (ready.length) lines.push(`ready: ${ready.map((s) => `${s.need.item} ${s.have}${s.carried < s.have ? ` (${s.carried} carried, the rest nearby)` : ""}`).join("; ")}`);
  lines.push(slotCheck.overBy > 0
    ? `the load needs about ${slotCheck.needed} inventory slots and the player has ${slotCheck.free} free: ${slotCheck.overBy} slots short, so something stays behind or it takes two trips`
    : `the load needs about ${slotCheck.needed} inventory slots and the player has ${slotCheck.free} free`);
  return lines;
}
