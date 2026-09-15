# S28 — Numbers and facts you can lean on

- **Status:** active
- **Started:** 2026-09-15
- **Goal:** When the companion gives a rate it's roughly right and names the real bottleneck, when the exact rate matters it measures it in the player's own game, and it stops adding game mechanics from memory that a modded save may not follow.
- **Acceptance:** A blueprint-estimate suite over the builds already measured in the dev game: every estimate within 10% and naming the same limit, stated as a rounded range; "is this hitting 150 a minute?" answers from machines' own craft counts on a build in the dev game, with the measurement window said out loud and a refusal where the player can't see; a pointing eval shows answers no longer add mechanics nobody asked about; existing suites still pass (grounding, diagnosis, new-game, voice session replay, helmet, player).

## Items

- [ ] FC-160 Game-mechanics claims from memory
  - Notes: in the S27 replay, "what is this?" on a passive provider chest added "Requester chests won't pull from it; only you can take by hand", which is wrong (requester chests are filled from passive providers). Recipes are grounded on the save, but how entities behave (logistics, fluids, trains, circuit rules) comes from the model's memory and modded saves change it
  - Acceptance: measured how often answers add mechanics nobody asked about (eval over pointing and "what is this" questions); either a turn rule to state only what the lines say about an entity, or short save-grounded entity facts (type, logistic mode, fluid capacity) in the pointed-at line; replay check
- [x] FC-161 Throughput estimates that get the bottleneck right
  - Notes: players want "will it work, what limits it, roughly how much", not exact rates, but a miss in kind costs trust because the production screen shows real rates. `blueprint-throughput.ts` estimates inserters at chest-to-chest speed and ignores machine insertion limits, belt supply along a row and output backing up. The wiki's inserter page has 2.0.26 measured tables (belt to chest, chest to belt) and the insertion rule: ingredients for 1 craft plus the crafts done in one 1.166 s standard swing, at least 2 and at most 100 crafts
  - Acceptance: inserter limits use the measured belt tables where a belt is involved; machine insertion limits and belt supply shared along the row are counted; rates are said as a rounded range, pessimistic side first ("about 140–150/min, limited by the output inserters"); the rates already measured in the dev game (S13, S14 builds) are unit tests, each estimate within 10% and naming the same limit; no simulator and no second game instance
  - Done: the estimate now counts the belt lane cap (the biggest correction), a hand-size share for belt ends, the game's machine insertion rule, and a machine with no inserter on one side (which makes nothing). Rates read "about 287–600/min … held back to about 48% by the inserters loading assembling-machine-3". `test-generated-builds` feeds rows through their own belts, one surface per case, and adds two crippled rows: 13/13 with every estimate within 1.1% of the game and the right part blamed (PLAN §5). Unit tests hold the dev-game figure to 10% and the wiki's perpendicular-belt figures to 20%. An input-lane limit can't be measured with a scripted feed, so that cap is checked against the wiki's tables
- [ ] FC-162 Measure a build after it's placed
  - Notes: when the player cares about the exact rate, measure it in their own game: each machine's `products_finished` read twice, about a minute apart, for the machines in an area (a selection, the last search, or around the player). A look, so it runs on request; cheap because it only touches the listed machines
  - Acceptance: "is this build hitting 150 a minute?" returns the measured per-minute rate by recipe for the machines asked about, with how long it measured; refuses what the player can't see; costs under 1 ms per read for 500 machines (measured); helmet test; e2e on a generated build in the dev game

## Notes

Activated by the player (2026-09-15, "Go ahead and get started"). Planned at their request from the throughput decision: no second Factorio instance and no custom simulator, so the estimates get better and the exact numbers come from the player's own game. The in-game panel (FC-060) stays in the backlog: the player left it out of this sprint.
