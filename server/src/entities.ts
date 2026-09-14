// Turns what the player says ("rails", "inserters", "biochambers") into a find_entities filter.
import type { Prototypes } from "@companion/interfaces";
import { normalize, RecipeRetriever } from "./retrieval";

export type EntityFilter = { label: string; types?: string[]; names?: string[] };

const RAILS = ["straight-rail", "curved-rail-a", "curved-rail-b", "half-diagonal-rail", "legacy-straight-rail", "legacy-curved-rail", "elevated-straight-rail", "elevated-curved-rail-a", "elevated-curved-rail-b", "elevated-half-diagonal-rail", "rail-ramp"];

/** Player words for groups of entity types. Keys are normalized, singular. */
const GROUPS: Record<string, string[]> = {
  rail: RAILS, track: RAILS, "train track": RAILS, "rail track": RAILS,
  "rail signal": ["rail-signal", "rail-chain-signal"], signal: ["rail-signal", "rail-chain-signal"],
  belt: ["transport-belt", "underground-belt", "splitter", "linked-belt", "loader", "loader-1x1", "lane-splitter"],
  "conveyor belt": ["transport-belt", "underground-belt", "splitter"],
  inserter: ["inserter"], "power pole": ["electric-pole"], pole: ["electric-pole"],
  assembler: ["assembling-machine"], "assembling machine": ["assembling-machine"], furnace: ["furnace"],
  drill: ["mining-drill"], "mining drill": ["mining-drill"], tree: ["tree"], rock: ["simple-entity"],
  chest: ["container", "logistic-container"], pipe: ["pipe", "pipe-to-ground"], pump: ["pump", "offshore-pump"],
  turret: ["ammo-turret", "electric-turret", "fluid-turret", "artillery-turret"], wall: ["wall"], gate: ["gate"],
  "solar panel": ["solar-panel"], accumulator: ["accumulator"], radar: ["radar"], roboport: ["roboport"],
  lamp: ["lamp"], beacon: ["beacon"], lab: ["lab"], combinator: ["arithmetic-combinator", "decider-combinator", "constant-combinator", "selector-combinator"],
  "train stop": ["train-stop"], station: ["train-stop"], locomotive: ["locomotive"], wagon: ["cargo-wagon", "fluid-wagon"],
};

const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function resolveEntityFilter(what: string, prototypes: Prototypes | null): EntityFilter | null {
  const words = normalize(what).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const key = [...words.slice(0, -1), singular(words.at(-1)!)].join(" ");
  if (GROUPS[key]) return { label: what, types: GROUPS[key] };
  if (!prototypes) return null;
  // Otherwise a specific thing: an entity name (machines) or an item that places one.
  const names = new Set<string>();
  for (const e of new RecipeRetriever(prototypes).match(what)) {
    if (prototypes.machines[e.name]) names.add(e.name);
    const placed = prototypes.items[e.name]?.place_result;
    if (placed) names.add(placed);
  }
  return names.size ? { label: what, names: [...names] } : null;
}
