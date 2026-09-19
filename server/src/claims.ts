// Claims of an action that didn't happen (FC-229). The diagnosis eval caught "The 6 are highlighted in-game for
// 60 s" on a turn with no tool call at all: the model knew what the tool would have done and said it had done it.
// An invented count gets a correction line (FC-140); an invented action deserves one at least as much, because the
// player will go and look for the highlight.
//
// Deliberately narrow: only past-tense claims about this turn, each tied to the tools that could make it true.
const CLAIMS: { says: RegExp; needs: string[]; correction: string }[] = [
  { says: /\b(are|is|now|I'?ve|have|been|got them|got it) highlighted\b|\bhighlighted (in-game|in game|for you|them|it)\b/i, needs: ["find_entities", "find_stuck_machines"], correction: "Correction: nothing was highlighted this turn — I didn't run a search." },
  { says: /\b(marked|tagged|pinned|dropped a (marker|pin|flag)) on (the|your|my) map\b|\bmap (tag|marker|pin) (is|was) (placed|dropped|added)\b/i, needs: ["map_action"], correction: "Correction: nothing was marked on the map this turn." },
  // "Nothing is queued" is a report, not a claim: the claim needs an agent ("I've queued", "queued it for you").
  { says: /\b(I'?ve|I have|I just|just) queued\b|\bqueued (it|that|them|the research|[\w-]+ for you)\b|\bresearch (has been|was) queued\b/i, needs: ["queue_research"], correction: "Correction: nothing was queued this turn — say the word and I'll queue it." },
  { says: /\b(pasted|placed) (it|them|the ghosts|the blueprint|ghosts)\b/i, needs: ["place_blueprint"], correction: "Correction: nothing was pasted this turn; a paste puts up a card to confirm first." },
];

/** Corrections for actions the answer says happened that no tool of this turn performed. */
export function actionClaims(text: string, toolsRun: string[]): string[] {
  const ran = new Set(toolsRun);
  return CLAIMS.filter((c) => c.says.test(text) && !c.needs.some((t) => ran.has(t))).map((c) => c.correction);
}
