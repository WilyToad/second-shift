// Lists the companion keeps for the player (FC-163). The player's idea: half of inventory pain is a to-do list, so
// the companion owns one small primitive and everything else (the packing list, FC-166) sits on top of it.
//
// Decisions with the player (2026-09-15):
//   - Several named lists, one active. The active one is what the in-game panel shows.
//   - Fully agent-managed: the player asks for changes instead of clicking, so nothing here handles player edits.
//   - Only lists with a rule tick themselves off (a packing list, against what the player carries). A plain list
//     is ticked when the player says so.
// Capped, because the active list rides in every turn's tail: a handful of lists, 25 items each, short text.

export type ListItem = { text: string; done: boolean; note?: string };
/** `kind` says whether something keeps the list current: "packing" is checked against the player's stock. */
export type Checklist = { name: string; kind: "plain" | "packing"; items: ListItem[]; updatedAt: number };

export const MAX_LISTS = 5;
export const MAX_ITEMS = 25;
export const MAX_TEXT = 80;
const MAX_NAME = 40;

export type ListEdit = {
  list?: string;
  kind?: "plain" | "packing";
  add?: string[];
  /** "30 stone furnace" replaces whatever count that item had: a list of amounts, not of lines. */
  set?: string[];
  done?: string[];
  undone?: string[];
  remove?: string[];
  rename?: string;
  clear?: boolean;
  delete?: boolean;
};

export type ListsData = { lists: Checklist[]; active?: string };

const clean = (text: string, max = MAX_TEXT) => text.replace(/\s+/g, " ").trim().slice(0, max);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** List names match exactly or by prefix ("packing" finds "packing list"), so "list 1" never finds "list 2". */
const sameName = (a: string, b: string) => {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  return x === y || (x.length > 2 && y.startsWith(x)) || (y.length > 2 && x.startsWith(y));
};
/** Words that carry no meaning in "the belts" or "a couple of chests". */
const FILLER = new Set(["the", "a", "an", "my", "some", "and", "of", "for", "to", "couple", "few", "more", "those", "these", "that", "this"]);
const words = (text: string) =>
  text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !FILLER.has(w));
/** "the belts" finds "200 transport belt": the player never says the item's full name back (FC-163). */
const looksLike = (item: string, said: string) => {
  const a = words(item), b = words(said);
  if (!a.length || !b.length) return item.trim().toLowerCase() === said.trim().toLowerCase();
  return b.every((w) => a.includes(w)) || a.every((w) => b.includes(w));
};
/** A looser last resort: one shared word, used only when exactly one item matches that way. */
const sharesAWord = (item: string, said: string) => {
  const a = words(item), b = words(said);
  return b.some((w) => a.includes(w));
};
/** The same thing, ignoring the count: "5 iron chest" and "50 iron chest", but not "50 iron gear wheel". */
const sameItem = (a: string, b: string) => {
  const x = words(a), y = words(b);
  return x.length > 0 && x.length === y.length && x.every((w) => y.includes(w));
};

/**
 * The item the player means: the exact text, else the only one whose words line up, else the only one sharing a
 * word. Anything matching more than one item is left alone — "iron" must not tick off the iron chests when the
 * list also holds iron plates.
 */
function findItem(items: ListItem[], said: string): ListItem | undefined {
  const exact = items.find((i) => same(i.text, said));
  if (exact) return exact;
  const close = items.filter((i) => looksLike(i.text, said));
  if (close.length === 1) return close[0];
  if (close.length > 1) return undefined;
  const loose = items.filter((i) => sharesAWord(i.text, said));
  return loose.length === 1 ? loose[0] : undefined;
}

export class Lists {
  private lists: Checklist[] = [];
  private activeName: string | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  load(data: ListsData | undefined | null): void {
    if (!data?.lists) return;
    this.lists = data.lists.slice(0, MAX_LISTS).map((l) => ({
      name: clean(l.name, MAX_NAME) || "list",
      kind: l.kind === "packing" ? "packing" : "plain",
      items: (l.items ?? []).slice(0, MAX_ITEMS).map((i) => ({ text: clean(i.text), done: Boolean(i.done), ...(i.note ? { note: clean(i.note) } : {}) })),
      updatedAt: typeof l.updatedAt === "number" ? l.updatedAt : this.now(),
    }));
    this.activeName = this.lists.find((l) => same(l.name, data.active ?? ""))?.name ?? this.lists[0]?.name;
  }

  /** Empties every list: the conversation they belonged to is gone (FC-163). */
  clear(): void {
    this.lists = [];
    this.activeName = undefined;
  }

  save(): ListsData {
    return { lists: this.lists, ...(this.activeName ? { active: this.activeName } : {}) };
  }

  all(): Checklist[] {
    return this.lists;
  }

  active(): Checklist | undefined {
    return this.lists.find((l) => same(l.name, this.activeName ?? "")) ?? this.lists[0];
  }

  get(name: string): Checklist | undefined {
    return this.lists.find((l) => same(l.name, name)) ?? this.lists.find((l) => sameName(l.name, name));
  }

