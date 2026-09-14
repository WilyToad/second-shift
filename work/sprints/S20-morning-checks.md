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

## Notes

Started 2026-09-14 morning with the player. FC-027 (Ctrl+Z) and FC-028 (fog of war) were verified first and recorded in S03.

## Review
