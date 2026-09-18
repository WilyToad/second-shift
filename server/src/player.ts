// The player's own situation, fetched only when a question needs it (S22): what they carry and can
// hand-craft, what they built, what they can see around them. Decided and formatted in code, sent in
// the uncached tail, never in the system prompt.
import type { ContainerContents, LogisticNetwork, MachineOutput, PlayerStatus, PointedAt, SeenEntity, Spidertrons, Stock, Surroundings } from "@companion/interfaces";

const AFFIRMATIVE = /^\s*(y|yes|yeah|yea|yep|yup|sure|ok|okay|please|go ahead|do it|go for it|sounds good|absolutely|definitely|why not)\b[\s\w,.!']{0,30}$/i;

/**
 * "yeah" after "Want me to look around?" means "look around". Returns the questions the last answer
 * asked, so the reply can be classified as what they offered. Null when the reply isn't a short yes or
 * the last answer offered nothing.
 */
export function acceptedOffer(question: string, lastAnswer: string | undefined): string | null {
  if (!lastAnswer || !AFFIRMATIVE.test(question)) return null;
  // Every question in the answer: offers come split ("Want me to look around for ore? Wider, say 64 tiles?").
  const offers = lastAnswer.match(/[^.!?\n]*\?/g);
  return offers ? offers.map((o) => o.trim()).join(" ") : null;
}

// "I meant the rocket silo", "no, the red chest", "try that again": short follow-ups that fix or repeat the last question.
const CORRECTION = /^\s*(no[,.]?\s+|nope[,.]?\s+|sorry[,.]?\s+|oh[,.]?\s+)*(i meant|i mean|i said|actually,?\s+(i meant|i mean|the|it'?s|its|no)\b|not (that|this|those|the)\b|the other|(try|do) (it|that|this) again|again\b|the \w+ (one|instead)|instead)/i;
const CORRECTION_MAX_WORDS = 10;

/**
 * "Where's the rocket salad? Point it out" then "I meant the rocket silo": the correction keeps the request (FC-154).
 * Returns the previous question when this one is a short correction or retry of it, so both classify the turn.
 */
export function correctedRequest(question: string, lastQuestion: string | undefined): string | null {
  if (!lastQuestion || question.trim().split(/\s+/).length > CORRECTION_MAX_WORDS) return null;
  const q = question.trim();
  return CORRECTION.test(q) || /^\s*no[,.]?\s+the\b/i.test(q) ? lastQuestion.trim() : null;
}

const START = /\b(what (should|do|can) i do|what (should|do|can) i (build|make|craft|place|set up|work on|focus on) (next|now|first)|what to build (next|first)|help me|i need help|get(ting)? started|where (do|should) i (start|begin)|what now|what next|what'?s next|next steps?|first steps?|just (started|landed|crashed|spawned)|new (game|map)|how do i (start|begin))\b|^\s*help\b/i;
// "How do I craft X?" is a recipe question; only what the player can craft or has counts here.
const CARRY = /\b(inventory|carrying|holding(?! (steady|stable|up|on|back|out))|in my hands?|what do i have|have on me|what (can|could|should) i (hand ?)?(craft|make)|can i (hand ?)?craft|craftable|craft (right )?now|pick(ed)? up|debris|wreck\w*|materials)\b/i;
const BUILT = /\b(i (just |have |'ve )?(built|placed|put down|set up)|what (did|have) i (just )?(build|built|place|placed|make|made)|what you('ve| have)? ?(just )?(built|placed|made)|my (last|latest|new|recent) builds?|i just (made|build) (something|a|an|some))\b/i;
const LOOK = /\b(scan\w*|search (wider|further|around|for (ore|resources?|coal|iron|copper|stone|trees))|look (further|wider|farther)|look around|look at (this|here|what)|what'?s (around|nearby|here|near me)|what is (around|nearby|here|near me)|around (me|here)|what do you see|what can you see|can you see|see what|surroundings|found (some |an? |the )?[\w -]{0,24}\b(ore|resources?|patch|water|oil|coal|stone|trees|rocks)|where('?s| is| are| can i find) (the |some )?(nearest |closest )?[\w -]{0,24}\b(ore|resources?|water|coal|stone|oil)\b|explore)\b/i;

export function wantsStartAdvice(text: string): boolean {
  return START.test(text);
}

export function wantsPlayerStatus(text: string): boolean {
  return START.test(text) || CARRY.test(text) || BUILT.test(text);
}

// Loot talk needs the wreckage line: without it, answers called the loot "scrap" (FC-141).
const SALVAGE = /\b(debris|wreck\w*|crash(ed)? ?(site|ship)|salvage|loot\w*)\b/i;

export function wantsSurroundings(text: string): boolean {
  return START.test(text) || LOOK.test(text) || BUILT.test(text) || SALVAGE.test(text);
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

/** "12 tiles north-east" from one map position to another (map y grows southward). */
export function bearing(from: { x: number; y: number }, to: { x: number; y: number }): string {
  // Whole tiles on both ends: every line measures the same way, so a thing on a compass boundary doesn't flip
  // between "west" and "north-west" from one lookup to the next (FC-157).
  const dx = Math.floor(to.x) - Math.floor(from.x), dy = Math.floor(to.y) - Math.floor(from.y);
  const d = Math.round(Math.hypot(dx, dy));
  if (d <= 1) return "right here";
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return `${d} tiles ${COMPASS[(octant + 8) % 8]}`;
}

const thousands = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** Recipes for what the player can hand-craft now, so ingredient claims come from the save (FC-139). */
export function craftableRecipes(s: PlayerStatus | null, max = 10): string[] {
  return s?.character ? s.craftable.slice(0, max).map((c) => c.name) : [];
}

/**
 * A turn note when wreckage loot is in view and nothing called scrap is (FC-141): the model kept calling crash-site
 * loot "scrap" from memory. Scrap is a real Space Age item (Fulgora), so the note is skipped whenever the data has it.
 */
export function lootNote(status: PlayerStatus | null, around: Surroundings | null): string {
  if (!around?.salvage.length) return "";
  const names = [...(status?.items ?? []), ...(status?.craftable ?? []), ...around.salvage, ...around.resources, ...around.other, ...around.mine].map((x) => x.name);
  return names.some((n) => /scrap/.test(n)) ? "" : `wreckage loot is ${around.salvage.map((i) => i.name).join(", ")}: use those item names and never call it scrap`;
}

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
  // The nearest one's position too: without it an answer made up "roughly (-5, 0)" for a silo (FC-157).
  const at = (p: { x: number; y: number }) => `${bearing(here, p)} at (${Math.floor(p.x)}, ${Math.floor(p.y)})`;
  const named = (list: Surroundings["mine"]) => list.map((e) => `${e.name} ${e.count} (nearest ${at(e)})`).join(", ");
  const lines = [`what the player can see within ${s.radius} tiles of their character on ${s.surface}:`];
  lines.push(`- the player's own (built or owned): ${s.mine.length ? named(s.mine) : "nothing"}`);
  const reach = s.resource_radius && s.resource_radius > s.radius ? ` (none within ${s.radius} tiles, so looked out to ${s.resource_radius})` : "";
  lines.push(`- resources${reach}: ${s.resources.length ? s.resources.map((r) => `${r.name} ${r.count} tiles, ${thousands(r.amount)} total (nearest ${at(r)})`).join(", ") : "none"}`);
  if (s.other.length) lines.push(`- other: ${named(s.other)}`);
  // Answers said wreckage gives "scrap" (a Fulgora item) until the contents were listed as the only loot (S22 eval).
  if (s.salvage.length) lines.push(`- wreckage and other containers here hold only: ${s.salvage.map((i) => `${i.name} ${i.count}`).join(", ")} (in ${s.salvage_containers}; still inside the wreckage, not in the player's inventory; mining one by hand takes those items and nothing else)`);
  lines.push(`- trees ${s.trees}, rocks ${s.rocks}, water tiles ${s.water_tiles}, enemies ${s.enemies}`);
  return lines;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const itemKey = (s: string) => s.toLowerCase().replace(/[*_`]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim().replace(/(ch|sh|x)es$/, "$1").replace(/([^s])s$/, "$1");

/**
 * Corrections for what an answer says the player has or built, checked against their data after the answer
 * (FC-140). Turn notes cut these down but the model still wrote "Your inventory: … iron-plate 7" with 1 held.
 * Only sentences about the player's own inventory or builds are checked; `known` are item names in the save.
 */
export function claimCorrections(text: string, status: PlayerStatus, known: Set<string>, opts: { inventoryTurn?: boolean } = { inventoryTurn: true }): string[] {
  const held = new Map(status.items.map((i) => [itemKey(i.name), i]));
  const knownKeys = new Map([...known].map((n) => [itemKey(n), n]));
  const plain = text.replace(/[*_`]/g, "");
  const out = new Map<string, string>();
  const NAME = "([a-z][a-z-]*(?: (?!and\\b|or\\b|plus\\b|with\\b|from\\b|to\\b)[a-z][a-z-]*){0,3})";
  const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)";
  // The longest leading run of words that names an item: "iron plates still inside" -> "iron plate".
  const resolve = (name: string) => {
    const words = name.split(/\s+/);
    for (let j = words.length; j > 0; j--) {
      const key = itemKey(words.slice(0, j).join(" "));
      if (held.has(key) || knownKeys.has(key)) return key;
    }
    return undefined;
  };
  const claim = (n: string, name: string) => {
    const key = resolve(name);
    if (!key || out.has(key)) return;
    const count = /\d/.test(n) ? Number(n) : NUMBER_WORDS[n.toLowerCase()]!;
    const item = held.get(key);
    if ((item?.count ?? 0) !== count) out.set(key, `${item?.name ?? knownKeys.get(key)} ${item?.count ?? 0}`);
  };
  // Only explicit statements about the player's pockets (FC-140). Suggestions ("craft 1 gear"), loot in the
  // wreckage and distances ("the coal 73 tiles north") aren't claims. "You have 47 labs" on a big base means the
  // factory, so plain "you have" counts only on turns about the inventory.
  if (opts.inventoryTurn) {
    for (const m of plain.matchAll(new RegExp(`(?<!\\b(?:once|when|if|until|after|before|unless|as soon as) )\\b(?:you(?: now)? have|you'?ve (?:now )?got|you(?:'re| are) (?:now )?(?:carrying|holding)|you hold) (?:only |just |exactly )?${NUM} ${NAME}([^.!?\\n]*)`, "gi"))) {
      claim(m[1]!, m[2]!);
      for (const more of m[3]!.matchAll(new RegExp(`(?:,|\\band) ${NUM} ${NAME}`, "gi"))) claim(more[1]!, more[2]!);
    }
  }
  for (const m of plain.matchAll(new RegExp(`\\b${NUM} ${NAME} (?:in|into) your (?:inventory|pack|pockets?)`, "gi"))) claim(m[1]!, m[2]!);
  for (const m of plain.matchAll(/\binventory(?: has| holds| shows| now has)?:? ((?:[a-z][a-z-]* \d+(?:, | and |,? )?){1,12})/gi)) {
    for (const pair of m[1]!.matchAll(/([a-z][a-z-]*) (\d+)/gi)) claim(pair[2]!, pair[1]!);
  }
  const corrections: string[] = [];
  if (out.size) corrections.push(`Correction: your inventory has ${[...out.values()].join(", ")}.`);
  // Builds the answer says the player made must be in their build record.
  const built = new Set(status.recent_builds.map((b) => itemKey(b.name)));
  const phantom = [...text.replace(/[*_`]/g, "").matchAll(/\byou(?:'ve| have)? (?:just )?(?:built|placed|put down|set up) (?:a |an |your |the )([a-z][a-z0-9 -]{2,40}?)(?= \d| tiles|,|\.|!| to | at | near | next | on | south| north| east| west| —|$)/gi)]
    .map((m) => itemKey(m[1]!))
    .filter((k) => knownKeys.has(k) && !built.has(k));
  if (phantom.length) {
    const recent = status.recent_builds.slice(0, 3).map((b) => b.name);
    corrections.push(`Correction: no ${[...new Set(phantom)].map((k) => knownKeys.get(k)).join(" or ")} was built recently${recent.length ? `; your latest builds are ${recent.join(", ")}` : ""}.`);
  }
  return corrections;
}

// "What is this?", "what am I holding?", "can you see what I have highlighted?" (FC-151).
const POINTING = /\b(what('?s| is| are) (this|that|these|those|it)\b|what am i (looking at|pointing at|pointing to|hovering( over)?|holding|selecting|carrying in my hand)|(under|at) (my|the) (cursor|mouse)|highlight\w*|hover\w*|selected|select\w* (this|that)|this (thing|building|machine|entity|chest|box|container|one|item)|that (thing|building|machine|entity|chest|box|container|one)|in my hands?|holding(?! (steady|stable|up|on|back|out))|(have|got) open|this (window|screen|menu)|what do i have open)\b/i;
// "What's in this chest?", "what does that wagon hold?" (FC-152).
const CONTENTS = /\b(what('?s| is)? in(side)? (it|this|that|there|the)\b|contents?|what does (it|this|that|the [\w -]{1,24}) (have|hold|contain|store)|how (much|many) [\w -]{1,30} (is |are )?in (it|this|that|there|the))/i;

export function wantsPointedAt(text: string): boolean {
  return POINTING.test(text) || CONTENTS.test(text);
}

// "Is this build hitting 150 a minute?", "what's it really making?" (FC-162).
const MEASURED = /\b(hitting|really (making|producing|putting out)|actual(ly)? (rate|making|producing|output)|real (rate|output|numbers?)|measure\w*|keeping up|per minute really|how much is (it|this|that) (really )?(making|producing))\b/i;

export function wantsMeasuredOutput(text: string): boolean {
  return MEASURED.test(text);
}

export function wantsContents(text: string): boolean {
  return CONTENTS.test(text);
}

const seen = (e: SeenEntity) => `${e.ghost ? `${e.name} ghost` : e.name} at (${e.x}, ${e.y})${e.own ? "" : e.type === "tree" || e.type === "simple-entity" || e.type === "resource" ? "" : " (not the player's)"}`;
const agoS = (ticks: number) => `${Math.max(1, Math.round(ticks / 60))} s ago`;
/** Hovers older than this aren't "what the player means" any more. */
const HOVER_FRESH_TICKS = 120 * 60;

/**
 * Lines for what the player points at, hovered last, holds and has open; each says "nothing" rather than leaving a
 * gap to guess into. `facts` adds what the save says about the thing itself (FC-160), so answers about how it
 * behaves don't come from the model's memory of vanilla.
 */
export function formatPointedAt(p: PointedAt, facts?: (name: string) => string | null): string[] {
  const lines = [`under the mouse now: ${p.selected ? seen(p.selected) : "nothing"}`];
  const last = p.last_hovered;
  if (last && last.ago_ticks <= HOVER_FRESH_TICKS && !(p.selected && last.name === p.selected.name && last.x === p.selected.x && last.y === p.selected.y)) {
    lines.push(last.still_there && last.name ? `last hovered: ${seen(last as SeenEntity)}, ${agoS(last.ago_ticks)}` : `last hovered: something that's gone now, ${agoS(last.ago_ticks)}`);
  }
  lines.push(`in hand: ${p.hand ? `${p.hand.name} ${p.hand.count}` : p.hand_ghost ? `${p.hand_ghost} (ghost cursor, none carried)` : "nothing"}`);
  const o = p.opened;
  lines.push(`open window: ${!o ? "none" : o.entity ? seen(o.entity) : o.item ? `the ${o.item} item` : o.kind === "controller" ? "the player's inventory screen" : `the ${o.kind.replace(/_/g, " ")} screen`}`);
  if (!p.selected && !(last?.still_there && last.ago_ticks <= HOVER_FRESH_TICKS) && !o?.entity) {
    lines.push("nothing is pointed at: if they ask what \"this\" is, say you can't tell and ask them to hover over it");
  }
  if (facts) {
    const names = [p.selected?.name, last?.still_there ? last.name : undefined, o?.entity?.name, p.hand?.name, p.hand_ghost].filter((n): n is string => Boolean(n));
    for (const line of new Set(names.map(facts).filter((l): l is string => Boolean(l)))) lines.push(`from the save: ${line}`);
  }
  return lines;
}

/** Which entity "this chest" means: under the mouse, then open, then hovered in the last minute. */
export function contentsTarget(p: PointedAt | null, lastFound?: { name: string; x: number; y: number } | null): { name: string; x: number; y: number } | null {
  if (p?.selected) return p.selected;
  if (p?.opened?.entity) return p.opened.entity;
  const last = p?.last_hovered;
  if (last?.still_there && last.name && last.x !== undefined && last.y !== undefined && last.ago_ticks <= 60 * 60) return { name: last.name, x: last.x, y: last.y };
  return lastFound ?? null;
}

export function formatContents(c: ContainerContents): string {
  const items = c.items.map((i) => `${i.name}${i.quality ? ` (${i.quality})` : ""} ${i.count}`).join(", ");
  const more = c.total_kinds > c.items.length ? ` and ${c.total_kinds - c.items.length} more kinds` : "";
  const fluids = c.fluids.length ? `; fluids: ${c.fluids.map((f) => `${f.name} ${f.amount}`).join(", ")}` : "";
  return `inside the ${seen(c.entity)}: ${items || "no items"}${more}${fluids}`;
}

/** Measured output of the machines the player asked about (FC-162), or what to say when the clock just started. */
export function formatMachineOutput(m: MachineOutput, where: string): string {
  if (!m.machines) return `no machines of the player's own are in ${where}${m.not_visible ? `, and ${m.not_visible} are somewhere they can't see` : ""}, so nothing was measured`;
  const seconds = Math.round(m.window_ticks / 60);
  const measured = m.recipes.filter((r) => r.per_minute !== undefined);
  if (!measured.length) {
    return `started measuring ${m.machines} machines in ${where} just now (their own craft counts): ask again in about a minute and the answer will be the real rate`;
  }
  const lines = measured.map((r) => `${r.recipe} ${Math.round(r.per_minute!)}/min from ${r.sampled} machine${r.sampled === 1 ? "" : "s"}`);
  return `measured in the player's game over the last ${seconds} s from the machines' own craft counts: ${lines.join(", ")}`;
}

// "Send my spidertron to the copper patch", "walk the spider over here" (FC-144).
const SEND_SPIDER = /\b(send|walk|move|drive|take|bring|get)\b[^.?!]{0,40}\b(spidertron|spider)\b|\b(spidertron|spider)\b[^.?!]{0,40}\b(go|head|walk|move|over)\b/i;
// "Stop", "stop it", "cancel that", "halt" — the words that take it back (FC-051).
const STOP_CONTROL = /^\s*(please\s+)?(stop|halt|abort|cancel|freeze|hold on|wait)\b[\s\w,.!']{0,24}$|\b(stop|cancel|abort) (it|that|the spidertron|the spider|moving|walking|him|her|them)\b/i;

export function wantsSpidertronSent(text: string): boolean {
  return SEND_SPIDER.test(text);
}

export function wantsStop(text: string): boolean {
  return STOP_CONTROL.test(text);
}

/** Lines about the player's spidertrons, so answers about them come from the game (FC-144). */
export function formatSpidertrons(s: Spidertrons): string[] {
  if (!s.spidertrons.length) return [`the player has no spidertron on ${s.surface}`];
  const lines = s.spidertrons.map((x) => `${x.name} at (${x.x}, ${x.y}), ${x.distance} tiles away${x.driver ? ", someone is driving it" : ""}${x.walking_to ? `, already walking to (${x.walking_to.x}, ${x.walking_to.y})` : ""}`);
  return [
    `the player's spidertrons on ${s.surface}, nearest first: ${lines.join("; ")}${s.total > s.spidertrons.length ? ` (+${s.total - s.spidertrons.length} more)` : ""}`,
    s.has_remote ? "the player carries a spidertron remote, so they could send it themselves" : "the player carries no spidertron remote, so sending one isn't something they could do right now",
  ];
}

// "Where are my 200 steel?", "how many belts do I have around here?" (FC-165).
const STOCK = /\b(where (are|is|can i find) (my|the|some)|how many .{0,30}\b(do i have|have i got|are (there )?(around|nearby|here))|do i have (enough|any)|what('?s| is| do i have) (in|around) (my|the) (chests|boxes|base)|stock|stockpile|supplies|do we have)\b/i;

export function wantsStock(text: string): boolean {
  return STOCK.test(text);
}

/** Lines for what the player can reach: carried first, then the nearest container holding each thing. */
export function formatStock(s: Stock, only?: string[]): string[] {
  const wanted = only?.length ? s.items.filter((i) => only.some((name) => i.name === name)) : s.items;
  if (!wanted.length) {
    return [`nothing the player can reach within ${s.radius} tiles${only?.length ? ` matches ${only.join(", ")}` : ""} (${s.containers} containers read, ${s.free_slots} free inventory slots)`];
  }
  const lines = wanted.slice(0, 12).map((i) => {
    const where = i.carried === i.count ? "all carried"
      : i.carried > 0 ? `${i.carried} carried, the rest nearest in a ${i.container} ${i.distance} tiles away at (${i.x}, ${i.y})`
      : `none carried, nearest in a ${i.container} ${i.distance} tiles away at (${i.x}, ${i.y})`;
    return `${i.name}${i.quality ? ` (${i.quality})` : ""} ${i.count} (${where})`;
  });
  return [
    `what the player can reach within ${s.radius} tiles of (${s.x}, ${s.y}) on ${s.surface}, from ${s.containers} containers they can see${s.not_visible ? ` (${s.not_visible} more are somewhere they can't see)` : ""}: ${lines.join("; ")}`,
    `${s.total_kinds > wanted.length ? `${s.total_kinds} kinds in reach in all; ` : ""}${s.free_slots} free slots in the player's inventory`,
  ];
}

// "Am I ready?", "what am I still missing?" — the question the packing list exists for (FC-166).
const READY = /\b(am i ready|are we ready|ready to (go|head|build|leave)|what('?s| is| am i) (still )?(missing|short)|what do i still need|do i have everything|anything (else )?missing|good to go)\b/i;
// Talk about the list at all, which is when a packing list is worth re-checking against what the player carries.
const LIST_TALK = /\b(list|packing|pack|checklist|todo|to-do|add\b|remove\b|cross off|tick off|check off|got the|picked up|grabbed)\b/i;

export function wantsReady(text: string): boolean {
  return READY.test(text);
}

export function wantsListTalk(text: string): boolean {
  return LIST_TALK.test(text);
}

// "I'm building a new smelting outpost. I need about 20 ovens, a couple hundred belt…" — the shape of a build
// the player is about to walk out and make (FC-166).
const BUILD_PLAN = /\b(building|build|set(ting)? up|putting up|outpost|new base|expansion)\b/i;

export function wantsPackingList(text: string): boolean {
  return BUILD_PLAN.test(text) && /\b(need|bring|take|pack|list|gather|grab)\b/i.test(text);
}

// "Fill the list", "get the bots to bring it", "ask the bots for the rest" (FC-168).
const FILL = /\b(fill (it|this|the list|my inventory)|get the (bots|robots)|(have|ask) the (bots|robots)|request (it|them|the list|these|the (missing|rest|remaining)[\w ]{0,12})|bots? (bring|fetch|deliver)|logistic requests?)\b/i;
// "Stop requesting", "clear the requests", "cancel the request" (FC-168).
const UNFILL = /\b(stop (requesting|the requests?)|clear (the )?requests?|cancel (the )?requests?|don'?t request|remove (the )?requests?)\b/i;

export function wantsBotsToFill(text: string): boolean {
  return FILL.test(text) && !UNFILL.test(text);
}

export function wantsRequestsCleared(text: string): boolean {
  return UNFILL.test(text);
}

/** What the player's own network can do about the list, so a promise is honest (FC-168). */
export function formatNetwork(n: LogisticNetwork): string[] {
  if (!n.in_range) return ["the player isn't in range of their logistic network, so bots can't bring anything: say so rather than offering"];
  return [
    `the player's logistic network is in range: ${n.available_robots} of ${n.robots} logistic robots free, ${n.total_kinds} item kinds in it`,
    n.trash_unrequested ? "the player has \"trash unrequested\" on, so anything not requested is taken back out of their inventory: warn them if the list needs items the requests won't cover" : "",
  ].filter(Boolean);
}
