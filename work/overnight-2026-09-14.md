# Overnight log — 2026-09-13/14

The player delegated this night's work (continue S03, then plan and activate the next sprint).
Nothing is pushed; only the dev save copy runs; manual checks are left for the player.

## For the player to review in the morning

- [x] FC-027: press Ctrl+Z in-game after an agent deconstruction mark and confirm the marks disappear (verified with the player: one Ctrl+Z removed all 4 marks)
- [ ] FC-028: in remote view, try a deconstruction drag over fog of war (charted but not in radar range) and over unexplored map; tell me what the game allows
- [ ] FC-092: when you search "near me" from remote view, should that mean where your character stands or where you're looking?
- [ ] Visual check: open http://127.0.0.1:5170 (after `bun run launch -- --dev` and `bun run start`) and look at the console layout, the blueprint sketch card and the screenshot card at your monitor size
- [ ] FC-115: click "Show the companion a build" on the shortcut bar, drag over a build, and check the review appears in the page
- [ ] FC-093 note: when you change a machine's recipe by hand in remote view, do its ingredients go to your inventory? The companion assumes they do
- [ ] FC-072: the hosted game's port 34197 listens on all interfaces (`--bind` is ignored when hosting); it's password-protected with max_players 1. Decide whether to add a macOS firewall rule

## Summary of the night (S11–S19)

Stopped at 06:55 as planned, with Factorio and the server closed. Nine sprints closed, all committed, nothing pushed:
- **S11 Megabase scale:** at 25,000 machines, `find_machines` went from 5.9 ms to 0.79 ms; every per-tick path stays flat.
- **S12 No hitches:** research completion no longer triggers a 26 ms full dump (now 0.06 ms).
- **S13 Blueprint throughput:** pasted blueprints get per-minute flows, belt load and slow inserters.
- **S14 Blueprints on request:** "a blueprint for 120 gears/min" gives a checked, copyable, pasteable build, measured in-game within 1%.
- **S15 Machine settings:** change machine recipes under the helmet rule; sketches for pasted blueprints.
- **S16 Fewer model misses:** chart rules enforced in code, unknown names stated as data, full answers saved for every eval.
- **S17 Show the companion a build:** in-game selection tool → automatic review (hands-on check pending, FC-115).
- **S18 Picks up where you left off:** the conversation survives restarts and reloads.
- **S19 Show me:** screenshots on request, at no measurable game cost.

