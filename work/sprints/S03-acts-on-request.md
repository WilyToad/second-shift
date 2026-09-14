# S03 — Acts on request

- **Status:** planned
- **Goal:** The companion can act for the player within the helmet rule: it finds what the player asks about, previews an action in the game world, and does it only after the player approves.
- **Acceptance:** On the dev save: "How many rails are near me on the right?" returns a count and the area searched. "Mark them for deconstruction" highlights exactly those rails in-game and shows an approval card. Confirming marks them, the action is on the player's undo stack, and Ctrl+Z (pressed by the player) restores them. A request the player couldn't do (outside radar coverage, or an instant delete) is refused with a reason. Profiler shows each action within the mod budget.
- **Started:** —
- **Finished:** —

## Items

- [ ] FC-077 Verify the character prototype dump in-game and refresh the prototype cache
  - Acceptance: after launch, recipe lines show "by hand" from the character's real crafting categories; `data/captures/prototypes.json` refreshed
  - First item because it needs the game running, which this sprint needs anyway
- [ ] FC-028 Pin down remote-view rules so action checks match the game (PLAN §8 Q10)
  - Acceptance: documented in PLAN what 2.0 lets a player do remotely (radar coverage vs charted) for deconstruction marks and entity search, verified in-game
- [ ] FC-024 Find and count entities near the player
  - Acceptance: "how many rails to my right?" returns a count and the area it searched
  - Notes: area-limited search only (PLAN §5); "right" = east; default radius stated in the answer
- [ ] FC-025 In-world highlight preview with automatic expiry
  - Acceptance: a query result can be highlighted on the exact entities; highlights disappear after a timeout or on cancel; visible only to the player
- [ ] FC-026 `mark_deconstruction` / `cancel_deconstruction` attributed to the player
  - Acceptance: marks exactly the previewed entities; re-checks the helmet rule when it runs; rejects anything a player couldn't mark
- [ ] FC-027 Verify undo for agent actions (PLAN §8 Q9)
  - Acceptance: the action appears on `player.undo_redo_stack`; the player confirms Ctrl+Z restores the marks
- [ ] FC-078 Model proposes actions through tool calls; "them" resolves to the last query result
  - Acceptance: the model calls a named action with arguments; the server validates it against the action list and the remembered query result before anything reaches the game
- [ ] FC-023 Action plumbing: named actions validated on the server, approval card in the web page
  - Acceptance: map-changing actions wait for Confirm/Cancel in the web page; nothing is sent to the game on Cancel
- [ ] FC-029 Helmet-rule test harness: every action fails when the player couldn't do it
  - Acceptance: scripted in-game checks on the dev save show `mark_deconstruction` refuses out-of-coverage targets and non-deconstructible entities
- [ ] FC-022 Measure large incoming RCON commands (blueprint-sized strings)
  - Notes: long commands may be split across ticks (PLAN §8 Q5)
  - Acceptance: measured time for 10 KB, 100 KB and 1 MB commands recorded in PLAN §8 Q5; limits written into the protocol

## Notes

Proposed 2026-09-13. Kept out on purpose: the alert feed (FC-020, FC-021) and blueprints (FC-030–FC-032). They don't serve this goal and can be their own sprint.

## Review
