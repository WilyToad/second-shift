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
- 00:05 FC-078 + FC-023 done: agent loop with tools (find_entities, mark/cancel_deconstruction), approval card in the chat page, outcomes fed into the next turn. `scripts/e2e-rails.ts` 6/6 with the real model and game (find 8 rails right → card → approve → 8/8 marked in game → instant delete refused). Grounding eval still 10/10.
- 00:05 Latency: tool definitions made the model call find_entities on 4/10 recipe questions (+3–5 s each). Fixed by classifying world questions in code. `tool_choice: none` isn't usable (oMLX strips the tools, which breaks the cache). The running game costs ~12% on prefill. Details in PLAN §6.
- **Review:** first-token times with the game running (median 2.56 s, max 3.61 s) are a bit above S02's game-closed numbers. Worth a look at whether that's acceptable in real play.
- 00:15 FC-022 done: incoming RCON commands aren't split when hosting alone (1 MB in ~32 ms), but the mod's JSON parse costs ~14 ms/MB on the main thread. Protocol now caps commands at 48 KB. Large blueprints will need chunking (noted for FC-030+).
- 00:20 S03 closed (review written; FC-027/FC-028 player checks pending). S04 "Live console" planned and activated under the night's delegation: FC-020, FC-021, FC-041, FC-040, FC-042.
