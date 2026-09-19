// Compact text forms of the save's prototype data for the model. Every token here is prefill
// cost, so formats are terse and consistent: one line per recipe, technology or machine.
import type { Machine, Prototypes, Recipe, Technology } from "@companion/interfaces";

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
  const condition = (c: { property: string; min?: number; max?: number }) =>
    c.min !== undefined && c.min === c.max ? `${c.property}=${num(c.min)}` : `${c.property}${bound(">=", c.min)}${bound("<=", c.max)}`;
  const where = r.surface_conditions?.length ? ` [${r.surface_conditions.map(condition).join(" ")}]` : "";
  // With crafters listed the category name is redundant (and it misled the model), so it's dropped.
  const madeIn = crafters ? ` made in: ${(crafters.get(r.category) ?? []).join(", ") || "nothing in this save"}` : "";
  const category = crafters ? "" : ` ${r.category}`;
  return `${name}: ${ins} -> ${outs} (${num(r.energy)}s${category}${r.enabled ? "" : ", locked"})${where}${madeIn}`;
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

export function machineLine(name: string, m: Machine): string | null {
  {
    const parts = [`${m.type} ${m.size[0]}x${m.size[1]}`];
    if (m.crafting_speed !== undefined) parts.push(`speed ${num(m.crafting_speed)}`);
    if (m.mining_speed !== undefined) parts.push(`mining ${num(m.mining_speed)}`);
    if (m.belt_speed !== undefined) parts.push(`belt ${num(m.belt_speed * 60 * 8)}/s`);
    if (m.module_slots) parts.push(`modules ${m.module_slots}`);
    if (m.type === "character") return null;
    if (m.crafting_categories?.length) parts.push(`categories ${m.crafting_categories.join(", ")}`);
    return `machine ${name}: ${parts.join(", ")}`;
  }
}

/**
 * The facts about one entity that come from this save, for "what is this?" (FC-160): what it is, how much it
 * holds, which logistic job it does, how fast it runs. Everything else about how it behaves is the model's memory,
 * which a modded save can contradict, so the turn asks it to say only what's here.
 */
export function entityFacts(name: string, p: Prototypes): string | null {
  const e = p.entities[name];
  const m = p.machines[name];
  if (!e && !m) return null;
  const parts: string[] = [];
  const type = e?.type ?? m?.type;
  if (type) parts.push(type.replace(/-/g, " "));
  if (e?.logistic_mode) parts.push(`logistic job: ${e.logistic_mode.replace(/-/g, " ")}`);
  if (e?.inventory_size) parts.push(`holds ${e.inventory_size} stacks`);
  if (e?.fluid_capacity) parts.push(`holds ${e.fluid_capacity.toLocaleString("en-US")} fluid`);
  if (e?.supply_area) parts.push(`powers machines within ${num(e.supply_area)} tiles`);
  if (e?.wire_reach) parts.push(`reaches other poles ${num(e.wire_reach)} tiles away`);
  if (m?.crafting_speed !== undefined) parts.push(`crafting speed ${num(m.crafting_speed)}`);
  if (m?.mining_speed !== undefined) parts.push(`mining speed ${num(m.mining_speed)}`);
  if (m?.belt_speed !== undefined) parts.push(`carries ${num(m.belt_speed * 480)} items/s (${num(m.belt_speed * 240)} a lane)`);
  if (m?.module_slots) parts.push(`${m.module_slots} module slots`);
  if (m?.crafting_categories?.length) parts.push(`crafts ${m.crafting_categories.join(", ")}`);
  const recipe = p.recipes[name];
  if (recipe) parts.push(`built from ${recipe.ingredients.map((i) => `${i.amount} ${i.name}`).join(" + ")}`);
  return parts.length ? `${name}: ${parts.join("; ")}` : null;
}

/**
 * Phrases to bias the recognizer toward (FC-177): the names of things in this save, as a person says them, most
 * talked-about first. Chrome takes a modest list, so the order matters more than the length.
 *
 * "Most talked-about" is measured, not guessed: how often a thing is an ingredient of a recipe or a technology the
 * save has enabled, with a bonus for anything the player places. That puts iron gear wheel, stone furnace and the
 * science packs near the top on any save, and leaves "space factory 3 instantiated" at the bottom — where taking
 * the dump's own order had put chests and ducts ahead of the things a player says out loud.
 */
export function recognitionPhrases(p: Prototypes, max = 100): string[] {
  const said = (name: string) => name.replace(/-/g, " ");
  const score = new Map<string, number>();
  const bump = (name: string, by: number) => score.set(name, (score.get(name) ?? 0) + by);
  for (const [name, item] of Object.entries(p.items)) {
    if (!item.place_result) continue;
    bump(name, 5); // things the player builds get named far more often than things they only craft
    if (p.machines[item.place_result]) bump(name, 3);
  }
  for (const recipe of Object.values(p.recipes)) {
    if (recipe.enabled === false) continue;
    for (const ing of recipe.ingredients) if (p.items[ing.name]) bump(ing.name, 1);
  }
  for (const tech of Object.values(p.technologies)) {
    for (const ing of tech.ingredients ?? []) if (p.items[ing.name]) bump(ing.name, 1);
  }
  for (const name of Object.keys(p.fluids)) bump(name, 2);
  // Words the player says that no prototype name supplies.
  const extras = ["ballast", "wire", "ore patch", "biter nest", "outpost", "smelter", "ghosts", "spidertron", "packing list"];
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => said(name));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phrase of [...extras, ...ranked]) {
    const key = phrase.toLowerCase();
    // Internal variants ("factory 2 instantiated") are never spoken and would spend the list.
    if (key.length < 3 || key.endsWith(" instantiated") || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= max) break;
  }
  return out;
}

export function formatMachines(p: Prototypes): string {
  return Object.entries(p.machines).sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => machineLine(name, m)).filter((line) => line !== null).join("\n");
}

export function formatItemTraits(p: Prototypes): string {
  return Object.entries(p.items).filter(([, i]) => i.spoil_ticks || i.fuel_value).sort(([a], [b]) => a.localeCompare(b)).map(([name, i]) => {
    const parts = [];
    if (i.spoil_ticks) parts.push(`spoils in ${num(i.spoil_ticks / 3600)} min${i.spoil_result ? ` -> ${i.spoil_result}` : ""}`);
    if (i.fuel_value) parts.push(`fuel ${num(i.fuel_value / 1e6)} MJ`);
    return `${name}: ${parts.join(", ")}`;
  }).join("\n");
}
