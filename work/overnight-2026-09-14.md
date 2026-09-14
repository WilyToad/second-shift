# Overnight log — 2026-09-13/14

The player delegated this night's work (continue S03, then plan and activate the next sprint).
Nothing is pushed; only the dev save copy runs; manual checks are left for the player.

## For the player to review in the morning

- [ ] FC-027: press Ctrl+Z in-game after an agent deconstruction mark and confirm the marks disappear
- [ ] FC-028: in remote view, try a deconstruction drag over fog of war (charted but not in radar range) and over unexplored map; tell me what the game allows

## Log

- 23:16 Loop started. Fixed a Lua `a and b or c` bug in mark/cancel that reported allowed entities as "gone" (found by the in-game test).
- 23:20 In-game helmet tests 13/13 (`scripts/test-helmet.ts`). FC-024, FC-025, FC-026, FC-029 done. FC-027 automated part verified (one undo item per mark action); FC-027 and FC-028 wait for the player (marked blocked).
- 23:20 Launch fix: `spawnFactorio()` starts the game from a folder with `steam_appid.txt`, which skips Steam's custom-arguments prompt (player confirmed). Launch time 15.5 s.
