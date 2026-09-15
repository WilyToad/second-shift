# S23 — Says only what's true, does only what's asked

- **Status:** done
- **Goal:** Answers stop inventing details the data contradicts, the companion doesn't propose actions nobody asked for, and an answer never comes out twice.
- **Acceptance:** The new-game eval passes 3 runs in a row with the new checks (named builds match the build record, ore claims match what's around, ingredient claims come with recipe lines, no unasked cards); a request eval shows no approval card unless the player asked for that action (blueprint requests without "paste", first-hour questions) and still shows one when they did; a repeated answer is cut to one copy (unit test) and repeats are counted in the turn log. Existing suites still pass.
- **Started:** 2026-09-15
- **Finished:** 2026-09-15

## Items

- [x] FC-139 First-hour answers still invent details
  - Notes: S22 new-game eval, answers that passed the checks: "You placed an assembling-machine-1" (the build was a stone furnace, and the build record said so); "place your burner-mining-drill on the iron patch near the wreck" with no iron within 32 tiles; burner-inserter and belt ingredients stated from memory without recipe lines
  - Acceptance: the new-game eval checks named builds against the build record and ore claims against surroundings, and recipe claims on player-data turns come with recipe lines; passes 3 runs in a row
  - Plan: "what should I build next?" gets the player's data too; recipe lines for what's hand-craftable come with it; resources are looked for further out when none are within 32 tiles; the eval checks named builds, ore claims and ingredient claims
  - Done: "what should I build next?" counts as a start question; up to 10 recipe lines for what's hand-craftable ride along with the player's data; `surroundings` looks for resources out to 96 tiles (visible chunks only, 2.1 ms on the dev save) when none are within 32; a search that finds nothing tells the model not to place one ("the big patch is 82 tiles south-west" after 0 found); wreckage loot lines ask for item names, not "scrap". New-game eval checks: named builds against the build record, ore placements against every resource visible within 128 tiles at the start and end (visibility fades as the game runs), ingredient amounts need recipe lines, no approval cards, no hidden-chunk leaks. Final: 3 runs in a row at 23/23; over the last 8 runs, 7 fully clean and 1 with "pick up scrap"
- [x] FC-126 Blueprint requests sometimes come with an unasked-for paste card
  - Notes: seen while recording: "Give me a blueprint for 300 electronic circuits a minute" answered with the card, "Say the word and I'll paste it", and a paste approval card in the same turn (S14 guidance says no tool call until asked). With "and paste it here" in the question, the answer still said "Want it pasted as ghosts at your position? Just say so" next to the card. A 600/min request was refused correctly (1,800 cable/min is over one lane) but said "That approval card wasn't needed" when none was shown
  - Notes (S22): same pattern outside blueprints: "help me... what do I do?" and "I just built something" on a new map each produced an add-map-tag card ("I've dropped a 'Start base here' tag, confirm it in the app"). The code correctly made it a card; the model shouldn't have offered it unasked
  - Acceptance: an eval over blueprint requests shows no paste card unless the player asked to paste
  - Plan: an action the player didn't ask for (in the question, or in an offer they said yes to) isn't run or carded; the model offers it in words instead. Asked map changes still get a card
  - Done: `ASKS_FOR` per action tool; unasked calls are dropped (if the round already answered, that answer stands with no extra round; otherwise the model is told to offer it in one short question). This also stopped a research question from queueing research ("What do I need before I can research…" matched the old `research` pattern). A blueprint request that says "paste it here" is now pasted through a card right away instead of being offered. `scripts/eval-requests.ts`: 26/26 over 2 runs; 66 unasked calls dropped over 273 S23 turns. Decision recorded in PLAN §3 and CLAUDE.md
- [x] FC-130 The model sometimes writes its whole answer twice
  - Notes: selection review of a 22-entity build (2026-09-14, recording): the answer (507 characters) came out twice back to back, 271 tokens out, and the page and saved history both show it twice. The model repeated itself; the server passed it through
  - Acceptance: a guard drops an exact repeat of the answer (streamed text stops once the repeat is certain, history keeps one copy), with a unit test; eval runs log how often it happens
  - Plan: a stream filter holds back text that starts repeating the answer from its beginning, stops the stream once the repeat is certain, and marks the turn record
  - Done: `RepeatFilter` (60 matching characters after a whitespace boundary) with unit tests for token splits and a near-repeat that must pass through; the agent aborts the stream, keeps one copy in the page, history and transcript, and logs `repeated`. The latency report prints repeats and dropped calls: 0 repeats in 273 turns this sprint, so the guard hasn't fired live yet

## Notes

Activated on the player's request after S22 ("let's work on FC-139 and FC-126… Any others?"); FC-130 added at their pick. The fresh-clone walkthrough waits; the install was restored from the pre-trial backups for this sprint.

## Review

Answers now check against the game more often, and the companion no longer volunteers cards: an action it wasn't asked for is offered in words, and a yes makes it happen. A repeated answer would be cut to one copy.

- Measured: new-game eval 23/23 three runs in a row (7 of the last 8 fully clean); request eval 26/26 over 2 runs; 66 unasked tool calls dropped over 273 turns; mod 0.070 ms/tick (5 runs, noise); wider resource look 2.1 ms on demand; grounding first token median 1.11 s.
- Suites: test-player 16/16, helmet 13/13, grounding 10/10, e2e planning 7/7, rails 6/6, settings 3/3, blueprint request 6/6.
- Found and fixed along the way: a helmet-rule leak. `find_entities` results told the model how many things were in chunks the player can't see, and an answer repeated it ("1,580 ore tiles exist in chunks you can't see"). The count no longer reaches the model, with a unit test and an eval check. A research question could also queue research on its own (see FC-126).
- Still seen: the model occasionally says "scrap" for wreckage loot (1 answer in the last 8 runs), and invented numbers the checks don't cover still happen (one run said "that's 50 scrap iron plates from the debris" while the inventory held 1).
- Next with the player: the fresh-clone first-run walkthrough.

