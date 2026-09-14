// Compact text forms of the save's prototype data for the model. Every token here is prefill
// cost, so formats are terse and consistent: one line per recipe, technology or machine.
import type { Prototypes, Recipe, Technology } from "@companion/interfaces";

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function amount(p: { amount?: number; amount_min?: number; amount_max?: number; probability?: number }): string {
  const base = p.amount !== undefined ? num(p.amount) : `${num(p.amount_min ?? 0)}-${num(p.amount_max ?? 0)}`;
  return p.probability !== undefined && p.probability < 1 ? `${base}@${Math.round(p.probability * 100)}%` : base;
}

/** Which machines (and whether the player's character) can craft each recipe category. */
export function craftersByCategory(p: Prototypes): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const hasCharacter = Object.values(p.machines).some((m) => m.type === "character");
  for (const [name, m] of Object.entries(p.machines)) {
    for (const category of m.crafting_categories ?? []) out.set(category, [...(out.get(category) ?? []), m.type === "character" ? "by hand" : name]);
  }
  if (!hasCharacter) {
    // Older captures lack the character prototype; fall back to the naming convention.
    for (const category of new Set(Object.values(p.recipes).map((r) => r.category))) {
      if (category === "crafting" || category.endsWith("hand-crafting")) out.set(category, [...(out.get(category) ?? []), "by hand"]);
    }
  }
  return out;
}

export function recipeLine(name: string, r: Recipe, crafters?: Map<string, string[]>): string {
  const ins = r.ingredients.map((i) => `${amount(i)} ${i.name}`).join(", ") || "nothing";
  const outs = r.products.map((p) => `${amount(p)} ${p.name}`).join(", ") || "nothing";
  const bound = (op: string, v: number | undefined) => (v === undefined || Math.abs(v) > 1e300 ? "" : `${op}${num(v)}`); // engine uses ±DBL_MAX for "no limit"
  const where = r.surface_conditions?.length ? ` [${r.surface_conditions.map((c) => `${c.property}${bound(">=", c.min)}${bound("<=", c.max)}`).join(" ")}]` : "";
  const madeIn = crafters ? ` made in: ${(crafters.get(r.category) ?? []).join(", ") || "nothing in this save"}` : "";
  return `${name}: ${ins} -> ${outs} (${num(r.energy)}s ${r.category}${r.enabled ? "" : ", locked"})${where}${madeIn}`;
}

export function formatRecipes(p: Prototypes, filter: (name: string, r: Recipe) => boolean = () => true): string {
  return Object.entries(p.recipes).filter(([n, r]) => filter(n, r)).sort(([a], [b]) => a.localeCompare(b)).map(([n, r]) => recipeLine(n, r)).join("\n");
}

/** "craft 100 bioflux", "mine maraxsis-coral", or the science cost "1000x(automation-science-pack 1) 30s". */
export function techCost(t: Technology): string {
  if (t.trigger) {
    const trig = t.trigger as { type: string; item?: { name: string } | string; entity?: string; fluid?: string; count?: number; amount?: number };
    const target = typeof trig.item === "string" ? trig.item : trig.item?.name ?? trig.entity ?? trig.fluid ?? "";
    const qty = trig.count ?? trig.amount;
    // "craft-item" -> "craft", "mine-entity" -> "mine": reads as "craft 1 biochamber", not "craft item 1 biochamber".
    const verb = trig.type.replace(/-(item|entity|fluid)$/, "").replace(/-/g, " ");
    return `trigger: ${verb}${qty ? ` ${num(qty)}` : ""}${target ? ` ${target}` : ""}`;
  }
  return `${t.count_formula ?? num(t.count)}x(${t.ingredients.map((i) => `${i.name} ${num(i.amount)}`).join(", ")}) ${num(t.seconds_per_unit)}s`;
}

export function techLine(name: string, t: Technology): string {
  return `technology ${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"} | ${techCost(t)} | ${t.researched ? "researched" : "not researched"}`;
}

export function formatTechnologies(p: Prototypes): string {
  return Object.entries(p.technologies).sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => techLine(name, t)).join("\n");
}

export function formatMachines(p: Prototypes): string {
  return Object.entries(p.machines).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => {
    const parts = [`${m.type} ${m.size[0]}x${m.size[1]}`];
    if (m.crafting_speed !== undefined) parts.push(`speed ${num(m.crafting_speed)}`);
    if (m.mining_speed !== undefined) parts.push(`mining ${num(m.mining_speed)}`);
    if (m.belt_speed !== undefined) parts.push(`belt ${num(m.belt_speed * 60 * 8)}/s`);
    if (m.module_slots) parts.push(`modules ${m.module_slots}`);
    if (m.type === "character") return null;
    if (m.crafting_categories?.length) parts.push(`categories ${m.crafting_categories.join(", ")}`);
    return `${name}: ${parts.join(", ")}`;
  }).filter((line) => line !== null).join("\n");
}

export function formatItemTraits(p: Prototypes): string {
  return Object.entries(p.items).filter(([, i]) => i.spoil_ticks || i.fuel_value).sort(([a], [b]) => a.localeCompare(b)).map(([name, i]) => {
    const parts = [];
    if (i.spoil_ticks) parts.push(`spoils in ${num(i.spoil_ticks / 3600)} min${i.spoil_result ? ` -> ${i.spoil_result}` : ""}`);
    if (i.fuel_value) parts.push(`fuel ${num(i.fuel_value / 1e6)} MJ`);
    return `${name}: ${parts.join(", ")}`;
  }).join("\n");
}
