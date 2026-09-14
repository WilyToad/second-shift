// Picks the recipe and technology lines relevant to a question, in code, so the model gets the
// save's real data without the whole 59k-token dump in the prompt (PLAN §6, FC-011).
import type { Prototypes } from "@companion/interfaces";
import { craftersByCategory, machineLine, recipeLine, techLine } from "./grounding";

type Kind = "item" | "fluid" | "recipe" | "technology";
type Entry = { kind: Kind; name: string };

/** Player nicknames for common items. */
const ALIASES: Record<string, string> = {
  "green circuit": "electronic-circuit", "red circuit": "advanced-circuit", "blue circuit": "processing-unit",
  "red science": "automation-science-pack", "green science": "logistic-science-pack", "blue science": "chemical-science-pack",
  "purple science": "production-science-pack", "yellow science": "utility-science-pack", "white science": "space-science-pack",
  "black science": "military-science-pack", "gray science": "military-science-pack", "grey science": "military-science-pack",
  lds: "low-density-structure", "low density structure": "low-density-structure",
  "agri science": "agricultural-science-pack", "ag science": "agricultural-science-pack",
  "em science": "electromagnetic-science-pack", "metallurgic science": "metallurgic-science-pack",
  "yellow belt": "transport-belt", belt: "transport-belt", "red belt": "fast-transport-belt", "fast belt": "fast-transport-belt",
  "blue belt": "express-transport-belt", "express belt": "express-transport-belt", "green belt": "turbo-transport-belt", "turbo belt": "turbo-transport-belt",
  "yellow inserter": "inserter", "red inserter": "long-handed-inserter", "blue inserter": "fast-inserter", "green inserter": "bulk-inserter",
};

const MOD_PREFIXES = ["maraxsis-", "cerys-"];
const MAX_WORDS = 6;

