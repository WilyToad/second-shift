# S25 — Backlog, Phase 3 and tech debt

- **Status:** active
- **Goal:** The mod's scan hitch and benchmark creep are explained and reduced, the companion can point the way to what the player is looking for, train stops can be set like assembler recipes, and invented counts are caught before they reach the player.
- **Acceptance:** Per-tick profile explains the benchmark readings and the registry scan has no tick over ~2 ms on the dev save; "show me the way to the nearest copper" pings it and draws a player-only arrow that follows and expires (helmet test, benchmark); train stop limits set through a card with in-game refusal tests; the new-game eval passes 5 runs in a row including its count and build checks. Existing suites still pass.
- **Started:** 2026-09-15

## Items

- [x] FC-104 Registry scan outlier ticks
  - Notes: S11 megabase rescan: median 0.11 ms, p95 0.40 ms per tick, but listing a big surface's chunks takes one ~7 ms tick (Nauvis, 11,844 chunks) and a few ticks reach 1–2 ms while registry tables grow. Runs once per save. A chunk iterator kept across ticks would fix the listing tick but can't be a module-local (desync); check whether a LuaChunkIterator can be kept in `storage` (the docs don't say it can't) without writing to the player's saves. Benchmark 2026-09-14: the listing ticks are 7.5 ms (tick 0) and 6.5 ms (tick 741) on the dev save; everything else in the scan stays under 2.6 ms
  - Plan (S25): profile per-tick script time with and without the mod (`scripts/probes/bench-ticks.ts`) to explain the benchmark readings creeping from 0.043 to 0.085 ms/tick, then spread the chunk listing so no scan tick passes ~2 ms
  - Done: the per-tick profile (6,000 ticks, `--benchmark-verbose`) shows the mod's script time is 0.034 ms/tick once the scan is done (0.047 with vs 0.013 without), so the benchmark's 0.043 → 0.085 readings were whole-game noise. The slow ticks were the chunk listings (8.1 ms at tick 0, 6.2 at 741, 3.2 at 1340). The scan now keeps the surface's `LuaChunkIterator` in storage and walks it a few chunks per tick: slowest scan tick 0.88 ms. A save made mid-scan (`/server-save`, moved out of the saves folder and deleted afterwards) loaded and finished the scan; `test-machines.ts` 7/7 on it, registry 2,746 = direct count. A scan saved in the old format restarts
- [ ] FC-143 Direction hints: ping it on the map and point the way on screen
  - Notes: player idea (2026-09-15): "say I'm looking for copper, it can ping it on the map or maybe even place an arrow on-screen temporarily". A map tag or chart ping on the patch, plus a player-only rendering arrow from the character toward it that follows them and fades after ~20 s (same visual-only kind as highlights). Only for things the player can see (helmet rule); a look, so no approval when asked
  - Acceptance: "where's the nearest copper?" answers and, when asked to show the way, pings the patch and draws an arrow only the player sees; the arrow follows the character and expires; nothing for unseen resources; helmet test; benchmark (the follow update must be cheap and stop when it expires)
- [ ] FC-109 Entity settings actions: train stop limits and filters (rest of FC-093)
  - Acceptance: a mod action sets what a player can set in a train stop's window (train limit on or off, priority, name), under the helmet rule (own force, visible, not circuit-controlled for the limit); refusals tested in-game; a server tool acts on the last search through a card; e2e: find train stops near me, set their limit, confirm, the game shows it
- [ ] FC-140 Answers invent counts the player's data contradicts
  - Notes: S23 new-game eval: "that's 50 scrap iron plates from the debris" while `player_status` showed 1 iron plate. The S23 checks cover named builds, ore placements and ingredient amounts, not item counts
  - Acceptance: the new-game eval checks item counts an answer attributes to the player ("you have N X", "N X from the debris") against `player_status`; passes 3 runs in a row
  - Notes (S24): turn notes added (counts come from the inventory line exactly; no ingredients without recipe lines; wreckage loot is still in the wreckage), and the new-game eval checks counts and named builds. Still seen in about 1 run in 6: "You now have 5 iron-plate" with 1 held, "You've built a burner-mining-drill" when only a furnace was built. Next ideas: re-fetch the player's data on any turn that talks about their inventory or builds (the phantom build came on a turn without it), or check counts in code after the answer and follow up with a correction line

## Notes

Activated on the player's request ("Work on the backlog items"). Only Phase 3 and tech-debt items were pulled in; Phase 3b (character control, vehicles) and Phase 4 need the player to move the project to that phase. FC-050 now records that walking stays the player's.
