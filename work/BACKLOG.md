# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions

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
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves

- [ ] FC-071 Resolve the "Factorio Companion" name clash with ob1-s/factorio-AI-coop
- [ ] FC-072 Close the hosted game port to the LAN (macOS firewall or another approach)
  - Notes: S12: the GUI client ignores `--bind` when hosting (log shows 0.0.0.0:34197). Options left touch the player's config.ini or macOS firewall, so the player decides. In place: random game password, max_players 1, no LAN or public listing
