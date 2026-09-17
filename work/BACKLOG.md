# Backlog

Unscheduled work, grouped by the phase in `PLAN.md` §7. Items move into a sprint when it's planned.

## Phase 2 — Acting on request


## Phase 3 — Pleasant console and more actions


## Phase 4 — Voice and extras

- [ ] FC-188 Keep the audio, so accuracy can be argued from the player's own voice
  - Notes: from FC-176's first recommendation and the player's own research pass (2026-09-17), both of which land on the same rule — test with your actual audio, because accents, game noise and a modded save's vocabulary matter more than any published word error rate. FC-185 already logs what the engine offered and what was picked, but not the sound, so there's nothing to re-run a different transcriber against. The capture itself is also step one of the eventual `/stt` build, so none of it is wasted if the answer turns out to be "keep the browser engine"
  - Acceptance: with capturing switched on (off by default, and the console says plainly that their voice is being written to disk), each spoken question writes a 16 kHz mono 16-bit WAV plus the FC-185 record and the browser's transcript into `data/captures/voice/` — gitignored, local only, never sent anywhere; the clip comes from an `AudioWorklet` or `OfflineAudioContext` rather than `MediaRecorder`, which only gives Opus; a way to say what they *actually* said per clip, because without ground truth there is no accuracy claim; capturing adds nothing measurable to the time-to-send, and the switch survives a reload
- [ ] FC-189 Three transcribers over the same clips, before any of them ships
  - Notes: the decision this is for — local model or keep the browser engine — rests on FC-176's stop conditions, and both research passes agree the ordering hints from leaderboards don't transfer to 3–6 s clips of one voice over game audio. Deliberately a measurement, not a `/stt` route: no server endpoint, no supervision, nothing wired into a turn. Installs (`brew install whisper.cpp`, any pip environment, model downloads of ~0.6–1.6 GB) are the player's decision and happen only when they say so
  - Acceptance: a script runs whisper large-v3-turbo (whisper.cpp or mlx-whisper), `parakeet-tdt-0.6b-v3` via parakeet-mlx, and Moonshine over the FC-188 clips, alongside the browser transcript already recorded, and reports per clip and in aggregate: exact match against what the player said, word error rate, and each of the three failure classes seen so far (near-homophone "wire/wine/where", numeral formatting "Got10", function words "of there"); run with and without the 555-word vocabulary as prompt or hotwords wherever the model supports it, so biasing is measured rather than assumed — `parakeet-mlx` has none (listed as *Todo*), and Qwen3-ASR's context biasing is an unverified claim worth half an hour before it's ruled in or out; added delay p50 and p95 with the model resident, against today's ~1.5 s to first token; hallucination counted on short and near-silent clips, because that's the failure that doesn't look like one; the verdict written into PLAN §5 either way, including "keep the browser engine" if the numbers say so

