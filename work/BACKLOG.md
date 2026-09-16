# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions


## Phase 4 — Voice and extras

- [-] FC-061 Background Factorio test instance for measuring blueprints
  - Dropped (player, 2026-09-15): no second Factorio instance, and no custom simulator either. Approximate numbers are enough when the bottleneck is right; replaced by FC-161 (better estimates) and FC-162 (measure a build after it's placed)

## Phase 5 — Character control


## Phase 6 — Car and tank driving

- [x] FC-145 Car and tank driving: spike
  - Notes: player idea (2026-09-15); split into a spike and an implementation by the player. Never moves the character on foot
  - Acceptance: a written recommendation in the sprint notes and PLAN: steering approach, obstacle handling, measured per-tick cost of a prototype while driving, how the stop hotkey (FC-051) takes over, and whether to build it
  - Done: recommendation in `work/spikes/FC-145-driving.md` (2026-09-15), summarised in PLAN §7 Phase 6. It corrects this item's own premise: route-finding for a car-sized box *is* in the engine (`request_path` documents "emulate pathing behavior by script for non-unit entities, such as vehicles", taking a free-form bounding box and collision mask), while throttle and steering are only `riding_state` (4 acceleration × 3 direction states), so the work is a waypoint follower, not a pathfinder. Verdict: build a reduced version — drive a pre-checked path and stop rather than swerve — after FC-144, with FC-146's first task as a go/no-go measurement. Cost while driving is estimated at 0.02–0.04 ms/tick against ~0.05 ms of headroom, and the write-up says why the whole-tick benchmark can't see that and what to measure instead. `LuaEntity.orientation` and `.speed` are writable but are cheats (they snap past `rotation_speed` and bypass fuel and acceleration), which rules out how Autodrive and AAI do it

## Future — not now

Deferred by the player (2026-09-15): "file all except FC-144 as future items". They come back when the player asks.

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
  - Notes (player, 2026-09-15): walking stays a human thing: "I do NOT want the assistant to automatically move the player around." Drop `walk_to` when this is planned; vehicles are FC-144/FC-145
- [ ] FC-146 Car and tank driving: implementation
  - Notes: planned from FC-145's recommendation (`work/spikes/FC-145-driving.md`); FC-144 (spidertron autopilot) ships first, because it needs the same confirm card, stop hotkey and refusals with none of the steering risk. Reduced scope: refuse any path needing something destroyed, cap path length and waypoints, stop rather than swerve when anything is in a look-ahead box, stop on damage to the vehicle, on player input, on the stop key, on losing the driver or the fuel; one vehicle at a time, on request; vanilla car first, tank behind its own tuning pass (`tank_driving` steers differently)
  - Acceptance (from FC-145): (1) a go/no-go measurement first — `request_path` for a tank-sized collision box with the tank's own mask across ~200 tiles of the dev save: success rate, `try_again_later` rate, response latency, and whether the paths are drivable for a ~2x3 box; if poor, stop and record the decision not to build; (2) per-tick script time idle vs driving under 0.05 ms average and no tick over 1 ms, with the `try_again_later` counter alongside (engine pathfinder time isn't in the script profile); (3) stop latency: control released within one tick of a key press, with the tiles travelled after it recorded; (4) helmet tests that must fail: uncharted destination, no fuel, a path needing something destroyed, not the driver, another surface, player presses a movement key, player exits, vehicle damaged — plus a test that the code never writes `orientation` or `speed`; (5) in-world path preview, approval card, and everything re-checked at confirm time
- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)

- [-] FC-169 Chests that sort themselves
  - Dropped (player, 2026-09-15) before any work: "drop FC-169 for now". Storage-chest filters only decide where *incoming* items land, so they don't consolidate what's already in 20 mixed chests — nothing moves until something pulls it. Once the chests are on the network, `get_supply_counts` says which one holds what, so finding things stops being the problem FC-169 was for. Revisit only if sorting still annoys the player after FC-168

## Tech debt and risks


