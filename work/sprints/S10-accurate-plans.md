# S10 — Accurate plans

- **Status:** active
- **Goal:** Production plans match what the game will actually do: built-in machine productivity (foundry, electromagnetic plant, biochamber) and researched recipe productivity are applied, and the data stays current as research completes. The companion also knows when the game is paused.
- **Acceptance:** The ratio eval's independent reference includes productivity and still passes 8/8 (biochamber and foundry questions change). Completing a research refreshes recipe data within seconds without a restart. The digest and page show when the game is paused. Latency and all suites hold.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-098 Modules, beacons and productivity bonuses in production plans
  - Acceptance: machine base productivity and per-force recipe productivity in the dump; planner applies them (capped at the recipe's maximum, ignoring products marked ignored_by_productivity); modules and beacons stay out and are stated
  - Dump v5: machine `base_productivity` (foundry, biochamber, electromagnetic plant +50%), recipe `productivity_bonus` (e.g. steel +30% researched) and `allows_productivity` (173 of 981 recipes). Planner applies min(machine + research, max), leaving ignored_by_productivity parts alone; 60 bioflux/min now needs 0.5 biochambers (was 0.75). Caught a Lua `x and true or nil` that hid `false`
- [x] FC-099 Refresh recipe data when research completes
  - Acceptance: a research_finished event refetches prototypes; unlock state and productivity bonuses update within seconds; no refetch otherwise
  - A `research_finished` event makes the game link refetch prototypes on its next poll (unit test with a fake game). In-game: researching a tech flipped its unlocked recipe to enabled in the cache within 0.5 s; the system prompt text is unchanged, so the cache stays warm
- [ ] FC-100 Productivity in the ratio eval's independent reference
  - Acceptance: reference applies productivity from the dump; 8/8
- [ ] FC-075 Detect a paused game or open menu in the digest
  - Acceptance: digest reports `tick_paused`; snapshot and page say the game is paused

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. S09 plans ignored Space Age's built-in productivity (+50% in several machines), so inputs and machine counts were overstated for those recipes.

## Review
