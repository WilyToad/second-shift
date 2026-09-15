# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions

- [ ] FC-143 Direction hints: ping it on the map and point the way on screen
  - Notes: player idea (2026-09-15): "say I'm looking for copper, it can ping it on the map or maybe even place an arrow on-screen temporarily". A map tag or chart ping on the patch, plus a player-only rendering arrow from the character toward it that follows them and fades after ~20 s (same visual-only kind as highlights). Only for things the player can see (helmet rule); a look, so no approval when asked
  - Acceptance: "where's the nearest copper?" answers and, when asked to show the way, pings the patch and draws an arrow only the player sees; the arrow follows the character and expires; nothing for unseen resources; helmet test; benchmark (the follow update must be cheap and stop when it expires)


## Phase 3b — Character control

- [ ] FC-144 Spidertron autopilot on request
  - Notes: player idea (2026-09-15): walking stays the player's, but vehicles could be driven. Spidertrons have `autopilot_destination` built in, so "send my spidertron to the copper patch" is close to a named action. Character-level control: needs a confirm and a stop hotkey (FC-051); only the player's own spidertron, only to places they could send it with the remote
  - Acceptance: a card to confirm, the spidertron walks there with its own autopilot, the stop hotkey cancels it; refuses destinations the player couldn't pick with the remote; helmet test
- [ ] FC-145 Car and tank driving (stretch)
  - Notes: player idea (2026-09-15). The engine has no pathfinder for player-driven cars: a mod steers by setting riding state every tick and must route around obstacles itself, so this is much bigger than FC-144 and has a per-tick cost while driving. Never moves the character on foot
  - Acceptance: to be planned after FC-144 (research spike: steering approach, obstacle handling, per-tick cost while driving, stop hotkey)

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
  - Notes (S24): turn notes added (counts come from the inventory line exactly; no ingredients without recipe lines; wreckage loot is still in the wreckage), and the new-game eval checks counts and named builds. Still seen in about 1 run in 6: "You now have 5 iron-plate" with 1 held, "You've built a burner-mining-drill" when only a furnace was built. Next ideas: re-fetch the player's data on any turn that talks about their inventory or builds (the phantom build came on a turn without it), or check counts in code after the answer and follow up with a correction line
- [ ] FC-109 Entity settings actions: train stop limits and filters (rest of FC-093)
- [ ] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves. Benchmark 2026-09-14: the listing ticks are 7.5 ms (tick 0) and 6.5 ms (tick 741) on the dev save; everything else in the scan stays under 2.6 ms

