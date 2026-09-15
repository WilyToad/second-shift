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

- [ ] FC-109 Entity settings actions: train stop limits and filters (rest of FC-093)
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves. Benchmark 2026-09-14: the listing ticks are 7.5 ms (tick 0) and 6.5 ms (tick 741) on the dev save; everything else in the scan stays under 2.6 ms

