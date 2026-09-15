# S22 — A good first hour

- **Status:** done
- **Goal:** A player starting a brand-new game gets a companion that looks when asked, knows what they're carrying and can craft, gives start-of-game advice grounded in the save, stays quiet about problems that aren't problems yet, knows what they just built, and starts a fresh conversation on a new map.
- **Acceptance:** A new-game eval on a freshly created map (crash-site start) passes: "look around" and "yeah" after an offer to look both search; "what can I craft right now?" answers from the real inventory and craftable counts; "what do I do?" names only things in the save (no pickaxe or axe); no answer mentions tools, tool calls or "the data provided"; research isn't raised unless asked or labs are idle; "I just built something" names what was built; a different map starts a new conversation and going back restores the old one. The existing suites still pass (grounding, planning, helmet, console).
- **Started:** 2026-09-15
- **Finished:** 2026-09-15

## Items

- [x] FC-132 The companion offers to look, then doesn't
  - Notes: first-run walkthrough (new game, 2026-09-15): "yeah, look around" and "yeah" after "Want me to look around?" made no tool calls. `needsWorldTools` didn't match either, and non-world turns are told "no tool call is needed", so the model said "I can't see what's built here without a tool call". All 8 turns: 0 tools
  - Acceptance: "look around", "what's around me", "what did I build" and an affirmative reply to the companion's own offer to look are world turns and search; unit tests; new-game eval
  - Done: a short yes is classified together with the questions the last answer asked (`acceptedOffer`); look and build phrasing are world turns; "no tool call is needed" is only sent when retrieved data answers the turn. "look around" fetches `surroundings`. `find_entities` now resolves "ore" and named ores (the first "yeah" to "search wider for ore?" got "ore isn't recognized"). Eval: yeah-after-offer looked in every run
- [x] FC-133 Inventory and hand-crafting
  - Notes: "what can I craft right now?" got "The data provided doesn't list your inventory". The digest has no inventory. Reading your own inventory is looking, so no approval
  - Acceptance: questions about inventory, crafting or "what do I have" get the character's inventory and what it can hand-craft now (the game's own craftable counts), fetched only for those questions; helmet test (another player's inventory isn't readable, remote view reads the character); new-game eval
  - Done: mod action `player_status` (character inventory, cursor, hand-craftable with counts, crafting queue); fetched for "what can I craft / what do I have / picked up debris" phrasing, not for "how do I craft X" (a recipe question: fetching it there raised tool calls). `get_craftable_count` is ~30 µs a call, so only recipes the inventory can reach are asked (1.7 ms with plates vs 6.8 ms for all). Helmet: the mod reads the companion player's own character only (the app has no way to name another player); with no character it reports none (in-game test). `scripts/test-player.ts` checks counts against the game