export const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function singular(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && /(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export class RecipeRetriever {
  private readonly index = new Map<string, Entry[]>();
  private readonly producers = new Map<string, string[]>();
  private readonly users = new Map<string, string[]>();
  private readonly crafters: Map<string, string[]>;
  private readonly unlockedBy = new Map<string, string[]>();

  constructor(private readonly p: Prototypes) {
    this.crafters = craftersByCategory(p);
    const add = (phrase: string, entry: Entry) => {
      const key = normalize(phrase);
      const list = this.index.get(key) ?? [];
      if (!list.some((e) => e.kind === entry.kind && e.name === entry.name)) list.push(entry);
      this.index.set(key, list);
    };
    const addName = (name: string, kind: Kind) => {
      add(name, { kind, name });
      const prefix = MOD_PREFIXES.find((m) => name.startsWith(m));
      if (prefix) add(name.slice(prefix.length), { kind, name });
    };
    for (const name of Object.keys(p.items)) addName(name, "item");
    for (const name of Object.keys(p.fluids)) addName(name, "fluid");
    for (const name of Object.keys(p.recipes)) addName(name, "recipe");
    for (const name of Object.keys(p.technologies)) addName(name, "technology");
    for (const [alias, name] of Object.entries(ALIASES)) if (p.items[name]) add(alias, { kind: "item", name });
    // "agricultural science" -> agricultural-science-pack, for every science pack in the save.
    for (const name of Object.keys(p.items)) if (name.endsWith("-science-pack")) add(name.slice(0, -"-pack".length), { kind: "item", name });

    for (const [name, t] of Object.entries(p.technologies)) {
      for (const recipe of t.unlocks) this.unlockedBy.set(recipe, [...(this.unlockedBy.get(recipe) ?? []), name]);
    }
    for (const [name, r] of Object.entries(p.recipes)) {
      for (const out of r.products) this.producers.set(out.name, [...(this.producers.get(out.name) ?? []), name]);
      for (const inp of r.ingredients) this.users.set(inp.name, [...(this.users.get(inp.name) ?? []), name]);
    }
  }

  /** Longest-first phrase matches against prototype names and aliases, singular/plural tolerant. */
  match(question: string): Entry[] {
    const words = normalize(question).split(" ").filter(Boolean);
    const found: Entry[] = [];
    const used = new Array(words.length).fill(false);
    for (let size = Math.min(MAX_WORDS, words.length); size >= 1; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        if (used.slice(i, i + size).some(Boolean)) continue;
        const phrase = words.slice(i, i + size);
        const hits = this.index.get(phrase.join(" ")) ?? this.index.get([...phrase.slice(0, -1), singular(phrase.at(-1)!)].join(" "));
        if (!hits) continue;
        for (let k = i; k < i + size; k++) used[k] = true;
        for (const h of hits) if (!found.some((f) => f.kind === h.kind && f.name === h.name)) found.push(h);
      }
    }
    return found;
  }

  /** Technologies the player might mean: named ones, then those unlocking a named item's recipe. */
  technologiesFor(text: string): string[] {
    const out: string[] = [];
    for (const e of this.match(text)) {
      if (e.kind === "technology" && !out.includes(e.name)) out.push(e.name);
    }
    for (const e of this.match(text)) {
      if (e.kind !== "item" && e.kind !== "fluid") continue;
      for (const recipe of this.producers.get(e.name) ?? []) for (const t of this.unlockedBy.get(recipe) ?? []) if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  /** Relevant lines for a question, capped. Returns the names it matched for transparency. */
  retrieve(question: string, maxLines = 24): { matched: string[]; items: string[]; lines: string[] } {
    const entries = this.match(question);
    const recipes: string[] = [];
    const techs: string[] = [];
    const hasMachines = this.crafters.size > 0;
    // Skip recipes nothing in the save can craft, and recycling loops, unless asked for by name.
    const useful = (name: string) => {
      const r = this.p.recipes[name];
      return !!r && (!hasMachines || (this.crafters.get(r.category)?.length ?? 0) > 0) && !r.category.startsWith("recycling");
    };
    const addRecipe = (name: string, force = false) => { if (this.p.recipes[name] && !recipes.includes(name) && (force || useful(name))) recipes.push(name); };
    // The canonical recipe for an item first (named like the item), then the rest.
    const producersOf = (item: string) => {
      const list = (this.producers.get(item) ?? []).filter(useful);
      return [...list.filter((n) => n === item), ...list.filter((n) => n !== item)];
    };
    const addTech = (name: string) => { if (this.p.technologies[name] && !techs.includes(name)) techs.push(name); };

    for (const e of entries) {
      if (e.kind === "recipe") addRecipe(e.name, true);
      if (e.kind === "technology") addTech(e.name);
    }
    for (const e of entries.filter((x) => x.kind === "item" || x.kind === "fluid")) {
      const made = producersOf(e.name);
      made.slice(0, 4).forEach((n) => addRecipe(n));
      // One level down: how the main recipe's ingredients are made.
      const main = made.find((n) => n === e.name) ?? made[0];
      // What research unlocks it, so "what do I need to research?" questions have the answer.
      if (main) (this.unlockedBy.get(main) ?? []).slice(0, 2).forEach(addTech);
      for (const ing of main ? this.p.recipes[main]!.ingredients : []) producersOf(ing.name).slice(0, 1).forEach((n) => addRecipe(n));
      (this.users.get(e.name) ?? []).filter(useful).slice(0, 2).forEach((n) => addRecipe(n));
    }
    for (const t of techs) this.p.technologies[t]!.unlocks.slice(0, 5).forEach((n) => addRecipe(n));

    // Machines named in the question (speed, modules, categories), and the crafters of the main recipe.
    const machines: string[] = [];
    const addMachine = (name: string) => { if (this.p.machines[name] && this.p.machines[name]!.type !== "character" && !machines.includes(name)) machines.push(name); };
    for (const e of entries) { addMachine(e.name); const placed = this.p.items[e.name]?.place_result; if (placed) addMachine(placed); }
    const mainRecipe = recipes[0] ? this.p.recipes[recipes[0]] : undefined;
    // Crafter details only when the question is about machines or rates; otherwise "made in" is enough.
    if (/\b(speed|machines?|how many|ratio|per (minute|second)|modules?|need)\b/i.test(question)) {
      for (const crafter of (mainRecipe ? this.crafters.get(mainRecipe.category) ?? [] : []).slice(0, 2)) addMachine(crafter);
    }

    const lines = [
      ...techs.map((t) => techLine(t, this.p.technologies[t]!)),
      ...recipes.map((r) => recipeLine(r, this.p.recipes[r]!, this.crafters)),
      ...machines.map((m) => machineLine(m, this.p.machines[m]!)).filter((l): l is string => l !== null),
    ].slice(0, maxLines);
    const items = entries.filter((e) => e.kind === "item" || e.kind === "fluid").map((e) => e.name);
    return { matched: entries.map((e) => `${e.kind}:${e.name}`), items, lines };
  }
}
