<!-- Researched 2026-09-15 by a delegated research pass, then the decision-critical API claims were re-checked
against the installed runtime-api.json (2.0.77) in-session: request_path's "emulate pathing behavior by script for
non-unit entities, such as vehicles" and its bounding_box/collision_mask parameters; riding_state read/write as the
only steering control; LuaEntity orientation and speed being writable (so out on helmet grounds);
PathfinderWaypoint.needs_destroy_to_reach; and on_player_driving_changed_state not firing on ejection by
destruction. Every cost figure is an estimate: nothing was run in the game. -->

# FC-145 — Car and tank driving: spike recommendation

2026-09-15. API claims are checked against the installed
`doc-html/runtime-api.json` / `prototype-api.json` (2.0.77). **Nothing here was run in-game**
(the dev save was in use by another task), so every number is an estimate; §3 says what a
prototype must measure.

**Recommendation: build a reduced version — drive a clean, pre-checked path and *stop and say
so* instead of swerving. Ship FC-144 first, and make FC-146's first measurement a go/no-go gate.**

---

## 1. Steering approach

The BACKLOG note ("the engine has no pathfinder for player-driven cars") is half right. The
split is the main finding.

**Route-finding exists.** `LuaSurface::request_path` documents this exact use:

> Generates a path with the specified constraints (as an array of PathfinderWaypoints) using the
> unit pathfinding algorithm. **This path can be used to emulate pathing behavior by script for
> non-unit entities, such as vehicles.** […] returned asynchronously via
> `on_script_path_request_finished`.

Parameters: `bounding_box` ("the dimensions of the object that's supposed to travel the path"),
`collision_mask`, `start`, `goal`, `force`, `radius` (default 1), `entity_to_ignore`,
`can_open_gates`, `pathfind_flags`, `path_resolution_modifier` (`-8`..`8`, default 0 = a 1x1-tile
grid on tile centres), `max_gap_size` (0 = contiguous; >0 gives spider-style gaps). It returns a
handle; `on_script_path_request_finished` carries `id`, `path` (nil on failure) and
`try_again_later` (pathfinder too busy). So it *can* answer for a car-sized box — the box is a
free parameter and need not match any prototype.