- [x] FC-134 Start-of-game advice grounded in the save
  - Notes: "help me... what do I do?" said to craft a pickaxe and axe (not in 2.0) and that the debris holds "metal and scrap". No item matched, so no recipe lines were sent and the model improvised from memory
  - Acceptance: "what do I do / how do I start / what's next" questions get grounded lines (inventory, hand-craftable, what's built nearby by kind, researchable next); answers name only things in the save; eval checks for known vanilla-memory mistakes
  - Done: start questions get player status, surroundings and research options, which now include trigger technologies ("electronics (craft 10 copper-plate)"), with a note to name only what's in those lines. Surroundings count the crash site's wreckage and what it holds (they were skipped as hidden prototypes, and its fires read as 34 enemies). A line says there are no axes or pickaxes; the wreckage line says it holds only the listed items (answers said "scrap")
- [x] FC-135 Research nagging on a new map
  - Notes: every answer said "Nothing is researching" although there's no lab yet. The snapshot always carries "research: nothing researching"
  - Acceptance: research state goes in the snapshot only for research, science or rate questions, or when labs are idle with nothing queued; unit tests
  - Done as specified. Gating the position line too was tried and reverted: without it, recipe questions called `screenshot` "to show your spot" (A/B, 5 questions: 0 with the line, 2 without)
- [x] FC-136 "I just built something"
  - Notes: the companion has no record of what the player builds
  - Acceptance: the mod keeps the player's last few builds (name, position, tick) from `on_built_entity`, in storage, capped; questions about what they built get them; benchmark shows no measurable cost; in-game test builds with `build_from_cursor`
  - Done: last 20 builds per player in storage (ghosts marked, "gone now" when removed); `util.on_event` shares `on_built_entity` with the machine registry (a second `script.on_event` would have replaced it). Benchmark 0.055 ms/tick (5 runs), within noise of 0.043. In-game test: a cursor build is recorded, a script-created entity isn't
- [x] FC-137 A new map starts a new conversation
  - Notes: the new game's thread opened with a test question from another save; `data/session.json` isn't tied to a map
  - Acceptance: the mod gives each save a stable id (created once in `on_init`); the server keeps one conversation per map id and switches when the connected map changes; unit test; in-game check switching saves
  - Done: `storage.map_id` (seed and tick) from `on_init`, or `on_configuration_changed` for saves that had the mod before (mod bumped to 0.2.0 so that runs); the digest carries it. Conversations live in `data/sessions/<map id>.json`; the first map seen adopts the old `data/session.json` (the dev save took the walkthrough's conversation, copied to `data/captures/first-hour-session-2026-09-15.json` first). Eval: a new map starts empty, and hosting the dev save again brings its conversation back
- [x] FC-131 The system prompt names one player's mods
  - Notes: moved from the backlog: a new player on plain Space Age was told the game has maraxsis, Cerys and factorissimo-2
  - Acceptance: the mod line is built from the game's active mods (kept with the prototype cache); unit test; latency report after the prompt change
  - Done: `[save data: mods]` after the rules. Latency report: the stable prefix still caches at 4,096 tokens; grounding eval first token median 1.17 s
- [x] FC-127 Unasked-for screenshots
  - Notes: moved from the backlog. Came back on recipe questions after the S22 prompt changes: the grounding eval's bioflux and yumako questions called `screenshot` after answering ("That's your spot on Gleba for reference")
  - Acceptance: a `screenshot` call runs only when the question (or the offer it accepts) asks for a picture; otherwise the round's answer stands without another round; the transcript keeps every text part of a turn; unit tests; grounding eval shows no screenshot calls
  - Done; turn records now name the tools each round called. Final grounding run: no screenshot calls
- [x] FC-138 New-game eval
  - Acceptance: `scripts/eval-new-game.ts` creates a fresh map with `--create`, hosts it, and runs the first-hour questions above with checks, saving to `data/eval/`; passes
  - Done: a new map every run (`--create` takes ~2 s, so each run gets a new map id), the crash-site cutscene skipped, a wreck mined and a stone furnace built from the inventory the way the player would, answers checked against `player_status` and `surroundings`. Final: 18/18 in 3 consecutive runs, plus the switch-back check

## Notes

Activated on the player's request after their first-run walkthrough ("these are critical. We need to fix them."). The walkthrough ran from `~/projects/factorio` on a new Space Age game with the player's usual mods; the full reset (fresh clone, re-run setup) comes after these fixes.

## Review

A new game now gets a companion that looks: the walkthrough's questions are answered from the character's inventory, what it can hand-craft, what's around it (the crash site's wreckage and loot included), what the player just built, and the trigger technologies that start the tech tree. Research isn't raised on a map without labs, answers don't talk about tools or "the data provided", and each map keeps its own conversation.

- Measured: mod 0.055 ms/tick (5-run benchmark); `player_status` 1.5–1.7 ms and `surroundings` 1.5 ms on demand on the dev save; first-hour turns with player data: first token median 1.20 s over 18 turns; grounding eval first token median 1.17 s, 10/10.
- Suites: new-game eval 18/18 ×3, test-player 15/15, helmet 13/13, planning 13/13, grounding 10/10, diagnosis 4/4, ratios 8/8, console 4/4, session 3/3.
- Pulled in: FC-131 (a new player's prompt named the author's mods) and FC-127 (unrequested screenshots came back with the prompt changes).
- Found and fixed along the way: crash-site wreckage invisible to the look (hidden prototypes), fires counted as enemies, "ore" not searchable, plural "patches".
- Still seen in eval answers, logged as FC-139: invented details (said an assembling-machine-1 was placed when a stone furnace was; recipe details from memory) and unasked-for map tag cards ("I've dropped a tag, confirm it in the app"), which is FC-126's pattern outside blueprints.
- Next with the player: the fresh-clone first-run walkthrough.

