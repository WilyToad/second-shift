# S16 — Fewer model misses

- **Status:** active
- **Goal:** Rules the code can enforce don't depend on the model obeying them, and misses that still happen can be studied.
- **Acceptance:** Chart blocks are removed in code on turns that don't allow them. Questions naming something that doesn't exist in the save get that fact as a data line. Every eval and e2e script records the full answer for a failing check. The suites with misses in FC-110 (blueprint review, throughput, grounding, ratios, diagnosis) each pass 3 runs in a row on a server running this code, or the remaining misses are recorded with their answers.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-111 Remove disallowed chart blocks in code
  - Acceptance: a streaming filter drops `rate_chart` blocks, including fences split across tokens, when the turn doesn't allow charts; the page and history never see them; unit tests over every split point
  - `server/src/stream-filter.ts`: holds back text only while it could still become ```` ```rate_chart ````, drops the block through its closing fence, and passes other code and inline backticks through. Unit tests split a real answer at every character, plus one token per character; an agent test checks that neither the page nor the history sees the block. Turns that allow charts are unchanged (the server's fallback chart still applies)
- [x] FC-112 Say when a named thing doesn't exist
  - Acceptance: "craft/make/recipe for X" where X matches nothing in the save adds a `[save data: nothing named "X" in this save]` line; unit test; grounding's negative case passes 3 runs
  - `RecipeRetriever.unknownName`: the phrase after "craft / recipe for / make a / build a" or in "what does X need" is unknown when it matches nothing and its last word appears in no name in the save, so "gear wheels for the mall" still counts as known. The line reads `[save data: no item, fluid, recipe or building in this save is named "X"; if it's a nickname, ask which item they mean]`. On the real save's data, "quantum widget", "flux capacitor", "warp drive" and "blue chips" were flagged, and 13 real phrasings were not. "blue chips" is slang, so green/red/blue "chip" aliases were added. Unit and agent tests
- [x] FC-113 Keep failing answers from evals
  - Acceptance: grounding, ratios, diagnosis, blueprint and throughput scripts write each run's checks with full answers to `data/eval/` so a miss can be read afterwards
  - `scripts/lib/eval-log.ts` writes `data/eval/<suite>-<time>.json` with every check and full answer, for ratios, diagnosis, blueprint and throughput (grounding already did). The blueprint "no invented problems" check now prints the whole answer
- [ ] FC-110 Model misses seen in overnight regression runs
  - Acceptance: closed by FC-111 to FC-114
- [ ] FC-114 Repeat runs of the flaky suites
  - Acceptance: blueprint review, throughput, grounding, ratios and diagnosis 3 runs each; results and any remaining misses (with answers) recorded here and in FC-110

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation, from FC-110 (misses seen in S14–S15 regression runs). FC-110's notes: each passed on rerun. Blueprint review invented a problem (2 in ~9 runs); diagnosis skipped the search, saying the machines were already highlighted (1 in 5); grounding answered a nonsense question with "Ready when you are" (1 in 4); ratios left out the machine count (1 in 4); throughput wrote a chart block despite "no chart" (1 in 6). Ideas: drop chart blocks in code when the turn doesn't allow them; a stricter refusal template for unknown items; record full answers for failing checks so misses can be studied

## Review
