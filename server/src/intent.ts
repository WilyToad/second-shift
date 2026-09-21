// What the player is asking for, decided from their words (FC-198). Every classifier the turn uses lives here —
// the register tier, the build offer, the bare follow-up, the approval guard — so they can be read together and
// tested against each other (FC-199), instead of accumulating in agent.ts one session at a time.
import { wantsPackingList } from "./player";

/** A follow-up that points back instead of naming things: "what do I use these for?" (FC-153). */
export const REFERENCE = /\b(these|those|them|they|that one|this one)\b|\b(use|make|need|craft|do with|build|place|put|feed) (it|that)\b/i;
/**
 * A follow-up that names nothing of its own — "a bit further", "what about over there", "and to the left?" — which
 * only means something in terms of the last thing that was looked for (FC-187).
 *
 * The player asked about a red dot on the map, that turn was lost to FC-184, and their next words were "A bit
 * further". The answer searched 128 tiles north for labs and assembling machines, which nobody had mentioned for
 * two turns, and reported 0 of each. Anchored end to end on purpose: "further north, how many labs?" names its own
 * subject and must not be caught by this.
 */
export const BARE_FOLLOWUP = /^\s*(?:and\s+|ok(?:ay)?[,.]?\s+|so\s+|hmm[,.]?\s+)?(?:(?:a|just a)\s+(?:bit|little)\s+)?(?:what about\s+|how about\s+|try\s+|now\s+)?(?:further|farther|wider|more|again|out|over there|up there|down there|back there|(?:to the\s+)?(?:left|right|north|south|east|west)|keep (?:looking|going)|look again|search again|try again)\b(?:\s+(?:out|again|please|a bit|a little|now))?[\s?.!]*$/i;
/** Does this question lean entirely on the last search for its meaning? */
export function bareFollowUp(question: string): boolean {
  return BARE_FOLLOWUP.test(question);
}
/**
 * Does this question need a look at (or action in) the world near the player? Decided in code because
 * the model otherwise calls find_entities on recipe questions, adding a slow round trip. Tools stay in
 * the prompt either way (removing them changes the cached prefix); non-world turns get a note instead.
 */
