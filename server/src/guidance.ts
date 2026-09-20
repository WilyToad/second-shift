// The turn's guidance to the model, decided in code (FC-198). Each line here was added when a session showed the
// model getting something wrong without it; the comments say which. The notes ride in the uncached tail of the
// turn, so the system prompt stays stable (PLAN §5).
//
// A pure function of what the turn found: nothing in here looks anything up, which is what makes it testable
// against a corpus of real questions (FC-199).

/** He may remark on being cut off once in this many interruptions; the rest pass without comment (FC-241). */
export const REMARK_EVERY = 3;
export const remarkDue = (interruptions: number, remarkedAt: number): boolean => interruptions - remarkedAt >= REMARK_EVERY;

export type TurnFacts = {
  question: string;
  /** The player spoke over the answer being read (FC-241): what he was on, whether they only said stop, and whether a remark is his to make this time. */
  interrupted?: { during: string; stopOnly: boolean; remark: boolean };
  /** Flat register: the player is about to act on this (FC-179). */
  plain: boolean;
  /** A measured line is in the turn: the machines' own craft counts (FC-162). */
  measured: boolean;
  /** World tools are allowed this turn. */
  world: boolean;
  /** The retrieved data or the player lines already answer the question. */
  answeredFromData: boolean;
  around: boolean;
  searchAgain: boolean;
  loot: string;
  chart: boolean;
  /** A bare follow-up carrying on the last search (FC-187). */
  carryOver: { label: string; where: string } | null;
  bare: boolean;
  /** A "what should I do" turn (stage direction, FC-181). */
  start: boolean;
  playerLines: boolean;
  character: boolean;
  recipeLines: boolean;
  craftable: boolean;
  /** The player is describing a build they're about to go and make, and there's no packing list yet (FC-166). */
  describingBuild: boolean;
  spoken: boolean;
  askedBuild: boolean;
  stage: { id: string; register: string };
  throwbackSpent: boolean;
  askedReady: boolean;
  packing: boolean;
  /** A list exists in the turn's tail (FC-219). */
  listActive: boolean;
  /** The question is about the list — its items, readiness, stock, or a build (FC-219). */
  aboutList: boolean;
  stock: boolean;
  /** The spidertron card is already up (FC-144). */
  cardUp: boolean;
  stopped: boolean;
  pointed: boolean;
  referred: string[];
  referenceWord: string;
};

function interruptionNote(f: TurnFacts): string {
  const it = f.interrupted;
  if (!it) return "";
  const on = it.during ? ` while you were saying "${it.during}"` : " while you were reading your answer";
  if (it.stopOnly) return `the player cut you off${on} with just "${f.question}": one short line about being stopped, in character, then wait; nothing about what you were saying`;
  return `the player cut in${on} and said this instead: answer it, and don't resume or restate what you were saying${it.remark ? "; you were mid-thought, so one dry line about being cut off first is yours to take, or not" : ""}`;
}

