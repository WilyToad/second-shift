# Overnight log — 2026-09-13/14

The player delegated this night's work (continue S03, then plan and activate the next sprint).
Nothing is pushed; only the dev save copy runs; manual checks are left for the player.

## For the player to review in the morning

- [ ] FC-027: press Ctrl+Z in-game after an agent deconstruction mark and confirm the marks disappear
- [ ] FC-028: in remote view, try a deconstruction drag over fog of war (charted but not in radar range) and over unexplored map; tell me what the game allows

## Log

Times are commit times (local).

- 23:16 Loop started. Fixed a Lua `a and b or c` bug in mark/cancel that reported allowed entities as "gone" (found by the in-game test).
- 23:17 In-game helmet tests 13/13 (`scripts/test-helmet.ts`). FC-024, FC-025, FC-026, FC-029 done. FC-027 automated part verified (one undo item per mark action); FC-027 and FC-028 wait for the player (marked blocked).
- 23:14 Launch fix: `spawnFactorio()` starts the game from a folder with `steam_appid.txt`, which skips Steam's custom-arguments prompt (player confirmed). Launch time 15.5 s.
- 23:31 FC-078 + FC-023 done: agent loop with tools (find_entities, mark/cancel_deconstruction), approval card in the chat page, outcomes fed into the next turn. `scripts/e2e-rails.ts` 6/6 with the real model and game (find 8 rails right → card → approve → 8/8 marked in game → instant delete refused). Grounding eval still 10/10.
- 23:31 Latency: tool definitions made the model call find_entities on 4/10 recipe questions (+3–5 s each). Fixed by classifying world questions in code. `tool_choice: none` isn't usable (oMLX strips the tools, which breaks the cache). The running game costs ~12% on prefill. Details in PLAN §6.
- **Review:** first-token times with the game running (median 2.56 s, max 3.61 s) are a bit above S02's game-closed numbers. Worth a look at whether that's acceptable in real play.
- 23:32 FC-022 done: incoming RCON commands aren't split when hosting alone (1 MB in ~32 ms), but the mod's JSON parse costs ~14 ms/MB on the main thread. Protocol now caps commands at 48 KB. Large blueprints will need chunking (noted for FC-030+).
- 23:33 S03 closed (review written; FC-027/FC-028 player checks pending). S04 "Live console" planned and activated under the night's delegation: FC-020, FC-021, FC-041, FC-040, FC-042.
- FC-020 done: urgent events ring buffer in the mod, server polls every 250 ms, forwards to the page. In-game: research completion and a destroyed wall both arrived within 469 ms; poll cost 0.03–0.04 ms. Hosted-game quit doesn't save, so `data/saves/dev.zip` stays pristine (checked).
- FC-041 done: Preact + signals chosen and the chat page ported (no feature loss, plus a "New conversation" button). DOM test via happy-dom; rails e2e still 6/6.
- FC-040 + FC-021 done: three-column console (alerts | chat | live state) with sparklines and a stalled-science flag. In-game alert reached the page in 307–424 ms.
- **Bug found and fixed:** after FC-020 the digest's production data was empty. `script.on_nth_tick(30, …)` in the events module silently replaced the rate refresher registered for the same interval. Added `util.on_nth_tick` (shared dispatcher) and a gotcha note in CLAUDE.md. The console e2e now requires non-empty production data.
- **Review:** the page layout hasn't been looked at in a real browser. Please open http://127.0.0.1:5170 (it needs `bun run start` and the game hosted) and check how it looks at your monitor size.
- FC-042 done: `rate_chart` blocks drawn by the page from recorded history. Charts and tool calls are gated per turn in code. Grounding 10/10, rails 6/6, charts 2/2.
- S04 closed (visual layout check pending). New backlog item FC-079: first-token latency with the game running has crept to median ~2.9 s, max ~4.1 s.
