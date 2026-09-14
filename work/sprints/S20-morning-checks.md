# S20 — Morning checks with the player

- **Status:** active
- **Goal:** Everything the overnight run left for the player is checked or decided with them, and any change that comes out of it is made.
- **Acceptance:** Each item below is verified in-game with the player or decided by them, recorded here and in PLAN where it answers an open question.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-092 "Near me" while the player is in remote view
  - Notes: `player.position` is the remote-view position; searches and pastes "here" should probably use the character's `physical_position` unless the player means where they're looking. Decide with the player
  - Acceptance: the player's decision implemented and verified in-game
  - **Decided by the player: option 3 (mixed).** "here", "this spot", "on screen", "where I'm looking" follow the map view; "near me", "around me", "to my right/left", "where I'm standing" follow the character. With neither, searches use the character and placements (paste, map tag, camera, screenshot) use the view. When the two spots differ, the tool result says which one was used. A paste "near me" while viewing another surface is refused with a way forward (a paste only lands where you're looking). Mod: `util.anchor`, `from` on `find_entities` and `screenshot`, `surface` on `add_map_tag`, digest reports `remote_view`, `character_position`, `character_surface`. Tests: agent unit tests for the word rules, notes and the surface refusal; `scripts/test-anchor.ts` 5/5 in-game (remote view 120 tiles from the character: searches and a screenshot centre on the right spot); helmet 13/13, planning 13/13, screenshot 3/3, rails 6/6
  - Tried live by the player in map view, which found three problems, all fixed: (1) "belts" meant only yellow belts, because a bare "belt" nickname overrode the all-belt-types group, so both searches counted 0 next to 20 and 32 express belts; the nickname is removed ("yellow belt" etc. stay). (2) "How many belts are here?" reused the previous result instead of searching the view; "how many / find / where" questions now tell the model to search again. (3) The model gave the view's coordinates as the character's, because the snapshot only had one position; it now shows both in map view. Rerun on the live game: near me → 20 express belts around the character (9, 0); here → 32 around the view (152, 86), each saying which spot it used. The e2e and in-game test setups placed things at `player.position`, now the map view, so they leave map view first. After that: grounding 10/10, rails 6/6, planning 7/7, console 4/4, settings 3/3, diagnosis 4/4, helmet 13/13

- [x] FC-116 Recipe changes put leftovers where the game would
  - Acceptance: player check of a hand recipe change from map view; the companion's `set_recipe` matches it as closely as the API allows; in-game tests
  - Player check: an assembler 80 tiles away holding 20 iron plates, recipe changed by hand in map view: the plates went to the machine's `crafter_trash` slots (not the inventory, not the ground). Scripts can't insert into those slots (size 0, `can_insert` false, resize doesn't help; `scripts/probes/crafter-trash.ts`). **Decided with the player (option 1):** in reach of the character → the character's inventory (like a hand change next to the machine); otherwise spill next to the machine marked for the player's robots. `test-settings` 12/12 in-game (in reach: +20 plates to the inventory; out of reach: 10 plates on the ground, all marked); agent unit test; `e2e-settings` 3/3. Not player-checked: a hand recipe change while standing next to the machine (assumed inventory, per the docs' remote-view note)

- [x] FC-072 Close the hosted game port to the LAN (macOS firewall or another approach)
  - Acceptance: the player decides whether the open game port needs more than the current protections
  - **Decided by the player: leave it.** The GUI client ignores `--bind` when hosting (S12), so UDP 34197 listens on all interfaces; in place: random game password, max_players 1, no LAN or public listing. RCON stays on 127.0.0.1. Revisit if the game is ever hosted on an untrusted network (a macOS firewall rule blocking incoming connections for Factorio would close it)

## Notes

Started 2026-09-14 morning with the player. FC-027 (Ctrl+Z) and FC-028 (fog of war) were verified first and recorded in S03. FC-115 (the selection shortcut) was verified next and recorded in S17.

## Review
