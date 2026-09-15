# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions


## Phase 3b — Character control

- [ ] FC-144 Spidertron autopilot on request
  - Notes: player idea (2026-09-15): walking stays the player's, but vehicles could be driven. Spidertrons have `autopilot_destination` built in, so "send my spidertron to the copper patch" is close to a named action. Character-level control: needs a confirm and a stop hotkey (FC-051); only the player's own spidertron, only to places they could send it with the remote
  - Acceptance: a card to confirm, the spidertron walks there with its own autopilot, the stop hotkey cancels it; refuses destinations the player couldn't pick with the remote; helmet test
- [ ] FC-145 Car and tank driving (stretch)
  - Notes: player idea (2026-09-15). The engine has no pathfinder for player-driven cars: a mod steers by setting riding state every tick and must route around obstacles itself, so this is much bigger than FC-144 and has a per-tick cost while driving. Never moves the character on foot
  - Acceptance: to be planned after FC-144 (research spike: steering approach, obstacle handling, per-tick cost while driving, stop hotkey)

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
  - Notes (player, 2026-09-15): walking stays a human thing: "I do NOT want the assistant to automatically move the player around." Drop `walk_to` when this is planned; vehicles are FC-144/FC-145
- [ ] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)

## Phase 4 — Optional

- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)
- [ ] FC-061 Background Factorio test instance for measuring blueprints
- [ ] FC-062 Voice in/out

## Tech debt and risks

