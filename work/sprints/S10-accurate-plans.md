# S10 — Accurate plans

- **Status:** active
- **Goal:** Production plans match what the game will actually do: built-in machine productivity (foundry, electromagnetic plant, biochamber) and researched recipe productivity are applied, and the data stays current as research completes. The companion also knows when the game is paused.
- **Acceptance:** The ratio eval's independent reference includes productivity and still passes 8/8 (biochamber and foundry questions change). Completing a research refreshes recipe data within seconds without a restart. The digest and page show when the game is paused. Latency and all suites hold.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-098 Modules, beacons and productivity bonuses in production plans
  - Acceptance: machine base productivity and per-force recipe productivity in the dump; planner applies them (capped at the recipe's maximum, ignoring products marked ignored_by_productivity); modules and beacons stay out and are stated
- [ ] FC-099 Refresh recipe data when research completes
  - Acceptance: a research_finished event refetches prototypes; unlock state and productivity bonuses update within seconds; no refetch otherwise
- [ ] FC-100 Productivity in the ratio eval's independent reference
  - Acceptance: reference applies productivity from the dump; 8/8
- [ ] FC-075 Detect a paused game or open menu in the digest
  - Acceptance: digest reports `tick_paused`; snapshot and page say the game is paused

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. S09 plans ignored Space Age's built-in productivity (+50% in several machines), so inputs and machine counts were overstated for those recipes.

## Review
