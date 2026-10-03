// Recipe and power claims checked against the save (FC-257). In the first local-voice playtest (2026-09-27) the burner
// drill was given as "2 iron gear wheels, 5 iron plate, 1 stone furnace" three times (the save: 3 iron-plate, 3
// iron-gear-wheel, 1 stone-furnace) and its power as "30 MW" (150 kW), and every turn went out with `corrected=0`.
// CLAUDE.md's rule is that a recipe claim that can't be cited from the dump is a bug; this catches the two shapes
// the playtest produced, after the answer is written, in the FC-140 style.
//
// Narrow on purpose, like the other checks: a missed correction is cheaper than a wrong one.
// - A recipe claim is a named item followed, in the same clause, by at least two "count + ingredient" pairs. Only an
//   ingredient the recipe really has can be wrong; anything else in the clause (a raw total, "9 ore") is ignored, as
//   is anything in parentheses or after "so", "total" or "=" — the rollups.
// - Counts that are one whole multiple of the recipe are a claim about several ("two drills: 6 plate, 6 gears").
// - A power figure is checked only right after a machine's name, against its rated draw, times a count of machines
//   only when one is written just before the name ("47 labs draw 2.8 MW").
import type { Prototypes } from "@companion/interfaces";
import { resolveItem } from "./packing";

type Mention = { item: string; start: number; end: number };

const WORD_COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };

/** The ways an answer writes an item: `burner-mining-drill`, "burner mining drill", and "burner drill" when only one item fits. */
function variants(p: Prototypes): { text: string; item: string }[] {
  const out: { text: string; item: string }[] = [];
  const shortForms = new Map<string, string[]>();
  for (const item of Object.keys(p.items)) {
    out.push({ text: item, item });
    const words = item.split("-");
    if (words.length > 1) out.push({ text: words.join(" "), item });
    if (words.length > 2) {
      const short = `${words[0]} ${words.at(-1)}`;
      shortForms.set(short, [...(shortForms.get(short) ?? []), item]);
    }
  }
  for (const [text, items] of shortForms) if (items.length === 1 && !p.items[text.replace(" ", "-")]) out.push({ text, item: items[0]! });
  return out.sort((a, b) => b.text.length - a.text.length);
}

