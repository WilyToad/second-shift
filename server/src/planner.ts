// Production ratios computed in code from the save's recipes and machine speeds (S09, use case #2).
// Assumes no modules, beacons or productivity bonuses; byproducts are ignored.
import type { Prototypes, Recipe } from "@companion/interfaces";
import { craftersByCategory } from "./grounding";

export type PlanStep = { item: string; recipe: string; machine: string; machineSpeed: number; unlocked: boolean; perMinute: number; machines: number; inputs: string[] };
export type Plan = { item: string; perMinute: number; steps: PlanStep[]; raw: Record<string, number>; notes: string[] };

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

function outputPerCraft(recipe: Recipe, item: string): number {
  return recipe.products.filter((p) => p.name === item).reduce((n, p) => {
    const amount = p.amount ?? ((p.amount_min ?? 0) + (p.amount_max ?? 0)) / 2;
    return n + amount * (p.probability ?? 1);
  }, 0);
}

export class Planner {
  private readonly producers = new Map<string, string[]>();
  private readonly crafters: Map<string, string[]>;
  private readonly raw: Set<string>;

  constructor(private readonly p: Prototypes) {
    this.crafters = craftersByCategory(p);
    this.raw = new Set(p.raw_resources);
    if (p.fluids.water) this.raw.add("water"); // offshore pumps; not always reported as a tile fluid
    for (const [name, r] of Object.entries(p.recipes)) {
      for (const out of r.products) this.producers.set(out.name, [...(this.producers.get(out.name) ?? []), name]);
    }
  }

  /** The recipe a player would normally use: craftable by a machine, not recycling, unlocked first, named like the item first. */
  recipeFor(item: string): string | null {
    if (this.raw.has(item)) return null; // gathered, not crafted
    const usable = (this.producers.get(item) ?? []).filter((name) => {
      const r = this.p.recipes[name]!;
      const machines = (this.crafters.get(r.category) ?? []).filter((c) => c !== "by hand");
      return machines.length > 0 && !r.category.startsWith("recycling") && outputPerCraft(r, item) > 0 && !r.ingredients.some((i) => i.name === item);
    });
    // Unlocked first, then the recipe named like the item; barrel emptying is a last resort.
    const score = (name: string) => (this.p.recipes[name]!.enabled ? 4 : 0) + (name === item ? 2 : 0) - (/^empty-.*-barrel$/.test(name) ? 8 : 0);
    return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  /** Fastest machine for a recipe category, preferring ones whose own recipe is unlocked. */
  machineFor(category: string): { name: string; speed: number; unlocked: boolean } | null {
    const options = (this.crafters.get(category) ?? []).filter((c) => c !== "by hand").map((name) => ({
      name, speed: this.p.machines[name]?.crafting_speed ?? 1, unlocked: this.p.recipes[name]?.enabled ?? true,
    }));
    const unlocked = options.filter((o) => o.unlocked);
    return (unlocked.length ? unlocked : options).sort((a, b) => b.speed - a.speed)[0] ?? null;
  }

  plan(item: string, perMinute: number, maxDepth = 8): Plan {
    const rates = new Map<string, number>(); // intermediate item -> total per minute
    const raw: Record<string, number> = {};
    const notes = new Set<string>(["no modules, beacons or productivity bonuses assumed; byproducts ignored"]);
    const order: string[] = [];
    const inputs = new Map<string, Set<string>>();

    const visit = (name: string, rate: number, depth: number, stack: string[]) => {
      const recipeName = depth <= maxDepth && !stack.includes(name) ? this.recipeFor(name) : null;
      if (!recipeName) {
        raw[name] = (raw[name] ?? 0) + rate;
        if (stack.includes(name)) notes.add(`cycle through ${name} cut; treated as an input`);
        return;
      }
      rates.set(name, (rates.get(name) ?? 0) + rate);
      if (!order.includes(name)) order.push(name);
      const recipe = this.p.recipes[recipeName]!;
      const craftsPerMinute = rate / outputPerCraft(recipe, name);
      for (const ing of recipe.ingredients) {
        // Catalysts (e.g. filters returned by the recipe) only cost what isn't given back.
        const net = ing.amount - outputPerCraft(recipe, ing.name);
        if (net > 0) {
          (inputs.get(name) ?? inputs.set(name, new Set()).get(name)!).add(ing.name);
          visit(ing.name, craftsPerMinute * net, depth + 1, [...stack, name]);
        }
      }
    };
    visit(item, perMinute, 0, []);

    const steps: PlanStep[] = order.map((name) => {
      const recipeName = this.recipeFor(name)!;
      const recipe = this.p.recipes[recipeName]!;
      const machine = this.machineFor(recipe.category)!;
      const rate = rates.get(name)!;
      const perMachine = (60 * machine.speed / recipe.energy) * outputPerCraft(recipe, name);
      if (!machine.unlocked) notes.add(`${machine.name} isn't unlocked yet`);
      if (!recipe.enabled) notes.add(`recipe ${recipeName} isn't unlocked yet`);
      return { item: name, recipe: recipeName, machine: machine.name, machineSpeed: machine.speed, unlocked: machine.unlocked && recipe.enabled, perMinute: round(rate), machines: round(rate / perMachine), inputs: [...(inputs.get(name) ?? [])] };
    });
    return { item, perMinute, steps, raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v)])), notes: [...notes] };
  }
}

export function formatPlan(plan: Plan): string {
  const steps = plan.steps.map((s) => `${s.item} ${s.perMinute}/min: ${s.machines}× ${s.machine}${s.recipe !== s.item ? ` (recipe ${s.recipe})` : ""}`).join("; ");
  const raw = Object.entries(plan.raw).map(([k, v]) => `${k} ${v}`).join(", ");
  return `plan for ${plan.perMinute}/min ${plan.item} (computed): ${steps} | raw inputs/min: ${raw || "none"} | ${plan.notes.join("; ")}`;
}
