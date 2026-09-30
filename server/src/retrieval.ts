// Picks the recipe and technology lines relevant to a question, in code, so the model gets the
// save's real data without the whole 59k-token dump in the prompt (PLAN §6, FC-011).
import type { Prototypes } from "@companion/interfaces";
import { craftersByCategory, machineLine, recipeLine, techLine } from "./grounding";

type Kind = "item" | "fluid" | "recipe" | "technology";
type Entry = { kind: Kind; name: string };

/** Player nicknames for common items. */
const ALIASES: Record<string, string> = {
  "green circuit": "electronic-circuit", "red circuit": "advanced-circuit", "blue circuit": "processing-unit",
  "green chip": "electronic-circuit", "red chip": "advanced-circuit", "blue chip": "processing-unit",
  "red science": "automation-science-pack", "green science": "logistic-science-pack", "blue science": "chemical-science-pack",
  "purple science": "production-science-pack", "yellow science": "utility-science-pack", "white science": "space-science-pack",
  "black science": "military-science-pack", "gray science": "military-science-pack", "grey science": "military-science-pack",
  lds: "low-density-structure", "low density structure": "low-density-structure",
  "agri science": "agricultural-science-pack", "ag science": "agricultural-science-pack",
  "em science": "electromagnetic-science-pack", "metallurgic science": "metallurgic-science-pack",
  "yellow belt": "transport-belt", "red belt": "fast-transport-belt", "fast belt": "fast-transport-belt",
  "blue belt": "express-transport-belt", "express belt": "express-transport-belt", "green belt": "turbo-transport-belt", "turbo belt": "turbo-transport-belt",
  "yellow inserter": "inserter", "red inserter": "long-handed-inserter", "blue inserter": "fast-inserter", "green inserter": "bulk-inserter",
};

/**
 * Everyday words for what an item's name ends in (FC-256): "arms" for inserters, "ovens" for furnaces, and the
 * player's own "is this miner thing working?" (playtest, 2026-09-30).
 */
