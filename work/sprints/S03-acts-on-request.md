# S03 — Acts on request

- **Status:** active
- **Goal:** The companion can act for the player within the helmet rule: it finds what the player asks about, previews an action in the game world, and does it only after the player approves.
- **Acceptance:** On the dev save: "How many rails are near me on the right?" returns a count and the area searched. "Mark them for deconstruction" highlights exactly those rails in-game and shows an approval card. Confirming marks them, the action is on the player's undo stack, and Ctrl+Z (pressed by the player) restores them. A request the player couldn't do (outside radar coverage, or an instant delete) is refused with a reason. Profiler shows each action within the mod budget.
- **Started:** 2026-09-13
- **Finished:** —

## Items

- [x] FC-077 Verify the character prototype dump in-game and refresh the prototype cache
  - Acceptance: after launch, recipe lines show "by hand" from the character's real crafting categories; `data/captures/prototypes.json` refreshed
  - The server refetched on its own (mod list changed, 52 ms). The character hand-crafts `electronics`, `pressing`, `organic-or-assembling`, `maraxsis-hydro-plant-or-assembling` and more, which the naming heuristic would have missed
- [!] FC-028 Pin down remote-view rules so action checks match the game (PLAN §8 Q10)
  - Acceptance: documented in PLAN what 2.0 lets a player do remotely (radar coverage vs charted) for deconstruction marks and entity search, verified in-game
  - Waiting for player verification. No authoritative source found; adopted the conservative rule (only chunks the force can currently see, `force.is_chunk_visible`) in `scripts/helmet.lua`. The player needs to try a deconstruction drag over fog of war in remote view
- [x] FC-024 Find and count entities near the player
  - Acceptance: "how many rails to my right?" returns a count and the area it searched
  - Notes: area-limited search only (PLAN §5); "right" = east; default radius stated in the answer
  - `find_entities` in `scripts/actions.lua`; skips hidden prototypes and unseen chunks; 0.13 ms for a 48-tile half-square
- [x] FC-025 In-world highlight preview with automatic expiry
  - Acceptance: a query result can be highlighted on the exact entities; highlights disappear after a timeout or on cancel; visible only to the player
  - `highlight` / `clear_highlight`: selection-box rectangles, `players = {player}`, `time_to_live`; 0.10 ms for 8
- [x] FC-026 `mark_deconstruction` / `cancel_deconstruction` attributed to the player
  - Acceptance: marks exactly the previewed entities; re-checks the helmet rule when it runs; rejects anything a player couldn't mark
  - Checks in `scripts/helmet.lua` (own force or neutral trees/rocks, not-deconstructable flag, minable, visible chunk); 0.14 ms for 8
- [!] FC-027 Verify undo for agent actions (PLAN §8 Q9)
  - Acceptance: the action appears on `player.undo_redo_stack`; the player confirms Ctrl+Z restores the marks
  - Automated part verified: marking 8 rails adds one undo item with 8 `removed-entity` actions (same as one planner drag). Waiting for the player to press Ctrl+Z in-game
- [x] FC-078 Model proposes actions through tool calls; "them" resolves to the last query result
  - Acceptance: the model calls a named action with arguments; the server validates it against the action list and the remembered query result before anything reaches the game
  - `server/src/agent.ts` (unit-tested with a fake model and game) and `scripts/e2e-rails.ts`: 6/6 with the real model and game. World questions are classified in code (`needsWorldTools`); the model otherwise called find_entities on 4/10 recipe questions
- [x] FC-023 Action plumbing: named actions validated on the server, approval card in the web page
  - Acceptance: map-changing actions wait for Confirm/Cancel in the web page; nothing is sent to the game on Cancel
  - Approval card in the chat page; outcomes reach the model at the start of the next turn; stale cards expire
- [x] FC-029 Helmet-rule test harness: every action fails when the player couldn't do it
  - Acceptance: scripted in-game checks on the dev save show `mark_deconstruction` refuses out-of-coverage targets and non-deconstructible entities
  - `bun scripts/test-helmet.ts`: 13/13 (find right/left, highlight, mark, undo item, already marked, cancel, character refused, unseen chunk refused, no destroy action)
- [ ] FC-022 Measure large incoming RCON commands (blueprint-sized strings)
  - Notes: long commands may be split across ticks (PLAN §8 Q5)
  - Acceptance: measured time for 10 KB, 100 KB and 1 MB commands recorded in PLAN §8 Q5; limits written into the protocol

## Notes

Proposed and activated 2026-09-13. Kept out on purpose: the alert feed (FC-020, FC-021) and blueprints (FC-030–FC-032). They don't serve this goal and can be their own sprint.

## Review
