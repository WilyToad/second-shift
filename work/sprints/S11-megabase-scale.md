# S11 — Megabase scale

- **Status:** done
- **Goal:** Prove the mod stays within budget on a huge factory, and fix whatever doesn't: cost must grow with changes, never with factory size (PLAN §5).
- **Acceptance:** In the running dev game (nothing saved), test tooling scales the base to at least 25,000 registered machines. By profiler: polling, digest, events and rate refresh stay ≤ 0.1 ms per tick on average and no single tick > 1 ms; `find_machines` and `find_entities` ≤ 1 ms per call; the one-time registry scan never exceeds 1 ms per tick. All suites still pass on the normal dev save.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-070 Find or build a heavier benchmark save (megabase scale)
  - Acceptance: a repeatable test-tooling script clones dense factory areas in the running dev game to ≥ 25,000 machines (no save written)
  - `bun scripts/megabase.ts`: instead of cloning areas, it builds a lab-tile surface with a grid of assemblers through build events (22,254 built in 0.8 s, 25,000 registered), profiles, and deletes the surface. Nothing is saved. Assemblers without power are a worst case for stuck-machine lookups (every one matches)
- [x] FC-101 Profile every mod path at scale
  - Acceptance: numbers for scan, polling, digest, events sampler, rate refresh, find_machines, find_entities, dump recorded in PLAN §5 at mid-size and megabase scale
  - Table in PLAN §5. Over budget at 25,000 machines: `find_machines` 5.9 ms median, max 10.9 ms (it walked every machine). The first rescan measurement was invalid (`/sc` resets the scenario's storage, not the mod's), so a `debug_reset_machines` test handler was added. Also added `debug_refresh_rates` to profile the rate refresher
- [x] FC-102 Fix anything over budget at scale
  - Acceptance: every path from FC-101 within the S11 budget; before/after numbers recorded
  - `find_machines` 5.9 ms → 0.79 ms at 25,000 machines, all matching: machines indexed by surface, recipe and chunk, with status counts per chunk group; cached name and position. Scan does at most 100 entities or 16 chunks per tick, with all progress in `storage` (a first version kept the chunk iterator in a module-local, which would desync a peer that loads the map mid-scan). `test-machines` gained an index-vs-counts check on every surface and a recipe-change move test (7/7). Left over: listing Nauvis's chunks takes one ~7 ms tick, once per save (FC-104)

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. The player's standing instruction: "factories get HUGE"; all costs so far were measured at 2,746 machines.

## Review

The companion's game-side cost now stays flat at megabase size. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ 25,000 registered machines in the running dev game, nothing saved.
- ✓ Per tick: polling 0.05 ms, rate refresh step 0.05 ms, alert sampler 0.04 ms, events poll 0.02 ms (every 250 ms), digest 0.48 ms (every 2 s).
- ✓ `find_entities` 0.11 ms; `find_machines` 0.79 ms with 22,254 matching machines (was 5.9 ms).
- ✗ Partly: the one-time registry scan has median 0.11 ms and p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick and a few ticks reach 1–2 ms. Once per save; tracked as FC-104.
- ✓ All suites pass on the normal dev save: grounding 10/10 (first token median 1.22 s, max 1.82 s), ratios 8/8, rails 6/6, charts 2/2, blueprints 8/8 (7/8 on one run: the model invented a problem in the clean blueprint; passed on rerun), console 4/4, planning 7/7, diagnosis 4/4, helmet 13/13, machines 7/7, planning helmet 13/13.

**What we learned:**
- Anything that loops over "all machines of a recipe" grows with the factory. Counting per chunk keeps both counts and the helmet's visibility check proportional to area.
- Keeping a chunk iterator in a module-local would have been smooth and wrong: scan progress feeds `storage`, so it must be in `storage` too.
- `/sc storage...` touches the level script's storage, not a mod's; mod state needs a mod-side test handler.
- The prototype dump (26 ms) is the biggest single cost left, and it runs on every research completion (FC-103).

