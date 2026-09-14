# S08 — Planning actions

- **Status:** active
- **Goal:** The companion can act on what it diagnoses, within the helmet rule: queue research, drop map tags, move the camera, mark upgrades and place small blueprints, with approval where the map changes.
- **Acceptance:** On the dev save: "research has stopped, what should I research? queue it" queues a researchable technology (refused if prerequisites are missing). Map tags and camera jumps run when asked. Upgrade marking and blueprint placement show an approval card and do nothing until confirmed, then happen exactly as a player's planner/paste would, with undo. In-game helmet tests prove each action refuses what a player couldn't do. Latency holds: grounding first token median ≤ 2.0 s and follow-ups ≤ 2.5 s median across runs. All regression suites pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-088 `queue_research` (small request, runs when asked)
  - Acceptance: queues only technologies whose prerequisites are researched and that aren't researched yet; refusal names the missing prerequisites
- [ ] FC-089 `add_map_tag` and `camera_to`
  - Acceptance: tag appears on the player's map at a position they can see; camera jump opens remote view at a charted position; both refuse positions the player couldn't view
- [ ] FC-090 `mark_upgrade` for the last result (approval)
  - Acceptance: marks upgrades a player's upgrade planner could (target entity exists, same size/type family, unlocked); undo item created; refusals tested
- [ ] FC-091 `place_blueprint` for small blueprints (approval, ≤ 48 KB)
  - Acceptance: places ghosts as the player at a chosen position like a paste; refuses unknown entities or blocked spots; undo item created
- [-] FC-045 Planning actions: `place_blueprint`, `mark_upgrade`, entity settings, `queue_research`, map tags, `camera_to`
  - Split into FC-088–FC-091 for this sprint; entity settings (recipes, limits, filters) stay for later
- [ ] FC-087 Follow-up latency watch after S07's prompt growth
  - Notes: grounding eval follow-up took 2.72 s after the find_stuck_machines tool and diagnosis rules were added (S05 target 2.5 s). Check with the latency report over several runs; trim rules or re-align if it holds
  - Acceptance: the S08 latency numbers above across at least three runs, recorded in PLAN §6

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Follows S07: the diagnosis now finds root causes like "research has stopped", but the companion couldn't act on them.

## Review
