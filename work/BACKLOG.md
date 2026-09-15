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

- [ ] FC-140 Answers invent counts the player's data contradicts
  - Notes: S23 new-game eval: "that's 50 scrap iron plates from the debris" while `player_status` showed 1 iron plate. The S23 checks cover named builds, ore placements and ingredient amounts, not item counts
  - Acceptance: the new-game eval checks item counts an answer attributes to the player ("you have N X", "N X from the debris") against `player_status`; passes 3 runs in a row
- [ ] FC-141 Wreckage loot still called "scrap"
  - Notes: S23: about one answer in 8 new-game runs ("pick up scrap for more iron plates") although the surroundings line names the loot and says "not scrap". Scrap is a real Space Age item (Fulgora), so it can't be banned outright; on Nauvis wreckage it's wrong
  - Acceptance: no "scrap" in new-game eval answers over 5 runs, without breaking answers about real scrap on Fulgora
- [ ] FC-142 Decide: should look results mention what's in chunks the player can't see?
  - Notes: S23 removed the hidden-chunk count from `find_entities` results after an answer said "1,580 ore tiles exist in chunks you can't see" (helmet rule). Two related spots remain: `find_stuck_machines` still tells the model "N more in chunks the player can't see" (the player's own machines, which they know exist, so possibly fine), and the mod's `find_entities` still counts `not_visible` and sends it to the server, which no longer passes it on
  - Acceptance: the player decides whether own-machine counts outside view are allowed; the mod stops counting entities in unseen chunks for `find_entities`; `find_stuck_machines` follows the decision; helmet test and unit tests updated

- [ ] FC-109 Entity settings actions: train stop limits and filters (rest of FC-093)
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves. Benchmark 2026-09-14: the listing ticks are 7.5 ms (tick 0) and 6.5 ms (tick 741) on the dev save; everything else in the scan stays under 2.6 ms

