# S11 — Megabase scale

- **Status:** active
- **Goal:** Prove the mod stays within budget on a huge factory, and fix whatever doesn't: cost must grow with changes, never with factory size (PLAN §5).
- **Acceptance:** In the running dev game (nothing saved), test tooling scales the base to at least 25,000 registered machines. By profiler: polling, digest, events and rate refresh stay ≤ 0.1 ms per tick on average and no single tick > 1 ms; `find_machines` and `find_entities` ≤ 1 ms per call; the one-time registry scan never exceeds 1 ms per tick. All suites still pass on the normal dev save.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-070 Find or build a heavier benchmark save (megabase scale)
  - Acceptance: a repeatable test-tooling script clones dense factory areas in the running dev game to ≥ 25,000 machines (no save written)
- [ ] FC-101 Profile every mod path at scale
  - Acceptance: numbers for scan, polling, digest, events sampler, rate refresh, find_machines, find_entities, dump recorded in PLAN §5 at mid-size and megabase scale
- [ ] FC-102 Fix anything over budget at scale
  - Acceptance: every path from FC-101 within the S11 budget; before/after numbers recorded

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. The player's standing instruction: "factories get HUGE"; all costs so far were measured at 2,746 machines.

## Review