Mod cost after all this (benchmark, before S15–S19's small additions): 0.082 ms/tick. Open performance items: FC-103 is done; FC-104 (one-time scan's surface listing ticks, 6–7 ms once per save).

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
- S08 mod side: queue_research, add_map_tag, camera_to, mark_upgrade, place_blueprint with helmet checks; `scripts/test-planning.ts` 13/13 in-game (refuses missing prerequisites, trigger techs, uncharted tags/camera, incompatible upgrades, unseen pastes).
- **S08 closed**: planning actions end to end (research queue, tags, camera, upgrades, blueprint paste) with cards and helmet tests; all 10 suites pass. The latency guard caught a regression from the new tools (6k system prompt, follow-ups 2.8 s); fixed by moving machines to retrieval, compacting past questions, and an alignment convergence bug. Follow-ups back to ~1.9–2.0 s.
- S09 "Production planning" planned and activated (delegated): FC-094 ratio calculator, FC-095 plans in rate questions, FC-043 recipe_graph, FC-096 ratio eval (FC-047 folded in).
- FC-094 done: ratio calculator from the save's recipes; the dump gained a raw-resource list after the first version expanded iron ore through asteroid crushing.
- **S09 closed**: production planning. Ratio eval 8/8 twice against an independent reference (vanilla, Gleba, maraxsis); plans drawn as a recipe graph; all suites pass. Follow-ups 2.25–2.44 s, close to the 2.5 s target.
- S10 "Accurate plans" planned and activated (delegated): FC-098 productivity in plans, FC-099 refresh on research, FC-100 eval reference with productivity, FC-075 paused detection.
- **S10 closed**: plans include built-in and researched productivity (dump v5), recipe data refreshes when research completes (0.5 s), paused game shown. The latency check caught snapshot bloat on planning questions (follow-ups ~3 s); fixed, now 1.55–1.73 s. All suites pass.
- S11 "Megabase scale" planned and activated (delegated): FC-070 synthetic megabase in the running dev game, FC-101 profile every mod path at scale, FC-102 fix what's over budget.
- **S11 closed** (megabase scale): test tooling builds 25,000 machines in the running dev game (nothing saved). `find_machines` was 5.9 ms per call at that size; now 0.79 ms (per-chunk index with status counts). Per-tick costs stay flat (polling 0.05 ms, rate refresh 0.05 ms, alerts 0.04 ms). All suites pass; blueprint e2e was 7/8 once (model invented a problem in a clean blueprint) and 8/8 on rerun. Table in PLAN §5.
- Caught before committing: my first scan fix kept a chunk iterator in a module-local, which would desync a multiplayer peer that loads mid-scan. Scan progress is back in `storage`. The cost is one ~7 ms tick to list Nauvis's chunks, once per save (FC-104).
- New backlog: FC-103 (the 26 ms prototype dump runs on every research completion, one dropped frame), FC-104 (scan outlier ticks).
- S12 "No hitches" planned and activated (delegated): FC-103 research refresh without a full dump, FC-072 hosted game bound to localhost.
- FC-103 done: research completion now patches recipe data with a targeted `research_state` query (0.06 ms in the game) instead of a 26 ms full dump; verified identical to a full dump in-game. Also fixed: reconnecting with the same mods kept stale research flags from the cache.
- FC-072 blocked: the GUI client ignores `--bind` when hosting (rechecked). The remaining options touch your config.ini or macOS firewall, so it's back in the backlog for you.
- **S12 closed** (no hitches): all suites pass.
- **Review:** FC-072, the hosted dev game's port 34197 is open on all interfaces. It's password-protected with max_players 1. If you want it closed, a macOS firewall rule for Factorio is the likely route; your call.
- S13 "Blueprint throughput" planned and activated (delegated): FC-097 per-minute flows and belt load for pasted blueprints, FC-105 inserter limits, FC-106 e2e question.
- FC-097 done: pasted blueprints now get per-minute inputs/outputs and belt load. On the real Gleba blueprint: 4 magazine assemblers need 1,200 iron plate/min (44% of one express belt).
- FC-105 done: inserter limits (dump v6). Pickup/drop geometry checked against inserters built from a real blueprint item in the dev game (on a temporary surface, deleted after).
- **Correction:** the companion server had been running since 01:50, and the e2e/eval scripts use the running server. So the server-backed results I logged for S12 and the first FC-097 blueprint run tested older server code. After restarting the server I re-ran everything, and it all passes. CLAUDE.md now says to restart the server after server changes.
- FC-106 done, **S13 closed**: a pasted circuit build got the right numbers in both runs (300 circuits/min from 450 copper + 300 iron, slow inserter named). Fixed two things the e2e found: an unwanted trend chart on "holding it back", and the model guessing inserter counts (the summary now gives them).
- S14 "Blueprints on request" planned and activated (delegated): FC-048 production-row template sized in code, FC-107 measuring generated builds in the dev game, FC-108 blueprint requests in chat.
- FC-048 + FC-107 done: blueprints built in code for a requested rate, measured in the dev game on a temporary surface: gears 149.8/min for 150 promised, circuits 299.6 for 300, automation science 30.0 for 30. The first in-game run caught unpowered inserters (a pasted blueprint doesn't connect its poles; the template now stores wires and places poles by inserter reach).
- FC-108 done, **S14 closed**: "make me a blueprint for 120 gears per minute" now returns a card with a layout sketch and a copy button; "paste it" goes through the approval card (11 of 11 ghosts placed in the dev game). All suites pass (diagnosis flaked once, then 4/4 three times; a timing race in the machines test is fixed).
- **Review:** open the web page and ask for a blueprint to see the new layout sketch card. The visual design hasn't been checked in a real browser.
- Benchmark after tonight's mod changes (game closed): the mod costs 0.082 ms/tick on average, within the 0.1 ms budget. Only 3 of 1,800 ticks went over 1 ms, all in the one-time registry scan: 7.5 ms and 6.5 ms when it lists a big surface's chunks, and one 2.6 ms tick. Recorded in PLAN §5; FC-104 tracks it.
- S15 "Machine settings" planned and activated (delegated): FC-093 set recipe on searched machines (helmet-checked, approval card), FC-044 layout sketch for pasted blueprints.
- FC-093 done: "switch the assembling machines around me to copper cable" finds them, shows a card, and changes the recipe after approval. The helmet rule applies (not yours, not visible, locked/hidden recipe, wrong category, furnaces). Held ingredients go to your inventory. **For you to check:** whether changing a recipe by hand in remote view also returns ingredients to your inventory in the real game.
- FC-044 done, **S15 closed**: pasted blueprints now show the layout sketch card too. All suites pass, but a full run now shows about one model miss somewhere (each passed on rerun); they're listed in FC-110.
- S16 "Fewer model misses" planned and activated (delegated): FC-111 remove disallowed chart blocks in code, FC-112 say when a named thing doesn't exist, FC-113 keep failing answers from evals, FC-114 repeat runs.
- **S16 closed** (fewer model misses): chart blocks the turn doesn't allow are removed in code; unknown names ("quantum widget", "flux capacitor") reach the model as data; every eval run saves full answers in `data/eval/`. Three rounds of the five flaky suites: 14 of 15 clean. The one miss (a plan answer without its machine count) was fixed by putting the plan's number in the turn guidance, then ratios passed 8/8 three times. A full regression passed.
- **S17 closed** (show the companion a build): a new shortcut, "Show the companion a build", gives a selection tool. Dragging it over a build sends the build to chat for review (summary, throughput, sketch) without copying a string. Tested end to end through the same capture code (7/7 twice). **For you to check (FC-115):** click the shortcut in-game, drag over something, and look at the companion page.
- S18 "Picks up where you left off" planned and activated (delegated): FC-063 conversation saved and restored across server restarts and page reloads.
- **S18 closed** (picks up where you left off): the conversation survives server restarts and page reloads (`data/session.json`, rewritten after each answer; "New conversation" clears it). Verified across a real restart: the follow-up knew the earlier question, first token 0.78 s.
- **Correction to S16/FC-110:** the blueprint "invented a problem" misses were most likely a bug in the test (its pattern matched "no problems found"), not the model. Fixed. Also fixed: a science question now gets a chart even when the model forgets one.
- S19 "Show me" planned and activated (delegated): FC-049 screenshots on request, with their game cost measured first.
- **S19 closed** (show me): "show me a screenshot of where I'm standing" (or of the last search result) shows a real in-game picture in chat. Cost measured: ~0.1 ms of Lua, the game stays at 60 UPS, image ready in ~40 ms. The server keeps only the newest 20 files and serves nothing else. **For you to look at:** the screenshot card in the page.

