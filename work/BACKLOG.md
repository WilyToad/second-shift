# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions

- [ ] FC-097 Throughput analysis of a blueprint (machines vs belt and inserter limits)
- [ ] FC-044 `layout_sketch` component with copyable blueprint string
- [ ] FC-046 Blueprint selection tool in the mod
- [ ] FC-048 Template-based blueprint creation
- [ ] FC-049 Screenshots and their game cost (PLAN §8 Q7)

## Phase 3b — Character control

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
- [ ] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)

## Phase 4 — Optional

- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)
- [ ] FC-061 Background Factorio test instance for measuring blueprints
- [ ] FC-062 Voice in/out
- [ ] FC-063 Session memory across play sessions

## Tech debt and risks

- [ ] FC-092 "Near me" while the player is in remote view
  - Notes: `player.position` is the remote-view position; searches and pastes "here" should probably use the character's `physical_position` unless the player means where they're looking. Decide with the player
- [ ] FC-093 Entity settings actions (recipe, train stop limits, filters) from FC-045
- [ ] FC-103 Cheaper prototype refresh when research completes
  - Notes: `dump_prototypes` takes ~26 ms (one dropped frame at 60 UPS) and runs again on every research completion. Send only what research changes (recipe enabled flags, productivity bonuses, technology researched state). Measured in S11
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves

- [ ] FC-071 Resolve the "Factorio Companion" name clash with ob1-s/factorio-AI-coop
- [ ] FC-072 Close the hosted game port to the LAN (macOS firewall or another approach)