Two documented gotchas. Pass the prototype's box: `LuaEntityPrototype::collision_box` is centred
on `{0,0}` while `LuaEntity::bounding_box` is shifted by position, and the shifted one is a
reported crash when water lies between start and goal
([90146](https://forums.factorio.com/90146),
[t=105167](https://forums.factorio.com/viewtopic.php?t=105167)). And `collision_mask` is
layer-based, so ask for the car's own `prototype.collision_mask` — water, cliffs and buildings
come free and the car cannot be routed where a car cannot go
([t=106448](https://forums.factorio.com/viewtopic.php?t=106448)).

**Throttle and steering do not exist.** `autopilot_destination`, `autopilot_destinations`,
`add_autopilot_destination` and `on_spider_command_completed` are spidertron-only ("this
spidertron's autopilot" / "spider vehicle"). That is why FC-144 is small and this is not. For a
car the only player-equivalent control is `LuaControl::riding_state` (read/write; "current
riding state of this car, or of the car this player is riding in"), a `RidingState` of:

- `acceleration`: `defines.riding.acceleration` = `accelerating` | `braking` | `nothing` | `reversing`
- `direction`: `defines.riding.direction` = `left` | `right` | `straight`

Four throttle states and three steering states — exactly the keyboard. So FC-146 is **not**
"write a pathfinder", it is "write a waypoint follower": per tick, read `car.position` and
`car.orientation` (`RealOrientation`, 0 = north, clockwise), advance the waypoint cursor on
arrival tolerance, turn the bearing error into `direction` with a dead band about
`rotation_speed` wide so it does not oscillate, pick `acceleration`, and write `riding_state`
once. The tuning is momentum (`prototype.weight`, `friction_force`, `braking_force`,
`consumption`, `effectivity`, `terrain_friction_modifier`) against turning radius
(`prototype.rotation_speed`; `prototype.tank_driving` marks tank-style controls, which need
their own pass).

**What must not be used.** `LuaEntity::orientation` and `LuaEntity::speed` are both writable
("only the speed of units, cars, and projectiles are writable"). Writing orientation snaps past
`rotation_speed`; writing speed bypasses acceleration, fuel and weight. Both are cheats here —
a load-bearing divergence from prior art, because Autodrive's documented method is "the vehicle
is rotated so that it faces in the direction of the next waypoint, [then] put in motion using
`LuaControl.riding_state`" ([autodrive](https://mods.factorio.com/mod/autodrive)) and the rotate
half is not copyable. AAI Programmable Vehicles historically teleported an invisible unit's pose
onto the vehicle each tick; also out.

## 2. Obstacle handling

**Static obstacles are the pathfinder's job, once.** Water, cliffs, trees, rocks and the
player's own buildings collide on layers the car's mask already includes. Two flags stay
`false`: `PathfinderFlags.allow_paths_through_own_entities` and
`allow_destroy_friendly_entities` — otherwise the route runs through the player's belts. Set
`cache = false` (the doc warns caching "might fail to respond to changes in the environment",
and a route through a live factory is exactly that). Never set `no_break` ("makes the pathfinder
not break in the middle of processing this pathfind, no matter how much work is needed") — a
direct threat to the no-tick-over-1-ms rule.

`PathfinderWaypoint.needs_destroy_to_reach` ("true if the path from the previous waypoint to
this one goes through an entity that must be destroyed") → **refuse the whole path**. Rails are
the known trap: Autodrive tells users to wall off rails to force cars through gates, and notes
the API "sometimes returns strange paths."

**Dynamic obstacles are the mod's job, and this is the unbounded part.** Biters, other vehicles,
trains and the player move after the path is found; nothing re-plans. Autodrive requests extra
clearance (`max(width, height) * 1.6`) and then relies on "bounce crashing" — "cars bounce
backward a bit after a crash which usually leaves enough clearance to re-path", plus "removing
any tree it actually hits." Closed to us: that damages the vehicle and removes the player's
trees unasked. The reduced design instead uses a **look-ahead box** a few tiles ahead, checked
with `surface.count_entities_filtered` (cheaper than `find_entities_filtered` — "it doesn't
construct all the wrapper objects"); anything in it → brake, stop, report. No swerving, no
ramming.

**Collisions.** `LuaEntityPrototype::energy_per_hit_point` is "the energy used per hit point
taken for this vehicle during collisions", so damage is derived from kinetic energy — heavier
and faster hurts more, both ways. A mod *can* detect it: `on_entity_damaged` gives `entity`,
`damage_type`, `final_damage_amount`, `final_health`, `cause` and `source`, and it is filterable
(`LuaEntityDamagedEventFilter`), so filtering to the vehicle for the duration of the drive
satisfies the "no unfiltered hot events" rule. Any damage on the vehicle → stop. There is no
collision event as such and no "what am I about to hit" query; `can_place_entity` /
`entity_prototype_collides` answer only for a static position, useful for validating start and
goal.

## 3. Cost

Headroom, from PLAN §5: steady-state script time is **0.034 ms/tick** against a **0.1 ms**
average budget, so driving has about **0.05 ms/tick** to spend and must never push a tick over
1 ms. Only one vehicle is ever driven, on request, so nothing here scales with factory size.

| Line item | Estimate, driving | Basis |
|---|---|---|
| Waypoint follower (reads, arithmetic, one `riding_state` write) | ~0.005–0.015 ms/tick | estimate; a handful of API reads vs. the measured 0.055 ms status poll that touches far more |
| Look-ahead box, every 6–10 ticks | ~0.01–0.02 ms/tick amortised | estimate, scaled from the measured 0.10 ms for a 32-tile `find_entities` |
| Yield/abort checklist (§4) | <0.005 ms/tick | estimate |
| Path request | ~0 script time, engine time unknown | `request_path` runs in the engine's pathfinder |
| **Controller loop, one car** | **~0.02–0.04 ms/tick (estimate)** | |

A car covers ~0.1–0.4 tiles/tick, so a look-ahead check every 6–10 ticks is the same safety far
cheaper — PLAN §5's amortisation rule.

**The measurement trap.** PLAN §5 already records the 5-run `factorio --benchmark` figure
ranging 0.043–0.107 ms/tick *with no per-tick change*. A ~0.03 ms cost is invisible to it. And
`request_path` spends engine time, so it appears in neither the script profile nor, reliably, the
benchmark. A prototype must measure both halves separately:

1. **Controller loop:** per-tick script time via `scripts/probes/bench-ticks.ts`
   (`--benchmark-verbose`) plus `helpers.create_profiler`, idle vs. actively driving; report
   delta and worst tick.
2. **Pathfinder pressure:** counters for `try_again_later` responses and request→response
   latency in ticks. A rising `try_again_later` rate is the only visible sign the mod is
   crowding the biters' pathfinder.
3. **Path quality** (measure this *first*, §6): success rate and drivability of `request_path`
   for a *tank*-sized `prototype.collision_box` across ~200 tiles of the dev save's mixed
   terrain, with the tank's own mask and `path_resolution_modifier = 0`. Coarser grids are
   tempting for speed but a ~2x3 box is exactly where they return paths the vehicle cannot take.
4. **Whole-tick:** `bun scripts/benchmark.ts` with a scripted drive, quoted only as a sanity
   check with its noise band stated.

## 4. How a stop takes over

Driving borrows the player's body, so this has to be right before anything else.

**Yield channels, best first.**

- **`linked_game_control` custom inputs.** `CustomInputPrototype.linked_game_control` accepts
  `move-up`, `move-down`, `move-left`, `move-right` and `toggle-driving`, and "when a
  custom-input is linked to a game control it won't show up in the control-settings GUI and will
  fire when the linked control is pressed." With `consuming = "none"`, "the custom input event
  will happen before the internal game event" — so the mod drops control in the same frame the
  player touches a movement key, and the game still steers normally. Costs nothing when no key
  is pressed. The mod already uses a custom input for push-to-talk (`data.lua`).
- **A divergence guard that cannot be wrong.** The docs do not say whether `move-up` fires while
  *driving* (those keys become steering input), so do not depend on it. Keep the `RidingState`
  the mod wrote last tick in `storage` and compare it to `car.riding_state` each tick; any
  divergence means something else set it → yield. One table read, no assumptions.
- **The stop hotkey (FC-051)**, a dedicated custom input that clears the drive.

**Per-tick checklist before writing anything** — all cheap, all mandatory:

1. `storage` says a drive is active for this player.
2. `car.valid`. `on_player_driving_changed_state` is documented as "not raised when the player
   is ejected from a vehicle due to it being destroyed", so check validity directly.
3. `car.get_driver()` is still the companion player, and `player.vehicle == car`.
4. `car.surface == player.physical_surface`.
5. Last-written `riding_state` still matches (the divergence guard).
6. No stop flag from a hotkey, movement-key event, damage event or the console.

**Stopping** means `riding_state = { acceleration = braking, direction = straight }` while the
car still moves, then `nothing`, then clear the drive and push a console event saying why. Never
`speed = 0`. `on_player_driving_changed_state` and `on_entity_died` are belt-and-braces cancels.
Everything that decides what happens next lives in `storage` (the desync rule): waypoints,
cursor, pending request id, last-written riding state. No module-locals.

## 5. Helmet-rule fit

It fits, because every input used is one the player has.

| Requirement | How |
|---|---|
| Same controls | `riding_state` only. Never `orientation`, `speed` or `teleport`. |
| Same route | `request_path` with the car's own `prototype.collision_box` and `prototype.collision_mask`; `allow_paths_through_own_entities` and `allow_destroy_friendly_entities` false. |
| Same cost | The engine burns fuel through normal acceleration. Check `car.get_fuel_inventory()` up front and refuse with a reason rather than writing `riding_state` and silently not moving. |
| Same reach | Refuse unless the player is the driver of that car, on that surface. |

**Refused:**

- A destination the player could not pick on their own map: gate on
  `force.is_chunk_charted(surface, chunk)`, the check `point_to` already uses in `actions.lua`.
  Gate the **destination**, not the route — a player driving reveals chunks as they go, so
  refusing uncharted route segments would be stricter than the player.
- Any path with `needs_destroy_to_reach`. A player *could* ram a tree; they did not ask to.
- No fuel; no driver; another surface; not the player's car; over the length/waypoint caps.

**Approval** — PLAN §3 puts driving under character control: confirm plus stop hotkey. So: the
player asks (unasked driving is dropped by `ASKS_FOR`, FC-126) → the mod requests the path,
draws it in-world (`rendering.draw_line` along the waypoints plus a goal marker, this player
only, with a TTL, same shape as `point_to`) and reports distance, estimated time and any refusal
→ an `action_preview` card with Drive / Cancel and the stop key named → on confirm the mod
re-checks everything and starts, refusing a path older than a few seconds → any stop reason ends
it and says why. Not a map change, so no undo entry.

## 6. Recommendation

**Build a reduced version. Ship FC-144 first. Gate FC-146 on its own first measurement.**

- The expensive half (route-finding for a car-sized box) is engine-provided and documented for
  this use; the cheap half (throttle and steering) is a small bounded controller.
- The unbounded half is dynamic avoidance, and it does not shrink with effort: Autodrive, a
  mature mod, still ships strange paths, rail traps and bounce-crashing — and bounce-crashing is
  closed to us on helmet grounds.
- Cutting dynamic avoidance removes that whole problem and leaves honest behaviour: **drive a
  clean path, or stop and say so.**

**The reduced version:** refuse `needs_destroy_to_reach`; cap path length (~500 tiles) and
waypoint count; stop rather than swerve on anything in the look-ahead box; stop on filtered
`on_entity_damaged` for the vehicle, on player input, on the stop key, on losing the driver or
the fuel. One vehicle at a time, on request. Car first; tank behind a separate tuning pass
because `tank_driving` steering differs.

**Why FC-144 first:** it needs the identical confirm card, stop hotkey, character-control flow
and refusal reasons with none of the steering risk, because the spidertron's autopilot is built
in. It proves the plumbing. If FC-144's stop flow feels bad in the player's hands, that is the
signal to drop FC-145 rather than prototype it.

**FC-146 acceptance:**

1. **Gate, measured first:** `request_path` for a `tank` `prototype.collision_box` with the
   tank's own mask, `path_resolution_modifier = 0`, across ~200 tiles of the dev save's mixed
   terrain — success rate, `try_again_later` rate, response latency in ticks, and whether the
   paths are physically drivable for a ~2x3 box. **If that is poor, stop and record the decision
   not to build.**
2. **Cost:** per-tick script time idle vs. driving (`bench-ticks.ts` + `create_profiler`); delta
   under 0.05 ms/tick average, no tick over 1 ms, with the `try_again_later` counter alongside,
   because engine pathfinder time is not in the script profile.
3. **Stop latency:** ticks from key press to `acceleration = nothing`, and tiles travelled after
   the press. Target: control released within one tick, braking after.
4. **Helmet tests that must fail** (`scripts/test-helmet.ts`): uncharted destination; no fuel;
   path with `needs_destroy_to_reach`; player not the driver; car on another surface; player
   presses a movement key mid-drive; player exits mid-drive; vehicle damaged mid-drive. Plus a
   test asserting the code never writes `orientation` or `speed`.
5. **Approval:** in-world path preview + `action_preview` card + confirm, re-checked at confirm
   time.

**Risks that would make me stop:**

- The pathfinder returns unusable paths for a tank-sized box (gate 1) — the most likely stopper,
  hence the gate.
- `try_again_later` rises in normal play, i.e. the mod competes with the biters' pathfinder. Not
  fixable from the mod beyond requesting less.
- Stop latency is not sub-tick, or the divergence guard cannot reliably separate player input
  from the mod's own write. A drive the player cannot instantly take back is worse than none.
- The follower needs per-prototype tuning for every modded car (maraxsis, Space Age; varying
  `weight`, `rotation_speed`, `tank_driving`). Ship vanilla car and tank and refuse the rest, or
  stop.
- It stops so often on a real base that the player drives themselves anyway. FC-144 will hint at
  this first.

---

### Sources

**Installed docs (the authority):**
`…/Factorio/factorio.app/Contents/doc-html/runtime-api.json` and `prototype-api.json`, 2.0.77.
Every `LuaSurface::`, `LuaControl::`, `LuaEntity::`, `LuaEntityPrototype::`, `defines.riding.`,
concept and event name quoted above was read from those two files, including
`CustomInputPrototype.linked_game_control` / `consuming` and the `LinkedGameControl` enum.

**Checked and absent:** no autopilot or destination API for cars (only spidertrons); no collision
event; no "what am I about to hit" query; no steering API beyond `riding_state`.

**Prior art / discussion:** [autodrive](https://mods.factorio.com/mod/autodrive) ·
[aai-programmable-vehicles](https://mods.factorio.com/mod/aai-programmable-vehicles) ·
[AAI vehicle pathing thread](https://mods.factorio.com/mod/aai-programmable-vehicles/discussion/5a5f1b0dadcc441024d76318) ·
[collision masks in request_path](https://forums.factorio.com/viewtopic.php?t=106448) ·
[bounding_box vs collision_box crash](https://forums.factorio.com/90146) ·
[how do I use request_path](https://forums.factorio.com/viewtopic.php?t=105167) ·
[path_resolution_modifier crash](https://forums.factorio.com/103056)

**Project:** `CLAUDE.md`; `PLAN.md` §3, §5, §7 (Phase 6), §8 Q11; `work/BACKLOG.md`
FC-051/144/145/146; `mods/second-shift/scripts/actions.lua` (`point_to`'s `is_chunk_charted`
gate, TTL rendering), `helmet.lua`, `util.lua`, `data.lua`.
