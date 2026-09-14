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
- S05 "Fast in real play" planned and activated (delegated): FC-080 latency breakdown, FC-079 latency target, FC-081 smaller tail, FC-076 conversation trimming.
- FC-080 done: per-turn latency log + report. Key finding: the stable prefix is ~3.7k tokens and oMLX caches 2,048-token blocks, so every new question re-reads ~1.7k stable tokens. Fixing next by padding the prefix with useful reference lines to cross 4,096.
- FC-079 done: S05 latency targets met with the game running (first token median 1.23 s, max 1.92 s; follow-up 2.39 s; answers median 90 tokens). Biggest win: padding the system prompt past the 4,096-token cache block (new questions 2.03 s → 0.80 s server first token).
- FC-081 done: uncached question tail −47% (1,004 → 531 tokens) from tighter retrieval. First token median 1.11 s, max 1.80 s; grounding 10/10. Added a server-side chart fallback (the model sometimes skipped chart blocks on trend questions); charts 6/6 over 3 runs. One misstep caught by the latency report: aligning exactly to 4,096 forgot the probe's template tokens and cost a whole cache block; fixed with a 24-token margin.
- FC-076 done: conversation compaction + cache re-warm; 16-question conversation follow-ups median 1.59 s, p90 2.23 s, max 2.51 s. **S05 closed**: all latency targets met with the game running.
- S06 "Blueprint review" planned and activated (delegated): FC-030 codec, FC-082 entity sizes, FC-031 checker, FC-032 review in chat.
- FC-030 done: blueprint string codec; a real 49-entity blueprint from the dev save round-trips and re-imports in-game with 49 entities.
- FC-082 done: entity footprints in the prototype dump (167 entities). Fixed a stale-cache gap: the server now refetches when the mod's dump format version changes, not only when the mod list does.
- FC-031 done: blueprint checker (unknown entities, overlaps, uncraftable recipes); zero false positives on the real blueprint, all three issue kinds caught in tests.
- FC-032 done, **S06 closed**: pasted blueprints become checked summaries (the raw string never reaches the model); e2e 8/8 twice. Fixed another brittle refusal regex in the rails e2e (the model's refusal was correct).
- S07 "Bottleneck diagnosis" planned and activated (delegated): FC-083 registry, FC-084 status polling, FC-085 status in digest + find_stuck, FC-043 recipe graph (optional), FC-086 scenario eval. Reason: use case #1 had no machine-status data yet.
- FC-083 + FC-084 done: machine registry (2,746 machines, matches a direct count) and round-robin status polling at ~0.055 ms/tick; the one-time scan peaks at 0.34 ms per tick. The dev save's Nauvis drills are mostly waiting for output space.
- FC-085 done: machine status in the digest + `find_stuck_machines` tool + computed diagnosis hints. Real finding on the dev save: the Nauvis base is backed up because research stopped (47 idle labs), which the companion now says first. Fixed a runtime `require` in a mod handler (Factorio only allows require at load).
- **Review:** your dev save's real state: research has stopped, so science and everything upstream on Nauvis is output-blocked; on Gleba some yumako processors and iron furnaces are starved. Worth checking in your real save.
- FC-086 done, **S07 closed**: diagnosis scenario eval 4/4 (names every real status, highlights all stuck machines); all 7 regression suites pass. Follow-up latency 2.72 s in one run: tracked as FC-087.
- S08 "Planning actions" planned and activated (delegated): FC-088 queue_research, FC-089 map tags + camera, FC-090 mark_upgrade, FC-091 place_blueprint (small), FC-087 latency watch.