const HEAD_SYNONYMS: Record<string, string> = { arm: "inserter", oven: "furnace", smelter: "furnace", miner: "drill", conveyor: "belt" };
/** Last words too general to guess from: they'd pull in recipes for half the save. */
const VAGUE_HEADS = new Set(["pack", "unit", "structure", "equipment", "part", "item", "remote", "data", "card", "sample", "result"]);
/** At most this many items for one everyday word, so "chest" doesn't bring in every chest in the save. */
const MAX_GUESSES = 3;

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
  private nameWords: Set<string> | null = null;
  /** Items by the last word or two of their name ("drill", "mining drill"), for everyday names (FC-256). */
  private readonly heads = new Map<string, string[]>();

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

    for (const name of Object.keys(p.items)) {
      const words = name.split("-");
      for (const n of [1, 2]) {
        if (words.length < n) continue;
        const head = words.slice(-n).map((w, i, all) => (i === all.length - 1 ? singular(w) : w)).join(" ");
        if (n === 1 && VAGUE_HEADS.has(head)) continue;
        this.heads.set(head, [...(this.heads.get(head) ?? []), name]);
      }
    }

    for (const [name, t] of Object.entries(p.technologies)) {
      for (const recipe of t.unlocks) this.unlockedBy.set(recipe, [...(this.unlockedBy.get(recipe) ?? []), name]);
    }
    for (const [name, r] of Object.entries(p.recipes)) {
      for (const out of r.products) this.producers.set(out.name, [...(this.producers.get(out.name) ?? []), name]);
      for (const inp of r.ingredients) this.users.set(inp.name, [...(this.users.get(inp.name) ?? []), name]);
    }
  }

  /**
   * The items an everyday word most likely means (FC-256): "drill" is burner-mining-drill and electric-mining-drill
   * on a new map, not the big drill nobody has yet. What's unlocked in this save comes first, then the simplest to
   * make; at most three. Empty when the word isn't the end of any item's name.
   */
  guess(word: string): string[] {
    const said = word.split(" ").map((w, i, all) => (i === all.length - 1 ? singular(w) : w));
    said[said.length - 1] = HEAD_SYNONYMS[said.at(-1)!] ?? said.at(-1)!;
    const items = this.heads.get(said.join(" ")) ?? [];
    if (!items.length) return [];
    // The recipe that makes it, not one that recycles something into it: tungsten ore "made" by recycling ranked
    // ahead of iron ore, which nothing makes because it's mined.
    const recipeName = (item: string) => (this.p.recipes[item] ? item : (this.producers.get(item) ?? []).find((n) => !this.p.recipes[n]!.category.startsWith("recycling")));
    const recipe = (item: string) => this.p.recipes[recipeName(item) ?? ""];
    const mined = new Set(this.p.raw_resources);
    const unlocked = (item: string) => mined.has(item) || Boolean(recipe(item)?.enabled);
    // How deep in the tech tree its recipe is: on a late save everything is unlocked, and "chest" still means the
    // wooden and iron ones before the steel one. Mined things count as the start.
    const depth = (item: string) => { if (mined.has(item)) return 0; const r = recipeName(item); return r && this.unlockedBy.has(r) ? Math.min(...this.unlockedBy.get(r)!.map((t) => this.techDepth(t))) : 0; };
    // Iron ore has recipes on this save (asteroid crushing, a Cerys process), but it's mined: a basic, whatever else makes it.
    const effort = (item: string) => (mined.has(item) ? 0 : recipe(item)?.ingredients.length ?? 0);
    const ranked = [...items].sort((a, b) => Number(unlocked(b)) - Number(unlocked(a)) || depth(a) - depth(b) || effort(a) - effort(b) || a.length - b.length);
    const open = ranked.filter(unlocked);
    return (open.length ? open : ranked).slice(0, MAX_GUESSES);
  }

  private readonly depths = new Map<string, number>();
  /** Research steps from the start to this technology, the longest chain of prerequisites. */
  private techDepth(name: string, seen = new Set<string>()): number {
    const known = this.depths.get(name);
    if (known !== undefined) return known;
    if (seen.has(name)) return 0; // a modded loop: stop rather than spin
    seen.add(name);
    const pre = this.p.technologies[name]?.prerequisites ?? [];
    const d = pre.length ? 1 + Math.max(...pre.map((t) => this.techDepth(t, seen))) : 1;
    this.depths.set(name, d);
    return d;
  }

  /** The everyday words the last `match` read as items, and what it took each to mean (FC-256). */
  guessed: { said: string; items: string[] }[] = [];

  /**
   * Longest-first phrase matches against prototype names and aliases, singular/plural tolerant. `guess` also reads
   * everyday words as their likeliest items — right for recipes ("a drill" to make), wrong for finding things in the
   * world, where "belts" means every belt on the map.
   */
  match(question: string, guess = false): Entry[] {
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
    // Words no name matched may still be the end of one: "a second drill", "another chest", "mining drill" (FC-256).
    // Two words before one, so "mining drill" isn't read as any drill.
    this.guessed = [];
    if (!guess) return found;
    for (let size = 2; size >= 1; size--) {
      for (let i = 0; i + size <= words.length; i++) {
        if (used.slice(i, i + size).some(Boolean)) continue;
        const said = words.slice(i, i + size).join(" ");
        const items = this.guess(said);
        if (!items.length) continue;
        for (let k = i; k < i + size; k++) used[k] = true;
        this.guessed.push({ said, items });
        for (const name of items) if (!found.some((f) => f.kind === "item" && f.name === name)) found.push({ kind: "item", name });
      }
    }
    return found;
  }

  /**
   * The thing a recipe question names ("how do I craft a quantum widget?", "recipe for X", "what does X need")
   * when not one of its words matches anything in the save, so the model can be told it doesn't exist (FC-112).
   */
  unknownName(question: string): string | null {
    const m = /\b(?:craft|recipe for|make an?|build an?)\s+(?:an?\s+|the\s+|some\s+)?([a-z][a-z' -]{2,40}?)\s*(?:[?.!,]|$|\s+(?:per|in|with|for|from|on)\b)/i.exec(question)
      ?? /\bwhat (?:does|do) (?:an?\s+|the\s+)?([a-z][a-z' -]{2,40}?) (?:need|take|require)s?\b/i.exec(question);
    const phrase = m?.[1]?.trim();
    if (!phrase || /^(it|them|that|this|those|these|more|one)$/i.test(phrase)) return null;
    if (this.match(phrase, true).length > 0) return null;
    // The last word names the thing ("quantum widget" → widget). If it appears in any name in the save
    // ("gear wheels" → iron-gear-wheel), the player probably means that thing, just phrased differently.
    this.nameWords ??= new Set([this.p.recipes, this.p.items, this.p.fluids, this.p.entities, this.p.technologies, this.p.machines].flatMap((group) => Object.keys(group)).flatMap((name) => name.split("-")));
    const words = phrase.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 2 && !/^(the|and|for|some|more)$/.test(w));
    const head = words.at(-1);
    if (!head || this.nameWords.has(head) || this.nameWords.has(singular(head))) return null;
    return phrase;
  }

  /** Technologies the player might mean: named ones, then those unlocking a named item's recipe. */
  technologiesFor(text: string): string[] {
    const out: string[] = [];
    for (const e of this.match(text, true)) {
      if (e.kind === "technology" && !out.includes(e.name)) out.push(e.name);
    }
    for (const e of this.match(text, true)) {
      if (e.kind !== "item" && e.kind !== "fluid") continue;
      for (const recipe of this.producers.get(e.name) ?? []) for (const t of this.unlockedBy.get(recipe) ?? []) if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  /** Recipe lines for recipes named exactly (what the player can hand-craft now). */
  recipeLines(names: string[]): string[] {
    return names.filter((n) => this.p.recipes[n]).map((n) => recipeLine(n, this.p.recipes[n]!, this.crafters));
  }

  /** Relevant lines for a question, capped. Returns the names it matched for transparency. */
  retrieve(question: string, maxLines = 24): { matched: string[]; items: string[]; lines: string[] } {
    const entries = this.match(question, true);
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

    // Say what an everyday word was taken to mean, so the answer can say so and the player can correct it (FC-256).
    const readAs = this.guessed.map((g) => `"${g.said}" isn't one item's name here; read as ${g.items.join(", ")}${g.items.length > 1 ? " (unlocked in this save first)" : ""} — if the player meant another, they can say which`);
    const lines = [
      ...readAs,
      ...techs.map((t) => techLine(t, this.p.technologies[t]!)),
      ...recipes.map((r) => recipeLine(r, this.p.recipes[r]!, this.crafters)),
      ...machines.map((m) => machineLine(m, this.p.machines[m]!)).filter((l): l is string => l !== null),
    ].slice(0, maxLines);
    const items = entries.filter((e) => e.kind === "item" || e.kind === "fluid").map((e) => e.name);
    return { matched: entries.map((e) => `${e.kind}:${e.name}`), items, lines };
  }
}
