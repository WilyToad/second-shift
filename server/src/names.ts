// Names an answer used that this save doesn't have (FC-171).
//
// From the player's early-game session: one answer in 22 said walls and turrets need "the defensive-structures
// research". This save has no such technology — it has `stone-wall`, `gun-turret`, `laser-turret` — and the turn
// had no retrieved lines, so nothing grounded the name. The same shape as the invented-count check (FC-140): say
// the correction out loud rather than letting a confident wrong name stand.
//
// Deliberately narrow. It only looks at hyphenated names, which is how this save spells its prototypes, and it
// stays quiet on anything it isn't sure about: ordinary hyphenated English, a name the dump does contain in any
// form, and a plural of one.
import type { Prototypes } from "@companion/interfaces";

/** Hyphenated English that will never be a prototype name. A false correction is worse than a missed one. */
export const ENGLISH = new Set([
  "hand-carrying", "hand-crafting", "hand-craft", "hand-crafted", "hand-feeding", "hand-fed", "dead-end", "dead-ends",
  "on-device", "read-only", "long-term", "short-term", "double-check", "well-known", "up-to-date", "so-called",
  "left-hand", "right-hand", "one-off", "half-empty", "half-full", "high-level", "low-level", "north-east",
  "north-west", "south-east", "south-west", "per-minute", "end-to-end", "side-by-side", "full-heavy-oil-tank",
  "e-g", "i-e", "co-located", "re-run", "set-up", "follow-up", "trade-off", "work-in-progress",
  "hand-mine", "hand-mined", "hand-mining", "hand-place", "hand-placed", "hand-built", "well-run", "off-world",
  // Coinages and nicknames the model uses for things the save spells differently.
  "lab-less", "two-thirds", "one-third", "three-quarters", "green-chip", "green-chips", "red-chip", "red-chips", "blue-chip", "blue-chips",
]);

const NAME = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

/** A technology's trigger names its item or entity either as a string or as `{ name }`, depending on the trigger. */
export function triggerName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") return (value as { name: string }).name;
  return null;
}

/** Everything this save can be said to have: the dumped tables, plus the items and entities technologies trigger on. */
export function knownNames(p: Prototypes): Set<string> {
  const names = new Set<string>([
    ...Object.keys(p.recipes), ...Object.keys(p.items), ...Object.keys(p.fluids),
    ...Object.keys(p.technologies), ...Object.keys(p.machines), ...Object.keys(p.entities),
  ]);
  for (const tech of Object.values(p.technologies)) {
    const trigger = (tech as { trigger?: { item?: unknown; entity?: unknown } }).trigger;
    for (const named of [triggerName(trigger?.item), triggerName(trigger?.entity)]) if (named) names.add(named);
  }
  return names;
}

/** The names in this answer that the save has nothing for, in the order they appear, without repeats. */
export function unknownNames(text: string, p: Prototypes | null, known = p ? knownNames(p) : new Set<string>()): string[] {
  if (!p) return [];
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(NAME)) {
    const name = match[0];
    if (ENGLISH.has(name) || known.has(name) || out.includes(name)) continue;
    // "transport-belts" is the same thing as "transport-belt"; so is a name the dump spells with the plural.
    const singular = name.replace(/s$/, "");
    if (known.has(singular) || known.has(`${name}s`)) continue;
    // A hyphenated phrase whose words are all real names on their own ("pipe-to-ground" split by a hyphen we
    // didn't expect) isn't an invention worth a correction.
    if (name.split("-").every((word) => known.has(word) || ENGLISH.has(word))) continue;
    // The family's own name, with the tier written as a separate word: "assembling-machine 1–3" is how a person
    // writes it, and the save has assembling-machine-1/-2/-3. Caught in an eval run (2026-09-17).
    if ([...known].some((real) => real.startsWith(`${name}-`))) continue;
    out.push(name);
  }
  return out;
}

/**
 * Words that frame a name as a thing in the save rather than as English. A fixed list of hyphenated English can't
 * be finished — the first run of this check corrected "well-run hold" and "off-world means a rocket silo" — so a
 * correction needs the name to be *used* as a prototype: researched, crafted, built, placed, or called a recipe or
 * a technology. The original case reads "the defensive-structures research", which this catches.
 */
const CUE = /\b(research\w*|technolog\w*|tech|recipe|unlocks?|unlocked|craft\w*|build\w*|placed?|placing|mines?|mining|smelt\w*|prototype|item|machine|entity)\b/i;
/**
 * The cue has to sit next to the name, not somewhere in the sentence. At 40 characters, "nothing researching" two
 * clauses away vouched for "hand-mine" and the player was told their save has no such thing (eval run, 2026-09-17).
 * Adjacent leaves room for "the ", "a " and a short word, and still catches "the defensive-structures research".
 */
const WINDOW = 14;

/** Is this name used as something the save would have, rather than as a turn of phrase? */
export function namedAsSaveThing(text: string, name: string): boolean {
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) {
    const before = lower.slice(Math.max(0, at - WINDOW), at);
    const after = lower.slice(at + name.length, at + name.length + WINDOW);
    if (CUE.test(before) || CUE.test(after)) return true;
  }
  return false;
}

/**
 * The correction line, in the same voice as the count corrections: brief, and it doesn't guess at a replacement.
 * Only names that were used as save things are corrected — a missed correction is a much cheaper mistake than
 * telling the player their save has no "off-world".
 */
export function nameCorrections(text: string, p: Prototypes | null): string[] {
  const unknown = unknownNames(text, p).filter((name) => namedAsSaveThing(text, name));
  if (!unknown.length) return [];
  const named = unknown.slice(0, 3).map((n) => `"${n}"`).join(", ");
  return [`Correction: this save has no ${named}${unknown.length > 3 ? ` (and ${unknown.length - 3} more)` : ""} — I shouldn't have named ${unknown.length === 1 ? "it" : "them"}.`];
}
