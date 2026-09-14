// Picks the recipe and technology lines relevant to a question, in code, so the model gets the
// save's real data without the whole 59k-token dump in the prompt (PLAN §6, FC-011).
import type { Prototypes } from "@companion/interfaces";
import { craftersByCategory, recipeLine } from "./grounding";

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

  /** Relevant lines for a question, capped. Returns the names it matched for transparency. */
  retrieve(question: string, maxLines = 40): { matched: string[]; lines: string[] } {
    const entries = this.match(question);
    const recipes: string[] = [];
    const techs: string[] = [];
    const addRecipe = (name: string) => { if (this.p.recipes[name] && !recipes.includes(name)) recipes.push(name); };

    for (const e of entries) {
      if (e.kind === "recipe") addRecipe(e.name);
      if (e.kind === "technology" && !techs.includes(e.name)) techs.push(e.name);
    }
    for (const e of entries.filter((x) => x.kind === "item" || x.kind === "fluid")) {
      const made = this.producers.get(e.name) ?? [];
      made.slice(0, 6).forEach(addRecipe);
      // One level down: how the main recipe's ingredients are made.
      const main = made.find((n) => n === e.name) ?? made[0];
      for (const ing of main ? this.p.recipes[main]!.ingredients : []) (this.producers.get(ing.name) ?? []).slice(0, 2).forEach(addRecipe);
      (this.users.get(e.name) ?? []).slice(0, 4).forEach(addRecipe);
    }
    for (const t of techs) this.p.technologies[t]!.unlocks.slice(0, 5).forEach(addRecipe);

    const lines = [
      ...techs.map((t) => techLine(t, this.p)),
      ...recipes.map((r) => recipeLine(r, this.p.recipes[r]!, this.crafters)),
    ].slice(0, maxLines);
    return { matched: entries.map((e) => `${e.kind}:${e.name}`), lines };
  }
}

function techLine(name: string, p: Prototypes): string {
  const t = p.technologies[name]!;
  const cost = t.trigger ? `trigger ${t.trigger.type}` : `${t.count_formula ?? t.count}x(${t.ingredients.map((i) => `${i.name} ${i.amount}`).join(", ")})`;
  return `technology ${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"} | ${cost}${t.researched ? " | researched" : " | not researched"}`;
}
