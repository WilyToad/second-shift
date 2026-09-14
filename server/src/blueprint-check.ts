// Checks a blueprint against this save's prototypes and summarizes it (FC-031).
import type { Prototypes } from "@companion/interfaces";
import type { Blueprint, BlueprintEntity } from "./blueprint";

export type BlueprintIssue =
  | { kind: "unknown_entity"; entity: string; count: number }
  | { kind: "overlap"; a: string; b: string; at: { x: number; y: number } }
  | { kind: "unknown_recipe"; machine: string; recipe: string }
  | { kind: "recipe_not_craftable"; machine: string; recipe: string; category: string };

export type BlueprintReport = {
  entities: number;
  counts: Record<string, number>;
  recipes: Record<string, number>; // "machine: recipe" -> count
  size: { width: number; height: number };
  issues: BlueprintIssue[];
  skippedOverlap: number; // rails and signals use their own collision layers and diagonal directions
};

const SKIP_OVERLAP = /rail|signal|train-stop|locomotive|wagon/;
const EPS = 0.01;

/** Tiles covered by an entity's collision box, rotated for cardinal directions (2.0: 0 N, 4 E, 8 S, 12 W). */
function tiles(e: BlueprintEntity, box: [number, number, number, number]): string[] | null {
  const dir = e.direction ?? 0;
  if (dir % 4 !== 0) return null; // diagonal: only rails use these
  let [l, t, r, b] = box;
  if (dir === 4 || dir === 12) [l, t, r, b] = [-b, l, -t, r];
  const out: string[] = [];
  for (let x = Math.floor(e.position.x + l + EPS); x <= Math.floor(e.position.x + r - EPS); x++) {
    for (let y = Math.floor(e.position.y + t + EPS); y <= Math.floor(e.position.y + b - EPS); y++) out.push(`${x},${y}`);
  }
  return out;
}

export function checkBlueprint(bp: Blueprint, p: Prototypes, maxIssues = 20): BlueprintReport {
  const counts: Record<string, number> = {};
  const recipes: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  const issues: BlueprintIssue[] = [];
  const occupied = new Map<string, string>();
  let skippedOverlap = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const e of bp.entities) {
    counts[e.name] = (counts[e.name] ?? 0) + 1;
    const footprint = p.entities[e.name];
    if (!footprint) {
      unknown[e.name] = (unknown[e.name] ?? 0) + 1;
      continue;
    }
    const [w, h] = footprint.size;
    minX = Math.min(minX, e.position.x - w / 2); maxX = Math.max(maxX, e.position.x + w / 2);
    minY = Math.min(minY, e.position.y - h / 2); maxY = Math.max(maxY, e.position.y + h / 2);

    if (e.recipe) {
      recipes[`${e.name}: ${e.recipe}`] = (recipes[`${e.name}: ${e.recipe}`] ?? 0) + 1;
      const recipe = p.recipes[e.recipe];
      const categories = p.machines[e.name]?.crafting_categories ?? [];
      if (!recipe) issues.push({ kind: "unknown_recipe", machine: e.name, recipe: e.recipe });
      else if (!categories.includes(recipe.category)) issues.push({ kind: "recipe_not_craftable", machine: e.name, recipe: e.recipe, category: recipe.category });
    }

    if (SKIP_OVERLAP.test(footprint.type)) { skippedOverlap++; continue; }
    const covered = tiles(e, footprint.collision);
    if (!covered) { skippedOverlap++; continue; }
    for (const tile of covered) {
      const other = occupied.get(tile);
      if (other && issues.filter((i) => i.kind === "overlap").length < maxIssues) {
        const [x, y] = tile.split(",").map(Number);
        issues.push({ kind: "overlap", a: other, b: `${e.name}#${e.entity_number}`, at: { x: x!, y: y! } });
        break;
      }
      occupied.set(tile, `${e.name}#${e.entity_number}`);
    }
  }
  for (const [entity, count] of Object.entries(unknown)) issues.unshift({ kind: "unknown_entity", entity, count });
  return {
    entities: bp.entities.length,
    counts,
    recipes,
    size: Number.isFinite(minX) ? { width: Math.round(maxX - minX), height: Math.round(maxY - minY) } : { width: 0, height: 0 },
    issues: issues.slice(0, maxIssues),
    skippedOverlap,
  };
}

export function describeIssue(i: BlueprintIssue): string {
  switch (i.kind) {
    case "unknown_entity": return `${i.count}× ${i.entity} doesn't exist in this save`;
    case "overlap": return `${i.a} and ${i.b} overlap at tile (${i.at.x}, ${i.at.y})`;
    case "unknown_recipe": return `${i.machine} is set to recipe ${i.recipe}, which doesn't exist in this save`;
    case "recipe_not_craftable": return `${i.machine} can't craft ${i.recipe} (category ${i.category})`;
  }
}
