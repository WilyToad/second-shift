# S24 — Counts that add up

- **Status:** active
- **Goal:** Numbers an answer gives about the player match their data, wreckage loot is called by its real name, and look results only reveal unseen things that are the player's own.
- **Acceptance:** The new-game eval passes 5 runs in a row with a new check on item counts and no "scrap" on Nauvis; a Fulgora-style scrap question still answers with scrap (unit test on the guidance); `find_entities` no longer counts entities in unseen chunks (mod), `find_stuck_machines` words own machines outside view as elsewhere in the factory; helmet, player and existing suites still pass.
- **Started:** 2026-09-15

## Items

- [ ] FC-140 Answers invent counts the player's data contradicts
  - Notes: S23 new-game eval: "that's 50 scrap iron plates from the debris" while `player_status` showed 1 iron plate. The S23 checks cover named builds, ore placements and ingredient amounts, not item counts
  - Acceptance: the new-game eval checks item counts an answer attributes to the player ("you have N X", "N X from the debris") against `player_status`; passes 3 runs in a row
- [ ] FC-141 Wreckage loot still called "scrap"
  - Notes: S23: about one answer in 8 new-game runs ("pick up scrap for more iron plates") although the surroundings line names the loot and says "not scrap". Scrap is a real Space Age item (Fulgora), so it can't be banned outright; on Nauvis wreckage it's wrong
  - Acceptance: no "scrap" in new-game eval answers over 5 runs, without breaking answers about real scrap on Fulgora
- [ ] FC-142 Look results say nothing about unseen things that aren't the player's
  - Notes: S23 removed the hidden-chunk count from `find_entities` results after an answer said "1,580 ore tiles exist in chunks you can't see" (helmet rule). Two related spots remain: `find_stuck_machines` still tells the model "N more in chunks the player can't see" (the player's own machines, which they know exist, so possibly fine), and the mod's `find_entities` still counts `not_visible` and sends it to the server, which no longer passes it on
  - Acceptance: the player decides whether own-machine counts outside view are allowed; the mod stops counting entities in unseen chunks for `find_entities`; `find_stuck_machines` follows the decision; helmet test and unit tests updated
  - Decision (player, 2026-09-15): own machines outside view may be counted, worded as elsewhere in their factory; unseen things that aren't theirs stay hidden

## Notes

Planned and activated on the player's request right after filing ("then plan a sprint and start working on them"). FC-142's open question was answered before starting: keep own-machine counts outside view.