- [-] FC-061 Background Factorio test instance for measuring blueprints
  - Dropped (player, 2026-09-15): no second Factorio instance, and no custom simulator either. Approximate numbers are enough when the bottleneck is right; replaced by FC-161 (better estimates) and FC-162 (measure a build after it's placed)

## Phase 5 — Character control


## Phase 6 — Car and tank driving

- [x] FC-145 Car and tank driving: spike
  - Notes: player idea (2026-09-15); split into a spike and an implementation by the player. Never moves the character on foot
  - Acceptance: a written recommendation in the sprint notes and PLAN: steering approach, obstacle handling, measured per-tick cost of a prototype while driving, how the stop hotkey (FC-051) takes over, and whether to build it
  - Done: recommendation in `work/spikes/FC-145-driving.md` (2026-09-15), summarised in PLAN §7 Phase 6. It corrects this item's own premise: route-finding for a car-sized box *is* in the engine (`request_path` documents "emulate pathing behavior by script for non-unit entities, such as vehicles", taking a free-form bounding box and collision mask), while throttle and steering are only `riding_state` (4 acceleration × 3 direction states), so the work is a waypoint follower, not a pathfinder. Verdict: build a reduced version — drive a pre-checked path and stop rather than swerve — after FC-144, with FC-146's first task as a go/no-go measurement. Cost while driving is estimated at 0.02–0.04 ms/tick against ~0.05 ms of headroom, and the write-up says why the whole-tick benchmark can't see that and what to measure instead. `LuaEntity.orientation` and `.speed` are writable but are cheats (they snap past `rotation_speed` and bypass fuel and acceleration), which rules out how Autodrive and AAI do it

## Future — not now

Deferred by the player (2026-09-15): "file all except FC-144 as future items". They come back when the player asks.

- [ ] FC-050 `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
  - Notes (player, 2026-09-15): walking stays a human thing: "I do NOT want the assistant to automatically move the player around." Drop `walk_to` when this is planned; vehicles are FC-144/FC-145
- [ ] FC-146 Car and tank driving: implementation
  - Notes: planned from FC-145's recommendation (`work/spikes/FC-145-driving.md`); FC-144 (spidertron autopilot) ships first, because it needs the same confirm card, stop hotkey and refusals with none of the steering risk. Reduced scope: refuse any path needing something destroyed, cap path length and waypoints, stop rather than swerve when anything is in a look-ahead box, stop on damage to the vehicle, on player input, on the stop key, on losing the driver or the fuel; one vehicle at a time, on request; vanilla car first, tank behind its own tuning pass (`tank_driving` steers differently)
  - Acceptance (from FC-145): (1) a go/no-go measurement first — `request_path` for a tank-sized collision box with the tank's own mask across ~200 tiles of the dev save: success rate, `try_again_later` rate, response latency, and whether the paths are drivable for a ~2x3 box; if poor, stop and record the decision not to build; (2) per-tick script time idle vs driving under 0.05 ms average and no tick over 1 ms, with the `try_again_later` counter alongside (engine pathfinder time isn't in the script profile); (3) stop latency: control released within one tick of a key press, with the tiles travelled after it recorded; (4) helmet tests that must fail: uncharted destination, no fuel, a path needing something destroyed, not the driver, another surface, player presses a movement key, player exits, vehicle damaged — plus a test that the code never writes `orientation` or `speed`; (5) in-world path preview, approval card, and everything re-checked at confirm time
- [ ] FC-060 In-game UI (mod GUI chat panel / hotkey popup)

- [-] FC-169 Chests that sort themselves
  - Dropped (player, 2026-09-15) before any work: "drop FC-169 for now". Storage-chest filters only decide where *incoming* items land, so they don't consolidate what's already in 20 mixed chests — nothing moves until something pulls it. Once the chests are on the network, `get_supply_counts` says which one holds what, so finding things stops being the problem FC-169 was for. Revisit only if sorting still annoys the player after FC-168

## Tech debt and risks


- [ ] FC-187 A follow-up question can drift onto the wrong subject
  - Notes: same session as FC-184 (2026-09-17). The player asked about a red dot on the map ("that must be monsters"), whose turn was lost to FC-184; the next thing they said was "A bit further", and the answer searched 128 tiles north for **labs and assembling machines** and reported 0 of each — it had carried "10 of them" from two turns earlier ("I built 10 of them") as the subject. The enemy search the player wanted never ran. Worth watching rather than guessing at: it may partly be FC-184's lost turn leaving a hole in the history where the subject should be
  - Acceptance: a short follow-up ("a bit further", "what about over there") resolves to the subject of the *last* question that actually got an answer, and says what it searched for so a wrong guess is visible; unit tests over this session's three-turn sequence; no change to turns that name their own subject

- [x] FC-172 It undersells what it can build
  - Notes: player asked "build a line up to my metal" (a belt run from the coal drills to the furnaces) and the answer said "I can only do what a player could do — I can't build belts or place entities for you", then planned it in words. That's more modest than the truth: it can build a blueprint in code and paste it as ghosts behind a card, which is how the player's own robots build. What it can't do is place by hand — and early game, with no construction robots, ghosts would sit unbuilt, which is the part worth saying
  - Acceptance: a build request gets the accurate answer — what it can paste, that the player confirms it, and that ghosts need construction robots (so early game it's a plan, not a paste); the template library's limits (single production rows, no belt runs between two points yet) are stated plainly rather than as "I can't place entities"; unit test over the session's wording
  - Done: a build request now gets two guidance lines in the turn's tail — what it can actually do (a production row built in code, with inserters, input and output belts and poles, offered as ghosts on a card they confirm) and the real limits (no template for a belt run between two points or a mixed layout; ghosts need construction robots, so before robots a plan in words is the honest offer). It also fixes the reason the turn had nothing to work with: `wantsBlueprint` required the *word* "blueprint" plus a rate, so "build me 120 gears a minute" fell through to prose — the same request now builds the row. A described load ("I'm building an outpost, I need 20 ovens") still becomes a packing list rather than a build offer. Tests use the player's own wording; `eval-grounding` 10/10 after the change, first token median 1.13 s. **Not run:** `eval-requests`, which guards "cards only when asked" and needs the dev save hosted — worth running next time the game is up, since this widened what counts as asking for a blueprint
- [x] FC-170 "New conversation" left the alert feed alone
  - Notes: player, 2026-09-16: "I just clicked New Conversation, but I still see a bunch of old alerts." Two causes: the console's reset only cleared the thread, and the server replays the mod's whole event ring (200 events, no age limit) to every page that connects, so alerts from days ago in that world came back
  - Done: reset clears the feed and the missed-event count as well, and the replay on connect only carries events from the last 10 minutes of game time — enough to see what happened while away, without dredging up a week. Unit tests for both


