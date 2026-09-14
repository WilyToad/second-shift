// Compact text forms of the save's prototype data for the model. Every token here is prefill
// cost, so formats are terse and consistent: one line per recipe, technology or machine.
import type { Prototypes, Recipe } from "@companion/interfaces";

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function amount(p: { amount?: number; amount_min?: number; amount_max?: number; probability?: number }): string {
  const base = p.amount !== undefined ? num(p.amount) : `${num(p.amount_min ?? 0)}-${num(p.amount_max ?? 0)}`;
  return p.probability !== undefined && p.probability < 1 ? `${base}@${Math.round(p.probability * 100)}%` : base;
}

export function recipeLine(name: string, r: Recipe): string {
  const ins = r.ingredients.map((i) => `${amount(i)} ${i.name}`).join(", ") || "nothing";
  const outs = r.products.map((p) => `${amount(p)} ${p.name}`).join(", ") || "nothing";
  const where = r.surface_conditions?.length ? ` [${r.surface_conditions.map((c) => `${c.property}${c.min !== undefined ? `>=${num(c.min)}` : ""}${c.max !== undefined ? `<=${num(c.max)}` : ""}`).join(" ")}]` : "";
  return `${name}: ${ins} -> ${outs} (${num(r.energy)}s ${r.category}${r.enabled ? "" : ", locked"})${where}`;
}

export function formatRecipes(p: Prototypes, filter: (name: string, r: Recipe) => boolean = () => true): string {
  return Object.entries(p.recipes).filter(([n, r]) => filter(n, r)).sort(([a], [b]) => a.localeCompare(b)).map(([n, r]) => recipeLine(n, r)).join("\n");
}

export function formatTechnologies(p: Prototypes): string {
  return Object.entries(p.technologies).sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => {
    const cost = t.trigger ? `trigger ${t.trigger.type}` : `${t.count_formula ?? num(t.count)}x(${t.ingredients.map((i) => `${i.name} ${num(i.amount)}`).join(", ")}) ${num(t.seconds_per_unit)}s`;
    return `${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"} | ${cost}${t.researched ? " | researched" : ""}`;
  }).join("\n");
}

export function formatMachines(p: Prototypes): string {
  return Object.entries(p.machines).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => {
    const parts = [`${m.type} ${m.size[0]}x${m.size[1]}`];
    if (m.crafting_speed !== undefined) parts.push(`speed ${num(m.crafting_speed)}`);
    if (m.mining_speed !== undefined) parts.push(`mining ${num(m.mining_speed)}`);
    if (m.belt_speed !== undefined) parts.push(`belt ${num(m.belt_speed * 60 * 8)}/s`);
    if (m.module_slots) parts.push(`modules ${m.module_slots}`);
    if (m.crafting_categories?.length) parts.push(`categories ${m.crafting_categories.join(", ")}`);
    return `${name}: ${parts.join(", ")}`;
  }).join("\n");
}

export function formatItemTraits(p: Prototypes): string {
  return Object.entries(p.items).filter(([, i]) => i.spoil_ticks || i.fuel_value).sort(([a], [b]) => a.localeCompare(b)).map(([name, i]) => {
    const parts = [];
    if (i.spoil_ticks) parts.push(`spoils in ${num(i.spoil_ticks / 3600)} min${i.spoil_result ? ` -> ${i.spoil_result}` : ""}`);
    if (i.fuel_value) parts.push(`fuel ${num(i.fuel_value / 1e6)} MJ`);
    return `${name}: ${parts.join(", ")}`;
  }).join("\n");
}
