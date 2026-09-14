# S10 — Accurate plans

- **Status:** done
- **Goal:** Production plans match what the game will actually do: built-in machine productivity (foundry, electromagnetic plant, biochamber) and researched recipe productivity are applied, and the data stays current as research completes. The companion also knows when the game is paused.
- **Acceptance:** The ratio eval's independent reference includes productivity and still passes 8/8 (biochamber and foundry questions change). Completing a research refreshes recipe data within seconds without a restart. The digest and page show when the game is paused. Latency and all suites hold.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-098 Modules, beacons and productivity bonuses in production plans
  - Acceptance: machine base productivity and per-force recipe productivity in the dump; planner applies them (capped at the recipe's maximum, ignoring products marked ignored_by_productivity); modules and beacons stay out and are stated
  - Dump v5: machine `base_productivity` (foundry, biochamber, electromagnetic plant +50%), recipe `productivity_bonus` (e.g. steel +30% researched) and `allows_productivity` (173 of 981 recipes). Planner applies min(machine + research, max), leaving ignored_by_productivity parts alone; 60 bioflux/min now needs 0.5 biochambers (was 0.75). Caught a Lua `x and true or nil` that hid `false`
- [x] FC-099 Refresh recipe data when research completes
  - Acceptance: a research_finished event refetches prototypes; unlock state and productivity bonuses update within seconds; no refetch otherwise
  - A `research_finished` event makes the game link refetch prototypes on its next poll (unit test with a fake game). In-game: researching a tech flipped its unlocked recipe to enabled in the cache within 0.5 s; the system prompt text is unchanged, so the cache stays warm
- [x] FC-100 Productivity in the ratio eval's independent reference
  - Acceptance: reference applies productivity from the dump; 8/8
  - `scripts/eval-ratios.ts` reference applies productivity from the dump: 8/8 (bioflux 0.5 biochambers, agricultural science 0.67, glass panes 0.83 foundries)
- [x] FC-075 Detect a paused game or open menu in the digest
  - Acceptance: digest reports `tick_paused`; snapshot and page say the game is paused
  - Digest `paused` from `game.tick_paused`; snapshot header says the game is paused; page header shows "game paused". In-game: detected within 1.8 s, RCON keeps working while paused

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. S09 plans ignored Space Age's built-in productivity (+50% in several machines), so inputs and machine counts were overstated for those recipes.

## Review

Plans now match what the game will do, and the companion knows when the game is paused. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Productivity-aware reference, ratio eval 8/8.
- ✓ Research completion refreshed recipe data within 0.5 s, no restart.
- ✓ Pause shown in the digest, snapshot and page.
- ✓ Latency: grounding first token median 1.14–1.27 s (max ≤ 2.02 s); follow-ups 1.55–1.73 s;
  16-question conversation median 1.87 s, p90 2.20 s, max 2.57 s.
- ✓ All suites pass: grounding 10/10 ×3, ratios 8/8, rails 6/6, charts 2/2, blueprints 8/8, console 4/4,
  planning 7/7, diagnosis 4/4, helmet 13/13, machines 5/5, planning helmet 13/13.

**What we learned:**
- Space Age's built-in +50% productivity changes plans a lot (bioflux 0.75 → 0.5 biochambers).
- Another Lua `x and true or nil` bug. That idiom has now bitten three times.
- The latency check caught a regression again: since S07, "how many" pulled production and stuck-machine
  lines into planning questions (snapshot median 793 tokens, follow-ups ~3 s). Planned questions now
  skip those blocks, and "how many" no longer counts as a rate question.

