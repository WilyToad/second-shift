# S24 — Counts that add up

- **Status:** done
- **Goal:** Numbers an answer gives about the player match their data, wreckage loot is called by its real name, and look results only reveal unseen things that are the player's own.
- **Acceptance:** The new-game eval passes 5 runs in a row with a new check on item counts and no "scrap" on Nauvis; a Fulgora-style scrap question still answers with scrap (unit test on the guidance); `find_entities` no longer counts entities in unseen chunks (mod), `find_stuck_machines` words own machines outside view as elsewhere in the factory; helmet, player and existing suites still pass.
- **Started:** 2026-09-15
- **Finished:** 2026-09-15

## Items

- [x] FC-141 Wreckage loot still called "scrap"
  - Notes: S23: about one answer in 8 new-game runs ("pick up scrap for more iron plates") although the surroundings line names the loot and says "not scrap". Scrap is a real Space Age item (Fulgora), so it can't be banned outright; on Nauvis wreckage it's wrong
  - Acceptance: no "scrap" in new-game eval answers over 5 runs, without breaking answers about real scrap on Fulgora
  - Done: questions about debris, wrecks or loot now fetch the surroundings (the wreckage line was missing on "I just picked up debris"), and a turn note names the loot's items and says never scrap, skipped whenever the data has something called scrap (unit test with a Fulgora scrap patch). The wreckage line also says the loot is still inside, not in the inventory. No "scrap" in any of the 25 new-game runs this sprint
- [x] FC-142 Look results say nothing about unseen things that aren't the player's
  - Notes: S23 removed the hidden-chunk count from `find_entities` results after an answer said "1,580 ore tiles exist in chunks you can't see" (helmet rule). Two related spots remain: `find_stuck_machines` still tells the model "N more in chunks the player can't see" (the player's own machines, which they know exist, so possibly fine), and the mod's `find_entities` still counts `not_visible` and sends it to the server, which no longer passes it on
  - Acceptance: the player decides whether own-machine counts outside view are allowed; the mod stops counting entities in unseen chunks for `find_entities`; `find_stuck_machines` follows the decision; helmet test and unit tests updated
  - Decision (player, 2026-09-15): own machines outside view may be counted, worded as elsewhere in their factory; unseen things that aren't theirs stay hidden
  - Done: the mod's `find_entities` no longer counts entities in unseen chunks (the field is gone from the reply and schema); `find_stuck_machines` says "N more elsewhere in their own factory, out of view"; unit test for the wording and for an older mod still sending the count. Helmet 13/13, machines 7/7, player 16/16. Recorded in PLAN §3

## Notes

Planned and activated on the player's request right after filing ("then plan a sprint and start working on them"). FC-142's open question was answered before starting: keep own-machine counts outside view.

## Review

Look results now keep the helmet rule tighter: nothing about unseen things that aren't the player's reaches the model, and their own out-of-view machines are named as their factory. Wreckage loot is called by its item names. Counts are only partly fixed: FC-140 goes back to the backlog.

- Measured: 25 new-game eval runs, 18 fully clean. Of the 7 others, 3 failed only because the checks misread good answers (fixed: "the furnace you just built needs it", "no research is available yet", "(1 you had + 7 from the wreckage)"; "nothing is researchable" came alongside a real miss) and 4 had real problems: "You now have 5 iron-plate" with 1 held, a burner-mining-drill "built" that wasn't, burner-inserter ingredients stated without recipe lines, and a "scan wider" offer whose yes wasn't treated as a look (fixed). Grounding 10/10 (first token median 1.42 s, from 1.11–1.31 in S23), requests 13/13, rails 6/6, planning 7/7. 53 unasked calls dropped, 0 repeats over 286 turns.
- Mod: 0.085 ms/tick (5 runs). Nothing new runs per tick in S23 or S24, but the readings since S22 are 0.055, 0.070, 0.085: still under budget, worth a per-tick script profile (`scripts/probes/bench-ticks.ts`) before the next mod change.
- Not done: FC-140. Its check now catches invented counts and phantom builds, and the turn notes cut them down, but the model still makes one in roughly one run in six. Returned to the backlog with these numbers.
- Filed from the player's idea during the sprint: FC-143 (on-screen direction hints), FC-144 (spidertron autopilot), FC-145 (car and tank driving, stretch).

