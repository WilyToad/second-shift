# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions


## Phase 3b — Character control

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
- [ ] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)

## Phase 4 — Optional

- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)
- [ ] FC-061 Background Factorio test instance for measuring blueprints
- [ ] FC-062 Voice in/out

## Tech debt and risks

- [ ] FC-139 First-hour answers still invent details
  - Notes: S22 new-game eval, answers that passed the checks: "You placed an assembling-machine-1" (the build was a stone furnace, and the build record said so); "place your burner-mining-drill on the iron patch near the wreck" with no iron within 32 tiles; burner-inserter and belt ingredients stated from memory without recipe lines
  - Acceptance: the new-game eval checks named builds against the build record and ore claims against surroundings, and recipe claims on player-data turns come with recipe lines; passes 3 runs in a row
- [ ] FC-126 Blueprint requests sometimes come with an unasked-for paste card
  - Notes: seen while recording: "Give me a blueprint for 300 electronic circuits a minute" answered with the card, "Say the word and I'll paste it", and a paste approval card in the same turn (S14 guidance says no tool call until asked). With "and paste it here" in the question, the answer still said "Want it pasted as ghosts at your position? Just say so" next to the card. A 600/min request was refused correctly (1,800 cable/min is over one lane) but said "That approval card wasn't needed" when none was shown
  - Notes (S22): same pattern outside blueprints: "help me... what do I do?" and "I just built something" on a new map each produced an add-map-tag card ("I've dropped a 'Start base here' tag, confirm it in the app"). The code correctly made it a card; the model shouldn't have offered it unasked
  - Acceptance: an eval over blueprint requests shows no paste card unless the player asked to paste
- [ ] FC-130 The model sometimes writes its whole answer twice
  - Notes: selection review of a 22-entity build (2026-09-14, recording): the answer (507 characters) came out twice back to back, 271 tokens out, and the page and saved history both show it twice. The model repeated itself; the server passed it through
  - Acceptance: a guard drops an exact repeat of the answer (streamed text stops once the repeat is certain, history keeps one copy), with a unit test; eval runs log how often it happens

- [ ] FC-109 Entity settings actions: train stop limits and filters (rest of FC-093)
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves. Benchmark 2026-09-14: the listing ticks are 7.5 ms (tick 0) and 6.5 ms (tick 741) on the dev save; everything else in the scan stays under 2.6 ms

