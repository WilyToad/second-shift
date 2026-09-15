# S22 — A good first hour

- **Status:** active
- **Goal:** A player starting a brand-new game gets a companion that looks when asked, knows what they're carrying and can craft, gives start-of-game advice grounded in the save, stays quiet about problems that aren't problems yet, knows what they just built, and starts a fresh conversation on a new map.
- **Acceptance:** A new-game eval on a freshly created map (crash-site start) passes: "look around" and "yeah" after an offer to look both search; "what can I craft right now?" answers from the real inventory and craftable counts; "what do I do?" names only things in the save (no pickaxe or axe); no answer mentions tools, tool calls or "the data provided"; research isn't raised unless asked or labs are idle; "I just built something" names what was built; a different map starts a new conversation and going back restores the old one. The existing suites still pass (grounding, planning, helmet, console).
- **Started:** 2026-09-15

## Items

- [ ] FC-132 The companion offers to look, then doesn't
  - Notes: first-run walkthrough (new game, 2026-09-15): "yeah, look around" and "yeah" after "Want me to look around?" made no tool calls. `needsWorldTools` didn't match either, and non-world turns are told "no tool call is needed", so the model said "I can't see what's built here without a tool call". All 8 turns: 0 tools
  - Acceptance: "look around", "what's around me", "what did I build" and an affirmative reply to the companion's own offer to look are world turns and search; unit tests; new-game eval
- [ ] FC-133 Inventory and hand-crafting
  - Notes: "what can I craft right now?" got "The data provided doesn't list your inventory". The digest has no inventory. Reading your own inventory is looking, so no approval
  - Acceptance: questions about inventory, crafting or "what do I have" get the character's inventory and what it can hand-craft now (the game's own craftable counts), fetched only for those questions; helmet test (another player's inventory isn't readable, remote view reads the character); new-game eval
- [ ] FC-134 Start-of-game advice grounded in the save
  - Notes: "help me... what do I do?" said to craft a pickaxe and axe (not in 2.0) and that the debris holds "metal and scrap". No item matched, so no recipe lines were sent and the model improvised from memory
  - Acceptance: "what do I do / how do I start / what's next" questions get grounded lines (inventory, hand-craftable, what's built nearby by kind, researchable next); answers name only things in the save; eval checks for known vanilla-memory mistakes
- [ ] FC-135 Research nagging on a new map
  - Notes: every answer said "Nothing is researching" although there's no lab yet. The snapshot always carries "research: nothing researching"
  - Acceptance: research state goes in the snapshot only for research, science or rate questions, or when labs are idle with nothing queued; unit tests
- [ ] FC-136 "I just built something"
  - Notes: the companion has no record of what the player builds
  - Acceptance: the mod keeps the player's last few builds (name, position, tick) from `on_built_entity`, in storage, capped; questions about what they built get them; benchmark shows no measurable cost; in-game test builds with `build_from_cursor`
- [ ] FC-137 A new map starts a new conversation
  - Notes: the new game's thread opened with a test question from another save; `data/session.json` isn't tied to a map
  - Acceptance: the mod gives each save a stable id (created once in `on_init`); the server keeps one conversation per map id and switches when the connected map changes; unit test; in-game check switching saves
- [ ] FC-138 New-game eval
  - Acceptance: `scripts/eval-new-game.ts` creates a fresh map with `--create`, hosts it, and runs the first-hour questions above with checks, saving to `data/eval/`; passes

## Notes

Activated on the player's request after their first-run walkthrough ("these are critical. We need to fix them."). The walkthrough ran from `~/projects/factorio` on a new Space Age game with the player's usual mods; the full reset (fresh clone, re-run setup) comes after these fixes.
