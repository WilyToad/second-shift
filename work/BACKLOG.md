# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions


## Phase 4 — Voice and extras

- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)
- [-] FC-061 Background Factorio test instance for measuring blueprints
  - Dropped (player, 2026-09-15): no second Factorio instance, and no custom simulator either. Approximate numbers are enough when the bottleneck is right; replaced by FC-161 (better estimates) and FC-162 (measure a build after it's placed)
- [ ] FC-161 Throughput estimates that get the bottleneck right
  - Notes: players want "will it work, what limits it, roughly how much", not exact rates, but a miss in kind costs trust because the production screen shows real rates. `blueprint-throughput.ts` estimates inserters at chest-to-chest speed and ignores machine insertion limits, belt supply along a row and output backing up. The wiki's inserter page has 2.0.26 measured tables (belt to chest, chest to belt) and the insertion rule: ingredients for 1 craft plus the crafts done in one 1.166 s standard swing, at least 2 and at most 100 crafts
  - Acceptance: inserter limits use the measured belt tables where a belt is involved; machine insertion limits and belt supply shared along the row are counted; rates are said as a rounded range, pessimistic side first ("about 140–150/min, limited by the output inserters"); the rates already measured in the dev game (S13, S14 builds) are unit tests, each estimate within 10% and naming the same limit; no simulator and no second game instance
- [ ] FC-162 Measure a build after it's placed
  - Notes: when the player cares about the exact rate, measure it in their own game: each machine's `products_finished` read twice, about a minute apart, for the machines in an area (a selection, the last search, or around the player). A look, so it runs on request; cheap because it only touches the listed machines
  - Acceptance: "is this build hitting 150 a minute?" returns the measured per-minute rate by recipe for the machines asked about, with how long it measured; refuses what the player can't see; costs under 1 ms per read for 500 machines (measured); helmet test; e2e on a generated build in the dev game

## Phase 5 — Character control

- [ ] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)
- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
  - Notes (player, 2026-09-15): walking stays a human thing: "I do NOT want the assistant to automatically move the player around." Drop `walk_to` when this is planned; vehicles are FC-144/FC-145
- [ ] FC-144 Spidertron autopilot on request
  - Notes: player idea (2026-09-15): walking stays the player's, but vehicles could be driven. Spidertrons have `autopilot_destination` built in, so "send my spidertron to the copper patch" is close to a named action. Character-level control: needs a confirm and a stop hotkey (FC-051); only the player's own spidertron, only to places they could send it with the remote
  - Acceptance: a card to confirm, the spidertron walks there with its own autopilot, the stop hotkey cancels it; refuses destinations the player couldn't pick with the remote; helmet test

## Phase 6 — Car and tank driving

- [ ] FC-145 Car and tank driving: spike
  - Notes: player idea (2026-09-15); split into a spike and an implementation by the player. The engine has no pathfinder for player-driven cars: a mod steers by setting riding state every tick and must route around obstacles itself, so this is much bigger than FC-144 and has a per-tick cost while driving. Never moves the character on foot
  - Acceptance: a written recommendation in the sprint notes and PLAN: steering approach, obstacle handling, measured per-tick cost of a prototype while driving, how the stop hotkey (FC-051) takes over, and whether to build it
- [ ] FC-146 Car and tank driving: implementation
  - Notes: planned from FC-145's recommendation; not started until the spike says it's worth building
  - Acceptance: set by FC-145

## Tech debt and risks

- [ ] FC-160 Game-mechanics claims from memory
  - Notes: in the S27 replay, "what is this?" on a passive provider chest added "Requester chests won't pull from it; only you can take by hand", which is wrong (requester chests are filled from passive providers). Recipes are grounded on the save, but how entities behave (logistics, fluids, trains, circuit rules) comes from the model's memory and modded saves change it
  - Acceptance: measured how often answers add mechanics nobody asked about (eval over pointing and "what is this" questions); either a turn rule to state only what the lines say about an entity, or short save-grounded entity facts (type, logistic mode, fluid capacity) in the pointed-at line; replay check