export function needsWorldTools(question: string, hasLastResult: boolean): boolean {
  const q = question.toLowerCase();
  if (/\b(near|nearby|around me|next to me|close to me|here|to my|on my|of me|in view|on screen|visible|on the map)\b/.test(q)) return true;
  // "A big red dot on the map up there, that must be monsters" wasn't a world question at all, so the search it
  // wanted wasn't allowed (FC-204, found by the FC-199 corpus).
  if (/\b(monsters?|enem(?:y|ies)|biters?|spitters?|pentapods?|nests?|worms?|demolishers?)\b/.test(q)) return true;
  // Looking around and the player's own builds are world questions too (S22: "yeah, look around" got "I can't see").
  if (/\b(show me the way|which way|point me|guide me|how do i get to)\b/.test(q)) return true;
  if (/\b(look around|look at (this|here|that)|what'?s around|what do you see|what can you see|surroundings|explore|scan\w*|search wider|look (further|wider|farther))\b/.test(q)) return true;
  if (/\b(i (just |have |'ve )?(built|placed|put down)|what (did|have) i (just )?(build|built|place|placed|make|made))\b/.test(q)) return true;
  // "What's the nearest coal?" and "where is the rocket silo?" are looks, and neither word was here (FC-204).
  if (/\b(find|search|look for|highlight|show me|where('?s| is| are)|nearest|closest|count|which)\b/.test(q)) return true;
  if (/\b(mark|unmark|deconstruct\w*|remove|delete|clear|cancel|upgrade\w*|queue|start research\w*|research it|tag|pin|camera|jump|take me|paste|place|build it)\b/.test(q)) return true;
  if (/\b(set|switch|change)\b.*\b(to|recipe)\b/.test(q)) return true;
  if (/\b(screenshot|picture|photo|what does .+ look like)\b/.test(q)) return true;
  if (/\bhow many\b/.test(q) && !/\b(need|needs|take|takes|require|requires|make|makes|per)\b/.test(q)) return true;
  if (hasLastResult && /\b(them|those|these|it|that)\b/.test(q)) return true;
  return false;
}
/** The player asked to see a picture (FC-127). */
export const PICTURE = /\b(screenshot|screen shot|picture|photo|image|snapshot|what does .+ look like|show me what)\b/i;
/**
 * What the player's words (the question, or an offer they said yes to) must ask for before an action tool runs or
 * shows a card (FC-126). Unasked, the call is dropped and the model offers it in words instead: cards nobody asked
 * for ("I've dropped a tag, confirm it in the app") were noise. Looks (find_*) aren't listed: they always run.
 */
export const ASKS_FOR: Record<string, RegExp> = {
  screenshot: PICTURE,
  place_blueprint: /\b(paste|place (it|this|that|them)|put (it|this|that) (down|here|there)|build (it|this|that) (here|there|for me)|stamp|ghost (it|this|that|them))\b/i,
  mark_deconstruction: /\b(mark|deconstruct\w*|remove|delete|clear|tear (it |them |those )?down|get rid|demolish|take (it |them |those )?down)\b/i,
  cancel_deconstruction: /\b(cancel|unmark|undo|keep (it|them|those))\b/i,
  mark_upgrade: /\b(upgrad\w*|replace)\b/i,
  set_recipe: /\b(set|switch|change|swap)\b.*\b(recipe|to make|to craft|to produce|to)\b|\bmake (it|them|those|these) (make|craft|produce)\b/i,
  // "What do I need before I can research X?" is a question, not a request to queue it.
  queue_research: /\b(queue|start research\w*|begin research\w*|research (it|that|this|them)\b|go research|(want me to|can you|could you|will you|would you) research)|^\s*(please |ok,? |okay,? |yes,? )?research\b/i,
  // "Can you point it out to me" is asking for a map marker or a camera jump, and wasn't listed (FC-227).
  map_action: /\b(tag|pin|label|mark\w* (it |them |that |this |the [\w -]{1,24})?on (the |your |my )?map|map (tag|marker|pin)|(drop|put|place|add) a (marker|flag|pin)|marker|camera|jump|take me|go to|show me where|look at|point (it|that|them|this|him|her) (out|at)|point me (to|at)|point (to|at) (it|that|them|the))\b/i,
  set_train_stop: /\b(limit|priority|prioriti[sz]e|rename|name (it|them|those|these|the stops?)|call (it|them))\b/i,
  // Lists are the player's own plan, so the model only edits them when the words are about that (FC-126, FC-163).
  // Also a build the player is about to go and make ("I'm building an outpost, I need…"), which is a list even
  // when they don't use the word (FC-166).
  update_list: /\b(list|checklist|packing|pack|todo|to-do|remind\w*|add\b|added|remove\b|drop\b|cross (it |them )?off|tick\w* off|check\w* off|clear|rename|start (a|the) list|note (it |that )?down|shopping)\b|\b(building|build|set(ting)? up|putting up|outpost)\b[^.?!]{0,80}\b(need|bring|take|gather|grab)\b/i,
  show_the_way: /\b(show (me|you) the way|point(ing)? (me|you|the way|it out|them out|out|toward\w*|to|at)|which way|what direction|guide (me|you)|lead (me|you)|ping|arrow|how do i get to|direct (me|you)|way to)\b/i,
};
/** Is this tool call something the player asked for? Tools not listed in ASKS_FOR always are. */
export function askedFor(tool: string, intent: string): boolean {
  // A described build with amounts is the player asking for a packing list, whether or not they said "need" —
  // the model made the right call and the guard dropped it as unasked, twice, in the player's session (FC-214).
  if (tool === "update_list" && wantsPackingList(intent)) return true;
  return ASKS_FOR[tool]?.test(intent) ?? true;
}
/** A production target in the question ("60 bioflux per minute", "2/s") as items per minute, plus the words naming what. */
export function parseTarget(question: string): { perMinute: number; phrase: string } | null {
  // Up to four words may sit between the number and the unit: "60 electronic circuits per minute".
  const m = /(\d+(?:\.\d+)?)\s*((?:[a-z-]+\s+){0,4}?)(?:\/\s*|per\s+|an?\s+|each\s+|every\s+)(minute|min|m|second|sec|s)\b/i.exec(question);
  if (!m) return null;
  const n = Number(m[1]);
  return { perMinute: /^s/i.test(m[3]!) ? n * 60 : n, phrase: m[2]!.trim() };
}
export function targetRate(question: string): number | null {
  return parseTarget(question)?.perMinute ?? null;
}
/**
 * Where "me" is when the player is in remote view (FC-092, decided with the player): "here", "this" and "on screen"
 * follow where they're looking; "near me", "to my right" and "where I'm standing" follow their character. With
 * neither, searches use the character and placements (paste, tag, screenshot) use the view.
 */
export const CHARACTER_WORDS = /\b(near me|around me|next to me|close to me|by me|to my (left|right)|of me|where i'?m standing|where i am|my character)\b/i;
export const VIEW_WORDS = /\b(here|this spot|on (the )?screen|in view|where i'?m looking|what i'?m looking at)\b/i;
export function anchorFor(question: string, kind: "search" | "place"): "character" | "view" {
  if (CHARACTER_WORDS.test(question)) return "character";
  if (VIEW_WORDS.test(question)) return "view";
  return kind === "search" ? "character" : "view";
}
/** The question the server asks for the player when they select a build with the in-game tool (main.ts). */
export const SELECTED_PREFIX = "Review the build I just selected:";
export const SELECTED = /^Review the build I just selected:/;
export const BUILD = /\b(build|builds|building|set ?up|lay|run|place|make)\b[^.?!]{0,48}\b(lines?|belts?|rows?|bus|smelt\w*|furnaces?|ovens?|outposts?|malls?|factory|base|drills?|mine|walls?|defen[cs]\w*|plants?|assembl\w*|labs?|miners?)\b/i;
export const ASKED_TO_BUILD = /\b(can|could|will|would) you\b[^.?!]{0,24}\bbuild\b|\bbuild (me|us)\b/i;
/**
 * Is the player asking for a blueprint built to a rate? Either they said the word ("a blueprint for 120 gears per
 * minute"), or they asked for the thing itself at a rate ("build me 120 gears a minute") — which is the same
 * request, and used to fall through to prose because the word "blueprint" was missing (FC-172).
 */
export function wantsBlueprint(question: string): boolean {
  const rate = parseTarget(question) !== null;
  return rate && (/\b(blueprints?|layouts?|schematics?)\b/i.test(question) || BUILD.test(question) || ASKED_TO_BUILD.test(question));
}
/**
 * A question about what's actually around the player, which is answered with a count they act on. Being *allowed*
 * to use world tools isn't enough: "and how many for a red circuit?" permits a search and is still a lookup, and
 * treating it as a count silenced the character on ordinary follow-ups (caught by FC-182's own test).
 */
export const SPATIAL = /\b(near me|nearby|near here|around me|around here|to my (left|right|north|south|east|west)|on the map|how many [^?]*\b(near|around|here|there|left|right|north|south|east|west)\b|what'?s (around|nearby|here)|nearest|closest)\b/i;
/** Questions where something is happening to the player right now, and a remark would be an obstacle. */
// "help me… what do I do?" is a start question, not an alarm, and "quick question" isn't urgent: both used to be
// answered flat (FC-203, found by the FC-199 corpus). Monsters and enemies are threats and weren't listed.
export const URGENT = /\b(attack\w*|attacked|biters?|pentapods?|wriggler\w*|demolisher\w*|under fire|raid\w*|alarm|alert\w*|brownout|power (is )?(out|down|failing)|no power|out of ammo|low ammo|breach\w*|dying|destroyed|on fire|leak\w*|spoil\w*|starv\w*|monsters?|enem(?:y|ies)|nests?|hurry)\b/i;
/**
 * Should this answer be said flat, with no character in it at all (FC-179)?
 *
 * The player's rule: dry everywhere, flat when it counts. "When it counts" is anything they're about to act on —
 * an attack, a count, a readiness check, a card waiting for a confirm, a measurement, what they're pointing at,
 * what they're carrying. A wry line costs nothing on a recipe lookup and costs real time when it's read aloud
 * while a wall is being chewed on, so the tier is decided here rather than left to the model's judgement.
 */
export function plainAnswer(question: string, turn: { counted?: boolean; measured?: boolean; ready?: boolean; card?: boolean; stopped?: boolean; pointed?: boolean; stock?: boolean; packing?: boolean }): boolean {
  return URGENT.test(question) || Boolean(turn.counted || turn.measured || turn.ready || turn.card || turn.stopped || turn.pointed || turn.stock || turn.packing);
}
/**
 * Is the player asking for something to be built that isn't a row at a rate (FC-172)? Asked to "build a line up to
 * my metal", the answer was "I can only do what a player could do — I can't build belts or place entities for you",
 * which undersells it: it can build a production row in code and offer to paste it as ghosts behind a card, the same
 * way the player's own robots build. What's actually true is narrower and more useful than a flat refusal.
 */
export function wantsBuild(question: string): boolean {
  if (wantsBlueprint(question) || wantsPackingList(question)) return false; // a rate builds one; a load packs one
  return BUILD.test(question) || ASKED_TO_BUILD.test(question);
}
/** Is the player asking about a trend over time, where a rate_chart helps? */
export function wantsChart(question: string): boolean {
  return /\b(chart|graph|plot|trend\w*|over time|history|holding (steady|stable|up)|steady|stable|drop\w*|fall\w*|ris\w*|increas\w*|decreas\w*|slow\w* down|how('s| is) .+ doing)\b/i.test(question);
}
