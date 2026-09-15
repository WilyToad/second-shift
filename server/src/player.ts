// The player's own situation, fetched only when a question needs it (S22): what they carry and can
// hand-craft, what they built, what they can see around them. Decided and formatted in code, sent in
// the uncached tail, never in the system prompt.
import type { PlayerStatus, Surroundings } from "@companion/interfaces";

const AFFIRMATIVE = /^\s*(y|yes|yeah|yea|yep|yup|sure|ok|okay|please|go ahead|do it|go for it|sounds good|absolutely|definitely|why not)\b[\s\w,.!']{0,30}$/i;

/**
 * "yeah" after "Want me to look around?" means "look around". Returns the question the last answer
 * offered, so the reply can be classified as that question. Null when the reply isn't a short yes or
 * the last answer offered nothing.
 */
export function acceptedOffer(question: string, lastAnswer: string | undefined): string | null {
  if (!lastAnswer || !AFFIRMATIVE.test(question)) return null;
  const offers = lastAnswer.match(/[^.!?\n]*\?/g);
  return offers?.at(-1)?.trim() ?? null;
}

const START = /\b(what (should|do|can) i do|help me|i need help|get(ting)? started|where (do|should) i (start|begin)|what now|what next|what'?s next|next steps?|first steps?|just (started|landed|crashed|spawned)|new (game|map)|how do i (start|begin))\b|^\s*help\b/i;
// "How do I craft X?" is a recipe question; only what the player can craft or has counts here.
const CARRY = /\b(inventory|carrying|holding|in my hands?|what do i have|have on me|what (can|could|should) i (hand ?)?(craft|make)|can i (hand ?)?craft|craftable|craft (right )?now|pick(ed)? up|debris|wreck\w*|materials)\b/i;
const BUILT = /\b(i (just |have |'ve )?(built|placed|put down|set up)|what (did|have) i (just )?(build|built|place|placed|make|made)|what you('ve| have)? ?(just )?(built|placed|made)|my (last|latest|new|recent) builds?|i just (made|build) (something|a|an|some))\b/i;
const LOOK = /\b(look around|look at (this|here|what)|what'?s (around|nearby|here|near me)|what is (around|nearby|here|near me)|around (me|here)|what do you see|what can you see|can you see|see what|surroundings|found (some |an? |the )?[\w -]{0,24}\b(ore|resources?|patch|water|oil|coal|stone|trees|rocks)|where('?s| is| are| can i find) (the |some )?(nearest |closest )?[\w -]{0,24}\b(ore|resources?|water|coal|stone|oil)\b|explore)\b/i;

export function wantsStartAdvice(text: string): boolean {
  return START.test(text);
}

export function wantsPlayerStatus(text: string): boolean {
  return START.test(text) || CARRY.test(text) || BUILT.test(text);
}

export function wantsSurroundings(text: string): boolean {
  return START.test(text) || LOOK.test(text) || BUILT.test(text);
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

/** "12 tiles north-east" from one map position to another (map y grows southward). */
export function bearing(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.round(Math.hypot(dx, dy));
  if (d <= 1) return "right here";
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return `${d} tiles ${COMPASS[(octant + 8) % 8]}`;
}

const thousands = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

export function formatPlayerStatus(s: PlayerStatus, opts: { builds?: boolean } = {}): string[] {
  if (!s.character) return ["player: no character right now (map or editor view without a body), so no inventory or hand crafting"];
  const lines = [
    `inventory (${s.total_items} kinds${s.total_items > s.items.length ? `, top ${s.items.length}` : ""}): ${s.items.length ? s.items.map((i) => `${i.name} ${i.count}`).join(", ") : "empty"}`,
  ];
  // Vanilla memory (and 1.x guides) says to craft a pickaxe or axe first; the answers repeated it (S22 eval).
  lines.push("the character mines rocks, trees and ore by hand: there are no axes or pickaxes");
  if (s.hand) lines.push(`in hand: ${s.hand.name} ${s.hand.count}`);
  lines.push(s.craftable.length
    ? `hand-craftable now from the inventory (most you could make): ${s.craftable.map((c) => `${c.name} ${c.count}`).join(", ")}${s.more_craftable ? " (and more)" : ""}`
    : "hand-craftable now: nothing, the inventory has no ingredients for any unlocked hand recipe");
  if (s.crafting_queue.length) lines.push(`crafting queue: ${s.crafting_queue.map((c) => `${c.name} ${c.count}`).join(", ")}`);
  if (opts.builds !== false) {
    const here = { x: s.x, y: s.y };
    lines.push(s.recent_builds.length
      ? `player's recent builds, newest first: ${s.recent_builds.slice(0, 10).map((b) => `${b.ghost ? `${b.name} ghost` : b.name} ${bearing(here, b)}${b.surface !== s.surface ? ` on ${b.surface}` : ""}, ${Math.round(b.age_ticks / 60)} s ago${b.still_there ? "" : " (gone now)"}`).join("; ")}`
      : "player's recent builds: none recorded yet");
  }
  return lines;
}

export function formatSurroundings(s: Surroundings): string[] {
  const here = { x: s.x, y: s.y };
  const named = (list: Surroundings["mine"]) => list.map((e) => `${e.name} ${e.count} (nearest ${bearing(here, e)})`).join(", ");
  const lines = [`what the player can see within ${s.radius} tiles of their character on ${s.surface}:`];
  lines.push(`- the player's own (built or owned): ${s.mine.length ? named(s.mine) : "nothing"}`);
  lines.push(`- resources: ${s.resources.length ? s.resources.map((r) => `${r.name} ${r.count} tiles, ${thousands(r.amount)} total (nearest ${bearing(here, r)})`).join(", ") : "none"}`);
  if (s.other.length) lines.push(`- other: ${named(s.other)}`);
  if (s.salvage.length) lines.push(`- inside ${s.salvage_containers} of those containers (mining one by hand takes what's inside): ${s.salvage.map((i) => `${i.name} ${i.count}`).join(", ")}`);
  lines.push(`- trees ${s.trees}, rocks ${s.rocks}, water tiles ${s.water_tiles}, enemies ${s.enemies}`);
  return lines;
}