/** Every item named in the text, longest name first so "burner mining drill" isn't also read as a "mining drill". */
function mentions(text: string, p: Prototypes): Mention[] {
  const lower = text.toLowerCase();
  const taken = new Array(lower.length).fill(false);
  const found: Mention[] = [];
  for (const v of variants(p)) {
    const re = new RegExp(`(?<![a-z-])${v.text.replace(/[-]/g, "[- ]")}s?(?![a-z-])`, "g");
    for (let m = re.exec(lower); m; m = re.exec(lower)) {
      if (taken.slice(m.index, m.index + m[0].length).some(Boolean)) continue;
      for (let k = m.index; k < m.index + m[0].length; k++) taken[k] = true;
      found.push({ item: v.item, start: m.index, end: m.index + m[0].length });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The clause after a mention: to the end of the sentence, short of any parenthesis or rollup ("so", "total", "="). */
function clauseAfter(text: string, from: number): string {
  const rest = text.slice(from);
  const end = rest.search(/[.!?](\s|$)|\n|\(|\bso\b|\btotal\b|=|;|—|\bby hand\b|\bin an?\b|\bmines?\b|\bburns?\b/i);
  return end < 0 ? rest : rest.slice(0, end);
}

/** "3 iron plate, 3 iron gear wheels and 1 stone furnace" → [{ item, count }] for the pairs that name an item. */
function stated(clause: string, p: Prototypes): { item: string; count: number }[] {
  const out: { item: string; count: number }[] = [];
  const re = /(\d+)\s*(?:x\s*)?([a-z][a-z -]{1,40}?)(?=\s*(?:,|\band\b|\bplus\b|$))/gi;
  for (let m = re.exec(clause); m; m = re.exec(clause)) {
    const item = resolveItem(m[2]!.trim(), p);
    if (item) out.push({ item, count: Number(m[1]) });
  }
  return out;
}

/** How many of the thing a clause is about, when a count is written right before its name ("two burner drills"). */
function countBefore(text: string, at: number): number | null {
  const m = /(?:^|[\s(])(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\s+$/i.exec(text.slice(Math.max(0, at - 14), at));
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  return /^\d+$/.test(w) ? Number(w) : (WORD_COUNTS[w] ?? null);
}

function recipesFor(item: string, p: Prototypes) {
  return Object.entries(p.recipes)
    .filter(([, r]) => !r.category.startsWith("recycling") && r.products.some((x) => x.name === item))
    .map(([name, r]) => ({ name, ingredients: r.ingredients }));
}

/** Do the stated counts fit this recipe, once, or as one whole multiple of it? */
function fits(claim: { item: string; count: number }[], ingredients: { name: string; amount: number }[]): boolean {
  const relevant = claim.filter((c) => ingredients.some((i) => i.name === c.item));
  if (!relevant.length) return true; // nothing it states is in the recipe: not a claim about this recipe
  const ratios = relevant.map((c) => c.count / ingredients.find((i) => i.name === c.item)!.amount);
  const k = ratios[0]!;
  return Number.isInteger(k) && k >= 1 && ratios.every((r) => r === k);
}

const CLAIM = /^\s*(?:\([^)]*\)\s*)?(?::|\b(?:takes?|needs?|costs?|requires?|wants?|means|uses?|is made (?:from|of)|is)\b)/i;

export function recipeCorrections(text: string, p: Prototypes | null): string[] {
  if (!p) return [];
  const out: string[] = [];
  const done = new Set<string>();
  for (const m of mentions(text, p)) {
    if (done.has(m.item)) continue;
    // The item the claim is about has a claim word right after its name; an ingredient in the middle of a list
    // ("…iron gear wheels, 5 iron plate…") doesn't, and isn't read as one.
    if (!CLAIM.test(text.slice(m.end, m.end + 24))) continue;
    const claim = stated(clauseAfter(text, m.end), p).filter((c) => c.item !== m.item);
    if (claim.length < 2) continue;
    const recipes = recipesFor(m.item, p);
    if (!recipes.length || recipes.some((r) => fits(claim, r.ingredients))) continue;
    // Only ingredients the recipe really has can be wrong; say what the save's own recipe is.
    const main = recipes.find((r) => r.name === m.item) ?? recipes[0]!;
    done.add(m.item);
    out.push(`Correction: in this save a ${m.item} takes ${main.ingredients.map((i) => `${i.amount} ${i.name}`).join(", ")}.`);
  }
  return out;
}

const UNIT: Record<string, number> = { w: 1, kw: 1e3, mw: 1e6, gw: 1e9 };

/** "150 kW", "2.8 MW" in watts. */
function watts(n: string, unit: string): number {
  return Number(n.replace(/,/g, "")) * UNIT[unit.toLowerCase()]!;
}

function formatWatts(w: number): string {
  if (w >= 1e6) return `${+(w / 1e6).toFixed(2)} MW`;
  if (w >= 1e3) return `${+(w / 1e3).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

export function powerCorrections(text: string, p: Prototypes | null): string[] {
  if (!p) return [];
  const out: string[] = [];
  const done = new Set<string>();
  for (const m of mentions(text, p)) {
    const machineName = p.items[m.item]?.place_result;
    const machine = machineName ? p.machines[machineName] : undefined;
    const perTick = machine?.energy_usage;
    if (!perTick || done.has(m.item)) continue;
    // The figure has to sit right after the name, in the same clause: "burner drill uses 30 MW", "burner drill (30 MW)".
    const after = text.slice(m.end, m.end + 48);
    const figure = /^[^.;!?\n\d]{0,32}?(\d[\d,]*(?:\.\d+)?)\s*(gw|mw|kw|w)\b/i.exec(after);
    if (!figure) continue;
    const said = watts(figure[1]!, figure[2]!);
    const rated = perTick * 60;
    const count = countBefore(text, m.start) ?? 1;
    if (Math.abs(said - rated * count) <= rated * count * 0.05) continue;
    done.add(m.item);
    out.push(`Correction: a ${m.item} draws ${formatWatts(rated)} in this save${count > 1 ? ` (${formatWatts(rated * count)} for ${count})` : ""}, not ${formatWatts(said)}.`);
  }
  return out;
}
