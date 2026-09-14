# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request

- [ ] FC-020 `events` action: ring buffer of urgent events with "since N" polling
  - Acceptance: server polls every ~250 ms; no event lost across polls; cost measured with the profiler
- [ ] FC-021 Alert feed in the web page
- [ ] FC-030 Blueprint string encoder/decoder in TypeScript
- [ ] FC-031 Blueprint checker: entities exist, no overlaps, recipe fits machine
- [ ] FC-032 Review a blueprint pasted into chat

## Phase 3 — Pleasant console and more actions

- [ ] FC-040 Full web console per the mockup
- [ ] FC-041 Choose a UI framework for the console
- [ ] FC-042 Visual component renderer and `rate_chart`
- [ ] FC-043 `recipe_graph` component
- [ ] FC-044 `layout_sketch` component with copyable blueprint string
- [ ] FC-045 Planning actions: `place_blueprint`, `mark_upgrade`, entity settings, `queue_research`, map tags, `camera_to`
- [ ] FC-046 Blueprint selection tool in the mod
- [ ] FC-047 Throughput analysis for builds and blueprints
- [ ] FC-048 Template-based blueprint creation
- [ ] FC-049 Screenshots and their game cost (PLAN §8 Q7)

## Phase 3b — Character control

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
- [ ] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)

## Phase 4 — Optional

- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)
- [ ] FC-061 Background Factorio test instance for measuring blueprints
- [ ] FC-062 Voice in/out
- [ ] FC-063 Session memory across play sessions

## Tech debt and risks

- [ ] FC-070 Find or build a heavier benchmark save (megabase scale)
- [ ] FC-071 Resolve the "Factorio Companion" name clash with ob1-s/factorio-AI-coop
- [ ] FC-072 Close the hosted game port to the LAN (macOS firewall or another approach)
- [ ] FC-075 Detect a paused game or open menu in the digest
- [ ] FC-076 Conversation trimming plan that limits cache invalidation
  - Notes: warm follow-ups are 2.5–2.8 s because history past the last 2,048-token block is re-prefilled each turn (PLAN §6)
