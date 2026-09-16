# S29 — Send the spidertron

- **Status:** active
- **Started:** 2026-09-15
- **Goal:** The player can ask the companion to send their spidertron somewhere, confirm it in a card, and take it back instantly with a stop key — the first thing the companion moves in the world, with the rules that make that safe.
- **Acceptance:** "send my spidertron to the nearest copper" puts up a card naming the spidertron and the spot; on confirm the spidertron walks there with its own autopilot and the console says when it arrives; the stop key cancels it within a tick and says so; refusals tested in-game (no spidertron, no remote, another surface, a spot that isn't on the player's map, someone else driving it); nothing the player didn't ask for ever moves; mod benchmark unchanged; existing suites still pass.

## Items

- [x] FC-051 Stop hotkey and player-input conflict rules (PLAN §8 Q11)
  - Done: a `second-shift-stop` custom input (Alt+X, rebindable) cancels whatever the companion started, in the tick it's pressed; "stop" in words does the same through `stop_control`. One order at a time, held in `storage`, and the player taking over ends it by itself: driving the vehicle, using their own remote, or losing it (the death event is filtered to spider vehicles). Every stop says why, in the game and in the console feed (`control_stopped`), and arrival says so too (`control_arrived`). A source-level test (`server/src/mod-source.test.ts`) fails the build if the mod ever writes `teleport`, `speed`, `orientation`, `stop_spider`, `create_entity`, cheat mode or game speed
- [x] FC-144 Spidertron autopilot on request
  - Done: `send_spidertron` hands a spot to the engine's own autopilot after the player confirms a card ("Send the spidertron to the player at (17, 5)?"), and the companion proposes it in code from the player's words, so no new model tool and no change to the cached prompt. Refusals, tested in-game: no spidertron, no remote in the player's inventory, someone driving it, another surface, a spot that isn't on their map, over 1,000 tiles. Lookups cost 0.67 ms (near the player first, sweeping the surface only if nothing is close). In-game 10/10 (`scripts/test-spidertron.ts`, including walking there and reporting arrival), through the server 4/4 (`scripts/e2e-spidertron.ts`)
  - Notes: player idea (2026-09-15): walking stays the player's, but vehicles could be driven. Spidertrons have `autopilot_destination` built in, so "send my spidertron to the copper patch" is close to a named action. Character-level control: needs a confirm and a stop hotkey (FC-051); only the player's own spidertron, only to places they could send it with the remote
  - Acceptance: a card to confirm, the spidertron walks there with its own autopilot, the stop hotkey cancels it; refuses destinations the player couldn't pick with the remote; helmet test

## Notes

Planned and activated at the player's request (2026-09-15): "Let's just do the spidertron autopilot." Everything else from the driving discussion (FC-050 character control, FC-146 car and tank driving, FC-060 in-game panel) moved to the backlog's Future section. FC-051 stays with FC-144 because the sprint's goal needs it: the spidertron is the first thing the companion moves, so the stop key and the player-input rules ship with it.

From the FC-145 spike (`work/spikes/FC-145-driving.md`): spidertrons have the autopilot built in (`autopilot_destination`, `add_autopilot_destination`, `on_spider_command_completed`), so this is the small version of driving — the confirm card, stop key and refusals, with none of the steering risk. Clearing `autopilot_destination` is how a stop must work; `stop_spider` writes `speed` and is a cheat under the helmet rule.