export function turnNotes(f: TurnFacts): string[] {
  return [
    interruptionNote(f),
    // Was "say this one flat: …", which the model echoed as a heading ("Numbers, flat:") — the player heard it (FC-212).
    f.plain ? "keep this answer plain and don't announce that you're doing so: only the facts, the numbers, or what to confirm; no aside, no remark, nothing about yourself, the ship or the manifest" : "",
    f.world || !f.answeredFromData ? "" : "no tool call is needed",
    // With a fresh look already in the lines, the model still searched twice, narrating "let me scan wider" (S22 eval).
    f.around && !f.searchAgain ? "the surroundings lines are a fresh look, so don't search again unless the player asks for a wider search" : "",
    f.loot,
    f.chart ? "" : "no chart block",
    f.searchAgain ? "call find_entities again for this question, even if an earlier result looks similar" : "",
    // "A bit further" answered with a search for labs and assembling machines, which nobody had mentioned for two
    // turns, and reported 0 of each (FC-187).
    f.carryOver ? `"${f.question.trim()}" carries on the last search, which was for ${f.carryOver.label} ${f.carryOver.where}: look for ${f.carryOver.label} again, wider or in the direction they said, and say what you searched for so they can tell you if it's the wrong thing` : "",
    f.bare && !f.carryOver ? `"${f.question.trim()}" names nothing of its own and there's no earlier search to carry on, so ask what they want looked for — don't pick something` : "",
    f.start ? "base next steps only on the stage, inventory, hand-craftable, recipe, surroundings and research lines; name no item, building or technology that isn't in them"
      : f.playerLines ? "name no item, building or technology that isn't in the lines above" : "",
    // "That's 50 iron plates from the debris" with 1 in the inventory (FC-140).
    f.character ? "any count of what the player has comes from the inventory line, exactly" : "",
    // "look around" answered with "burner-inserter (1 iron-plate + 1 gear)" from an earlier turn's memory (S24 eval).
    f.playerLines && !f.recipeLines && !f.craftable ? "give no recipe ingredients or amounts: this turn has no recipe lines" : "",
    // "25,000 units each, 1,250,000 total" for storage tanks: neither number is in the save data (FC-153).
    // The card is put up in code, so the model has to know it exists: it answered "I can't move it for you"
    // while the player was looking at the card (FC-144).
    // It answered "items in chests aren't findable as entities, so I used the container scan" — the player
    // doesn't care how it looked (FC-165).
    // It answered the player's own example with a list that dropped the belts and the chests (FC-166).
    f.describingBuild ? "the player is describing a build they're about to go and make: start a packing list with every single thing they named, one line each, count first (\"20 stone furnace\"), rounding vague amounts up generously and saying the assumption; add nothing else yourself" : "",
    // Speech recognition mis-hears words ("wire" as "wine", "dots" as "darts"): read the odd one as a mis-hear
    // rather than a fact, and ask if it changes the answer (FC-175).
    f.spoken ? "this question was spoken and turned into text, so a word that makes no sense in Factorio is probably a mis-hear: answer what they plainly meant, and only ask if the wrong word changes the answer" : "",
    // "I can't build belts or place entities for you" for a belt run, then a plan in words anyway (FC-172).
    f.askedBuild ? "the player is asking for something to be built: say what you can actually do — build a blueprint in code for one production row (machines for a single item, with inserters, an input belt, an output belt and poles) and offer to paste it as ghosts where they stand, on a card they confirm — rather than saying you can't place anything" : "",
    f.askedBuild ? "and the real limits: there's no template for a belt run between two points or a mixed layout, and ghosts are built by construction robots, so before robots a paste would sit unbuilt and a plan in words is the honest offer" : "",
    f.start ? `say which stage you think they're in ("${f.stage.id}") so they can tell you if you've got it wrong, then give the stage's own next steps in your words, shortest first — the whole row won't fit, so drop the last goal before you drop the first` : "",
    // The arc (FC-182): the register follows the factory, not the clock, and the past surfaces at most once a
    // session — rate-limited in the agent because the model can't count sessions, and never on a turn like this one.
    f.plain ? "" : `your register here: ${f.stage.register}`,
    f.plain || f.throwbackSpent ? "" : "you may let one clause of your own past show in this answer, if it fits the sentence you were already writing; don't add a sentence for it, and don't explain yourself",
    f.askedReady ? "answer with what's still missing and whether the load fits the player's free slots, both from the lines" : "",
    f.packing && f.aboutList ? "the list lines are the truth about the list: don't restate items as done unless they're ticked, and to change a count use the list tool's set, never another line" : "",
    // Asked "do you ever miss flying?", it answered and then added "The list is 0 of 4 done: 1 of 20 furnace…" — the
    // list rides in every turn so it can answer list questions, not so it can report on it unasked (FC-219).
    f.listActive && !f.aboutList ? "the player's list isn't in this turn: don't mention the list or its progress unless the question is about it" : "",
    // Asked for a real rate with the measurement in the lines, it answered about idle labs from the diagnosis hint
    // instead — "lead with the root cause" outranked the thing they asked (FC-223, the player's session 2026-09-18).
    f.measured ? "the measured line answers a rate question: quote its per-minute numbers and machine counts first and say they were measured from the machines' own craft counts, not estimated; any diagnosis hint comes after, in one clause at most" : "",
    f.stock ? "the stock line is a fresh read of what the player carries and what's in the containers they can see: answer from it, don't search, and don't explain how you looked" : "",
    f.cardUp ? "the card asking them to confirm sending the spidertron is already up: tell them to confirm or cancel it in the app, and don't say you can't move it" : "",
    f.stopped ? "say what the stop line says happened, in a few words" : "",
    // "Requester chests won't pull from it" about a passive provider chest: wrong, and nobody asked (FC-160).
    f.pointed ? "name the thing and give only the save's own facts about it; don't explain how it works unless they ask, and if they ask something the facts don't cover, say that part is from the base game and mods can change it" : "",
    f.referred.length ? `"${f.referenceWord}" means ${f.referred.join(", ")} from the last answer; give no capacities, sizes, totals or other numbers that aren't in the lines, and if one is asked for, say the save data doesn't have it` : "",
  ].filter(Boolean);
}