  /** Applies one edit and says what changed, in the words the answer can use. Never throws. */
  apply(edit: ListEdit): string {
    const wanted = edit.list ? clean(edit.list, MAX_NAME) : this.active()?.name;
    if (!wanted) return "No list was named and there's no list yet, so nothing changed. Say what to call it.";
    let list = this.get(wanted);
    const changes: string[] = [];

    if (!list) {
      if (edit.delete || edit.clear) return `There's no list called "${wanted}".`;
      if (this.lists.length >= MAX_LISTS) return `There are already ${MAX_LISTS} lists. Ask to clear or delete one first.`;
      list = { name: wanted, kind: edit.kind === "packing" ? "packing" : "plain", items: [], updatedAt: this.now() };
      this.lists.push(list);
      changes.push(`started the list "${list.name}"`);
    }
    if (edit.delete) {
      this.lists = this.lists.filter((l) => l !== list);
      if (same(this.activeName ?? "", list.name)) this.activeName = this.lists[0]?.name;
      return `Deleted the list "${list.name}".`;
    }
    if (edit.kind && edit.kind !== list.kind) {
      list.kind = edit.kind;
      changes.push(`it keeps itself in step with the player's stock`);
    }
    if (edit.rename) {
      const to = clean(edit.rename, MAX_NAME);
      const taken = this.lists.some((l) => l !== list && same(l.name, to));
      if (to && !taken) {
        if (same(this.activeName ?? "", list.name)) this.activeName = to;
        changes.push(`renamed it to "${to}"`);
        list.name = to;
      }
    }
    if (edit.clear) {
      const n = list.items.length;
      list.items = [];
      changes.push(`cleared ${n} item${n === 1 ? "" : "s"}`);
    }
    // A count that changes replaces the item, because a packing list is amounts rather than lines. The model
    // otherwise adds the difference as a second line ("20 stone furnace" plus "10 stone furnace").
    for (const text of edit.set ?? []) {
      const item = clean(text);
      if (!item) continue;
      const hit = list.items.find((i) => sameItem(i.text, item));
      if (hit) {
        if (same(hit.text, item)) continue;
        changes.push(`changed "${hit.text}" to ${item}`);
        hit.text = item;
        hit.done = false;
        delete hit.note;
      } else if (list.items.length < MAX_ITEMS) {
        list.items.push({ text: item, done: false });
        changes.push(`added ${item}`);
      }
    }
    for (const text of edit.add ?? []) {
      const item = clean(text);
      if (!item) continue;
      if (list.items.some((i) => same(i.text, item))) continue;
      // On a packing list, adding the same thing again means changing its count.
      const existing = list.kind === "packing" ? list.items.find((i) => sameItem(i.text, item)) : undefined;
      if (existing) {
        changes.push(`changed "${existing.text}" to ${item}`);
        existing.text = item;
        existing.done = false;
        delete existing.note;
        continue;
      }
      if (list.items.length >= MAX_ITEMS) { changes.push(`the list is full at ${MAX_ITEMS} items, so "${item}" wasn't added`); break; }
      list.items.push({ text: item, done: false });
      changes.push(`added ${item}`);
    }
    for (const text of edit.remove ?? []) {
      const hit = findItem(list.items, clean(text));
      if (hit) {
        list.items = list.items.filter((i) => i !== hit);
        changes.push(`removed ${hit.text}`);
      }
    }
    for (const [texts, done] of [[edit.done ?? [], true], [edit.undone ?? [], false]] as const) {
      for (const text of texts) {
        const hit = findItem(list.items, clean(text));
        if (hit && hit.done !== done) {
          hit.done = done;
          changes.push(`${done ? "ticked off" : "put back"} ${hit.text}`);
        }
      }
    }
    list.updatedAt = this.now();
    this.activeName = list.name;
    return changes.length ? `Updated "${list.name}": ${changes.join(", ")}.` : `Nothing to change on "${list.name}".`;
  }

  /** Sets an item's state and note from a rule (FC-166), without pretending the player asked. */
  update(listName: string, text: string, state: { done?: boolean; note?: string }): boolean {
    const list = this.get(listName);
    const item = list ? findItem(list.items, text) : undefined;
    if (!list || !item) return false;
    let changed = false;
    if (state.done !== undefined && item.done !== state.done) { item.done = state.done; changed = true; }
    if (state.note !== undefined && item.note !== state.note) { item.note = clean(state.note); changed = true; }
    if (changed) list.updatedAt = this.now();
    return changed;
  }

  /**
   * Adds items a rule worked out (FC-167's essentials), each with the reason as its note. Returns what it added,
   * so the answer can say it out loud instead of the list changing silently.
   */
  addFromRule(listName: string, items: { text: string; note: string }[]): string[] {
    const list = this.get(listName);
    if (!list) return [];
    const added: string[] = [];
    for (const item of items) {
      const text = clean(item.text);
      if (!text || list.items.some((i) => sameItem(i.text, text))) continue;
      if (list.items.length >= MAX_ITEMS) break;
      list.items.push({ text, done: false, note: clean(item.note) });
      added.push(text);
    }
    if (added.length) list.updatedAt = this.now();
    return added;
  }

  /** What goes in the turn's tail: the active list in full, the others as names. Short on purpose. */
  format(): string[] {
    const active = this.active();
    if (!active) return [];
    const done = active.items.filter((i) => i.done).length;
    const lines = [`the player's list "${active.name}" (${done} of ${active.items.length} done${active.kind === "packing" ? ", a packing list kept in step with what they carry" : ""}):`];
    for (const item of active.items) lines.push(`- [${item.done ? "x" : " "}] ${item.text}${item.note ? ` — ${item.note}` : ""}`);
    if (!active.items.length) lines.push("- (empty)");
    const others = this.lists.filter((l) => l !== active).map((l) => `"${l.name}" (${l.items.filter((i) => i.done).length}/${l.items.length})`);
    if (others.length) lines.push(`the player's other lists: ${others.join(", ")}`);
    return lines;
  }
}
