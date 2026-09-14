# S13 — Blueprint throughput

- **Status:** done
- **Goal:** When the player pastes a blueprint, the companion can say what it makes and needs per minute and where belts or inserters limit it, computed in code from the save's data.
- **Acceptance:** A pasted blueprint's summary includes per-minute inputs and outputs (with built-in and researched productivity), belt load against the blueprint's own belts, and inserters that can't keep up with their machine. Estimates match hand-worked numbers in unit tests, and inserter pickup/drop geometry is checked against the game. An e2e question about a pasted build gets the right numbers from the model. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-097 Throughput analysis of a blueprint (machines vs belt and inserter limits)
  - Acceptance: per-minute net inputs and outputs of the blueprint's crafting machines (productivity applied), belt load as a share of the fastest belt in the blueprint, and notes for what isn't counted (modules, beacons, quality, furnaces without a recipe, drills); shown in the pasted-blueprint summary
  - `server/src/blueprint-throughput.ts`: net flows per minute with the planner's productivity, belt share of the fastest belt in the blueprint (items fitting on one belt or not), fluids marked, rocket parts kept inside the silo, and notes for modules, beacons, quality, furnaces without a recipe and drills. 4 unit tests with hand-worked numbers. On the real Gleba blueprint: 4 firearm-magazine assemblers need 1,200 iron plate/min (44% of one express belt) and make 300 magazines/min; the silo builds 20 rocket parts/min. Blueprint e2e 8/8 (on a restarted server; an earlier 8/8 ran against a server started before this change)
- [x] FC-105 Inserter limits in blueprint throughput
  - Acceptance: dump gains inserter rotation speed and bulk flag, the digest or research state gives the force's inserter capacity bonuses; each inserter's pickup and drop tiles are derived from its direction (checked against `pickup_position`/`drop_position` of inserters built from a blueprint in the dev game); machines whose output or input needs more than their inserters can move are listed
  - Dump v6: inserter rotation speed, bulk flag, built-in hand bonus, pickup/drop offsets; `inserter_bonuses` (stack 2, bulk 11 on the dev save) in the dump and in `research_state`, so research updates them. Capacity estimate: hand size × rotation speed × 60 items/s (a basic inserter with no research: 0.84/s, matching the wiki's chest-to-chest figure). `scripts/test-inserters.ts` 5/5: a blueprint built through a real blueprint item on a temporary lab surface; all 8 inserters' pickup and drop positions match `inserterReach` in 4 directions (incl. long-handed), and the limit verdicts match ones computed from the game's own positions, with and without hand size research. Belt pickup and drop are slower than the estimate; the summary says "estimated from swing time"
- [x] FC-106 Throughput e2e question
  - Acceptance: through the real server, a pasted build with a known answer ("how many circuits per minute does this make, and what does it need?") gets the right numbers; 2 runs
  - `scripts/e2e-throughput.ts` 8/8: 3 cable and 2 circuit assemblers with one basic inserter; both runs gave 300 circuits/min, 450 copper and 300 iron plate/min, and named the slow inserter, answering in 3.8 s. The first run exposed two problems, both fixed: "holding it back" matched the trend-chart pattern, adding a chart for a build that isn't running (charts are now off for pasted blueprints), and the model suggested "2 per machine" when 4 were needed (the summary now says how many inserters would keep up)

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Use case: blueprint review (PLAN §1) already catches invalid builds; this adds whether a valid build does what the player wants.

## Review

Pasted blueprints now come with what they make and need, belt load and slow inserters, all computed in code. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Per-minute inputs and outputs with productivity, belt load against the blueprint's belts, slow inserters with how many would keep up (unit tests with hand-worked numbers).
- ✓ Inserter geometry matches the game for blueprint-built inserters in 4 directions (`test-inserters` 5/5).
- ✓ The e2e question got the right numbers in 2 of 2 runs (`e2e-throughput` 8/8).
- ✓ All suites pass on a server restarted with this code: grounding 10/10 (first token median 1.26 s, max 1.89 s), ratios 8/8, rails 6/6, charts 2/2, blueprints 8/8, console 4/4, planning 7/7, diagnosis 4/4, throughput 8/8, inserters 5/5, research 4/4, helmet 13/13, machines 7/7, planning helmet 13/13.

**What we learned:**
- The e2e scripts use whatever server is already running. One had been running since 01:50, so some of tonight's e2e results tested old server code until it was restarted. Everything was re-run afterwards and passed. CLAUDE.md now says to restart the server after server changes.
- Word patterns that pick per-turn guidance collide: "holding it back" is a bottleneck question, not a trend. Pasted-blueprint turns now skip the trend pattern.
- The model does arithmetic loosely ("2 per machine" when 4 were needed). Put the number it will need in the summary.

