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


- [ ] FC-171 Answers can still name something the save doesn't have
  - Notes: from the player's early-game session (2026-09-17). One answer in 22 said walls and turrets need "the defensive-structures research"; this save has no such technology (it has `stone-wall`, `gun-turret`, `laser-turret`). It happened on a turn with no retrieved lines, where nothing grounded the name. A scan of the session's answers for hyphenated names missing from the dump found exactly that one, so the check is cheap and the false-positive rate looks low (the only other hit was "pipe-to-ground" split by the scan's own regex)
  - Acceptance: after an answer, names that look like save entities (recipes, items, fluids, technologies, machines, entities) but aren't in the dump get a correction line, the same way invented inventory counts do (FC-140) — phrases the dump does contain, and ordinary English, must not trip it; unit tests from this session's answers; measured over the eval suites with no new corrections on grounded answers
- [ ] FC-172 It undersells what it can build
  - Notes: player asked "build a line up to my metal" (a belt run from the coal drills to the furnaces) and the answer said "I can only do what a player could do — I can't build belts or place entities for you", then planned it in words. That's more modest than the truth: it can build a blueprint in code and paste it as ghosts behind a card, which is how the player's own robots build. What it can't do is place by hand — and early game, with no construction robots, ghosts would sit unbuilt, which is the part worth saying
  - Acceptance: a build request gets the accurate answer — what it can paste, that the player confirms it, and that ghosts need construction robots (so early game it's a plan, not a paste); the template library's limits (single production rows, no belt runs between two points yet) are stated plainly rather than as "I can't place entities"; unit test over the session's wording
- [ ] FC-173 Hands-free cuts sentences off
  - Notes: three of 24 spoken turns were sent mid-thought on the 2 s pause: "Keep running out of fuel up here what's the best way to get my", "I just spent how does this look", "Got10 red bottles to research automation". The answers coped, but the player had to re-explain twice
  - Acceptance: when the heard text ends on a word that can't end a sentence (a preposition, conjunction, article or possessive), the console waits another pause before sending, with a cap so it can't hold forever; the picker's default stays as it is and the behaviour is off for typed questions; unit tests over these three sentences and over normal endings that must not be delayed

- [x] FC-170 "New conversation" left the alert feed alone
  - Notes: player, 2026-09-16: "I just clicked New Conversation, but I still see a bunch of old alerts." Two causes: the console's reset only cleared the thread, and the server replays the mod's whole event ring (200 events, no age limit) to every page that connects, so alerts from days ago in that world came back
  - Done: reset clears the feed and the missed-event count as well, and the replay on connect only carries events from the last 10 minutes of game time — enough to see what happened while away, without dredging up a week. Unit tests for both


