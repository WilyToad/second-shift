// A list item's words turned into the save's own name (FC-246). "20 ovens" has to become "20 stone-furnace" before
// the list exists, or the packing check can never match it against what the player carries, and the list never
// ticks — the failure FC-240 caught on both engines ("20 smelting furnace", "arms", "a power source").
//
// `resolveItem` in packing.ts does this lexically and gets the plain cases. What it can't do is know that an oven is
// a furnace or an arm is an inserter, so what it misses goes to Jev as a choice over this save's own placeable
// items: Jev cannot invent a name, because the options are ours.
//
// Measured on 18 of the player's own phrasings (2026-09-20, PLAN §5): at a 0.5 confidence threshold, 16 resolved and
// **none wrongly**; the two it wasn't sure of fall through to the lexical path, which is today's behaviour. When the
// right answer isn't among the candidates at all — "green circuits", which isn't placeable — confidence collapses to
// 0.09–0.30 and the item is left alone, so a narrow candidate set fails safe.
import type { Prototypes } from "@companion/interfaces";
import type { Choice, Decisions } from "./decisions";
import { resolveItem, splitCount } from "./packing";

/** How sure Jev must be to rename an item. Below this the lexical answer stands (measured: 16 right, 0 wrong). */
const THRESHOLD = 0.5;
/**
 * Choice questions per call. Each repeats the whole candidate list — ~2,800 tokens for this save's 157 placeable
 * items — and Jev's state-plus-questions budget is ~64k, so ten at a time leaves room and a full 25-item list is
 * three calls of a few hundred milliseconds, on a turn that already writes a list.
 */
const PER_CALL = 10;

export type Resolved = {
  /** What the model wrote. */
  text: string;
  /** The save's own name for it, or null when nothing could be matched. */
  item: string | null;
  /** The text to put on the list: the count with the save's name, or the original words unchanged. */
  listText: string;
  via: "local" | "jev";
  confidence: number;
};

/** This save's placeable items as choice criteria: the name, and its words for the model to match against. */
export function itemCriteria(protos: Prototypes): Record<string, string> {
  return Object.fromEntries(
    Object.entries(protos.items)
      .filter(([, v]) => v.place_result)
      .map(([name]) => [name, name.replace(/-/g, " ")]),
  );
}

const ask = (said: string) =>
  `A player packing for a build in Factorio wrote "${said}" on their list. Which of this save's items is that? Pick the closest one even if their wording is loose.`;

/**
 * Every item's words resolved to a name in this save, lexically first and by Jev only for what's left. Never throws
 * and never blocks: with no key, or if the call fails, every answer is the lexical one.
 */
export async function resolveListItems(texts: string[], protos: Prototypes | null, decisions?: Decisions): Promise<Resolved[]> {
  // "20 ovens" becomes "20 stone-furnace"; "enough arms to feed them" becomes "inserter", not "1 inserter" — a
  // count nobody wrote is not a count, and the check reads a bare name as one of the thing either way.
  const rename = (text: string, item: string) => {
    const { count, counted } = splitCount(text);
    return counted ? `${count} ${item}` : item;
  };
  const out: Resolved[] = texts.map((text) => {
    const item = protos ? resolveItem(splitCount(text).said, protos) : null;
    return { text, item, listText: item ? rename(text, item) : text, via: "local" as const, confidence: 0 };
  });
  // Note `decisions.decide` is called even when it will answer locally: it is the one place the paths are counted,
  // and a session with Jev down has to show that in its turn log (FC-244).
  if (!protos || !decisions) return out;
  const open = out.map((r, i) => ({ r, i })).filter(({ r }) => !r.item);
  if (!open.length) return out;

  const criteria = itemCriteria(protos);
  const names = new Set(Object.keys(criteria));
  for (let from = 0; from < open.length; from += PER_CALL) {
    const batch = open.slice(from, from + PER_CALL);
    const questions: Record<string, Choice> = {};
    for (const { r, i } of batch) {
      questions[`item${i}`] = { type: "choice", instructions: ask(splitCount(r.text).said), criteria, local: "", threshold: THRESHOLD };
    }
    const answers = await decisions.decide("The player is packing for a build in their Factorio save.", questions);
    for (const { r, i } of batch) {
      const a = answers[`item${i}`];
      r.confidence = a?.confidence ?? 0;
      if (!a || a.via !== "jev" || !names.has(a.value)) continue;
      r.item = a.value;
      r.via = "jev";
      r.listText = rename(r.text, a.value);
    }
  }
  return out;
}

/** One line for the answer when Jev renamed things, so the player sees their words were understood, not ignored. */
export function renamedNote(resolved: Resolved[]): string {
  const changed = resolved.filter((r) => r.via === "jev" && r.listText !== r.text);
  if (!changed.length) return "";
  return `read as this save's names: ${changed.map((r) => `"${r.text}" → ${r.listText}`).join(", ")}`;
}
