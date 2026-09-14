# S08 — Planning actions

- **Status:** done
- **Goal:** The companion can act on what it diagnoses, within the helmet rule: queue research, drop map tags, move the camera, mark upgrades and place small blueprints, with approval where the map changes.
- **Acceptance:** On the dev save: "research has stopped, what should I research? queue it" queues a researchable technology (refused if prerequisites are missing). Map tags and camera jumps run when asked. Upgrade marking and blueprint placement show an approval card and do nothing until confirmed, then happen exactly as a player's planner/paste would, with undo. In-game helmet tests prove each action refuses what a player couldn't do. Latency holds: grounding first token median ≤ 2.0 s and follow-ups ≤ 2.5 s median across runs. All regression suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-088 `queue_research` (small request, runs when asked)
  - Acceptance: queues only technologies whose prerequisites are researched and that aren't researched yet; refusal names the missing prerequisites
  - Agent `queue_research` resolves technologies from names or the items they unlock; research questions get the live "researchable now" list in the tail (so "pick something and queue it" chooses a real option). Runs immediately only if the player asked; otherwise a card
- [x] FC-089 `add_map_tag` and `camera_to`
  - Acceptance: tag appears on the player's map at a position they can see; camera jump opens remote view at a charted position; both refuse positions the player couldn't view
  - `map_action` tool (tag or camera, here or last result); runs when asked, card otherwise. Camera jumps use remote view
- [x] FC-090 `mark_upgrade` for the last result (approval)
  - Acceptance: marks upgrades a player's upgrade planner could (target entity exists, same size/type family, unlocked); undo item created; refusals tested
  - Card, then `mark_upgrade` on the last result (optional target); verified 4/4 belts marked in-game. The entity is resolved from the player's own words (the model once turned "yellow belts" into "fast transport belts")
- [x] FC-091 `place_blueprint` for small blueprints (approval, ≤ 48 KB)
  - Acceptance: places ghosts as the player at a chosen position like a paste; refuses unknown entities or blocked spots; undo item created
  - Pasted blueprint strings are kept server-side; `place_blueprint` card pastes at the player's position; ghosts in game matched the report (3/3)
- [-] FC-045 Planning actions: `place_blueprint`, `mark_upgrade`, entity settings, `queue_research`, map tags, `camera_to`
  - Split into FC-088–FC-091 for this sprint; entity settings (recipes, limits, filters) stay for later
- [x] FC-087 Follow-up latency watch after S07's prompt growth
  - Notes: grounding eval follow-up took 2.72 s after the find_stuck_machines tool and diagnosis rules were added (S05 target 2.5 s). Check with the latency report over several runs; trim rules or re-align if it holds
  - Acceptance: the S08 latency numbers above across at least three runs, recorded in PLAN §6
  - Held across 3 runs: first token median 1.16–1.43 s (max ≤ 2.01 s), follow-ups 1.90–2.04 s, 16-question conversation median 1.72 s / p90 2.30 s. Needed three fixes: machine list moved from the system prompt into retrieval (~2k stable tokens), each past question stored compacted, and an alignment bug (a fixed chars/token estimate stopped short of the boundary at 4,082 tokens)

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Follows S07: the diagnosis now finds root causes like "research has stopped", but the companion couldn't act on them.

## Review

The companion can act on what it finds: queue research, drop map tags, jump the camera, mark upgrades and paste blueprints. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ "Research has stopped. Pick something useful I can research right now and queue it." queued a
  real researchable technology (cheapest option, verified in the game's queue). Missing prerequisites,
  trigger techs and duplicates are refused with reasons (`scripts/test-planning.ts`, 13/13).
- ✓ Map tags run when asked; camera jumps open remote view; both refuse uncharted spots.
- ✓ Upgrade marking and blueprint pasting show a card first; after approval the game matched (4/4
  belts marked, 3/3 ghosts) with undo items created (`scripts/e2e-planning.ts`, 7/7 twice).
- ✓ Latency held across runs (see FC-087).
- ✓ All suites pass: grounding 10/10 ×3, rails 6/6, charts 2/2, blueprints 8/8, console 4/4,
  planning 7/7, diagnosis 4/4, helmet 13/13, machines 5/5, planning helmet 13/13.

**What we learned:**
- Every new tool grows the stable prompt. The latency guard (FC-087) caught a 6k-token system prompt
  and a follow-up regression; moving rarely needed data to retrieval fixed it better than padding.
- Storing past questions compacted is cheaper than keeping history byte-identical: the previous turn
  is re-read anyway because it sits past the last cache block.
- The model paraphrases the player's words into wrong entity names. The player's own words now win.
- Small requests the player didn't explicitly ask for become cards (the "agent suggestions always need
  a confirm" rule), decided from the player's wording in code.

**Carried forward:** entity settings (recipes, limits, filters) from FC-045; large blueprint pastes
(> 48 KB) need chunking; `physical_position` vs remote-view position for "near me" questions while the
player is in remote view (FC-092).

