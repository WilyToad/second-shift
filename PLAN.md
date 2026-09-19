# Second Shift — Plan

A local AI companion that watches a Factorio game, advises the player in real time, and acts
on request the way the player's own character could. It runs entirely on this machine
against oMLX.

**Status:** Phase 1 vertical slice working end to end (2026-09-13). Stack: TypeScript on Bun (§4).

---

## 1. Goal

Play Factorio on the main monitor. A companion agent on the second monitor answers questions
("why is my green circuit throughput capped?", "what should I research next?", "plan a bioflux
setup for Gleba") grounded in *actual live game state*, not guesses.

It can also **act, as if it lives in the character's helmet** (decided 2026-09-13): "how many
rails are near me on the right?" then "mark them for deconstruction". It can do anything the
player could do, with the same tools, from the same places, at the same cost. It can never do
anything the player couldn't. See §3 "Actions".

**Non-goals:**
- **No god mode.** No instant destruction, spawned items, teleporting or other abilities a player
  doesn't have, even though a mod technically could. The mod's code enforces this, not the engine.
- **No unrequested actions.** The agent acts only when asked. Anything that changes the map or
  moves the character needs the player's approval first.
- Achievements don't matter (decided 2026-09-13). Console commands and anything else that
  disables achievements are fine for development, e.g. `/c` and `/editor`.
  The agent itself never gets raw console access.

### Use cases (ranked)

Researched 2026-09-13 from player forums, Steam discussions and the calculator-mod ecosystem,
ranked by value for *this* save. Tier 1 = deterministic Lua alert, Tier 2 = model (see §3).

| # | Use case | Tier | Grounding it needs |
|---|---|---|---|
| 1 | **Bottleneck diagnosis**: "why is X slow?" Walk entity statuses upstream to the root cause | 2 | Entity status by recipe, production stats, power |
| 2 | **Ratios/planning on modded recipes**. Web calculators only know vanilla/Space Age | 2 | `prototypes.json` (§6) |
| 3 | **Gleba spoilage**: buffering is the wrong instinct there; flag spoilage buildup, nutrient starvation, full biochambers | 1 + 2 | Biochamber status, spoilage/nutrient counts |
| 4 | **Fulgora scrap clogs**: one unconsumed byproduct stalls the line; find which one | 1 + 2 | Recycler status, per-item rates on Fulgora |
| 5 | **What to research or do next**: whatever removes the current bottleneck, not a fixed order | 2 | Research queue, bottlenecks, unlocked planets |
| 6 | **Space platform readiness**: asteroid defense for a route, ammo waste | 1 + 2 | Platform location, ammo, damage, chunk backlog |
| 7 | **Biters/pollution**: attack alerts; which side to reinforce; don't clear nests needlessly | 1 (+2) | Attacks, damaged walls/turrets, evolution per surface |
| 8 | **Train problems**: stuck/no-path alerts; explain chain-signal and stop-limit mistakes | 1 + 2 | Train states, wait times |
| 9 | **Modded planet guidance**: Maraxsis (stranded until rockets unlocked), Cerys puzzles. Model has almost no training knowledge here | 2 | `prototypes.json` tech tree |
| 10 | **Quality math**: upcycling cost (25% recycler return) vs productivity modules | 2 | Recipes, module stats |

**Implications:**
- Most of #1–8 need the same small set of data: entity status by recipe, production stats
  by surface, power, research, and train/platform state. That set is the Phase 1 `state.json` (§7).
- About half have a Tier 1 part, which supports the two-tier split.
- #2 and #9 are the strongest reason for a local, grounded agent over existing web calculators.

**Prior art:** most LLM Factorio projects *control* the game ([AI Companion](https://mods.factorio.com/mod/ai-companion),
[factorio_llm](https://github.com/nerdpudding/factorio_llm)). One project also called "Factorio Companion" is a
local read-only chat helper for 2.0: its mod sends a game snapshot over localhost UDP to a local
OpenAI-compatible server. Review it for ideas and a possible name clash before building.

---

## 2. Why this is feasible — verified, not assumed

| Capability | Evidence |
|---|---|
| Model is multimodal | `Qwen4ExpForConditionalGeneration` has `vision_config`, `image_token_id`, `vision_start/end_token_id` |
| Tool calling works | 90 `finish_reason=tool_calls` completions already in `~/.omlx/logs/server.log` |
| Model quality | 82.3% MMLU-Pro (n=300, paired) — best of the local models tested |
| Game is moddable | Factorio 2.0.77 Steam mac-arm64 (auto-updated from 2.0.76 on 2026-09-13), 21 mods enabled, modding already in use |
| Headroom | Flash-Next is 69.5 GB resident against a 118 GB ceiling |

---

## 3. Architecture — two tiers

The single most important design constraint is **latency** (see §5). Split by response-time budget:

**Tier 1 — the mod. Deterministic, instant, no inference.**
Attack alerts, power brownouts, full output buffers, low ammo, idle assemblers.
These are `if` statements in Lua. They must never wait on the model.

**Tier 2 — the agent. Advice and requested actions, 2–30 s.**
Analysis, planning, "why is X slow", research ordering, blueprint critique, and player-equivalent
actions the player asks for (§3 "Actions").
Latency is acceptable here because the player is already thinking.

```
Factorio (Steam client)
  └─ mods/factorio-companion  (Lua; player-equivalent actions only)
       ├─ tiny digest, pushed every few seconds       (aggregates only, see §5)
       ├─ query functions, answered on request         (detail computed only when asked)
       ├─ named actions, checked when they run         (§3 "Actions"; never raw Lua)
       └─ prototype data, only when the mod set changes (or offline via --dump-data)
                                  │  localhost RCON (§8 Q5), never periodic files
                          interfaces/  (transport, schema, query + tool definitions)
                                  │
                          server/  (agent loop: prompt assembly → oMLX → response)
                                  │
                          displays/ (local web app on 2nd monitor; in-game UI is a stretch goal)
```

### Display and UX (decided 2026-09-13)

Mockup: https://claude.ai/code/artifact/433cce2c-e0d4-421d-a875-49a8a582033b

- **MVP surface: a local web app on the second monitor**, served by `server/` on localhost and
  shown in a full-screen browser window. Factorio runs borderless on the main monitor.
  Electron was considered; it adds packaging and nothing the MVP needs (file watching and UDP
  live in the server process). Wrap it later if always-on-top or global hotkeys matter.
- **Stretch goal: in-game UI** (mod GUI chat panel, hotkey popup). Mod GUIs can't show
  markdown or runtime images, and they take space on the main monitor.
- **Layout** (see mockup): Tier 1 alert feed on the left, chat in the center, live state on the
  right (per-surface status, science rates, research, and a view of prompt size and cache use).
  The composer has a "Quick answer / Think it through" switch that maps to `enable_thinking`.
- **Camera jumps** happen when the player asks for one. It never moves the camera unprompted.
- **Unseen things stay unseen (decided 2026-09-15, FC-142).** Looks count only what's in chunks the player can see;
  the mod doesn't even count entities in unseen chunks for `find_entities`. The player's own machines are the exception:
  stuck machines out of view may be counted, worded as elsewhere in their factory (the player knows their factory, and
  the live panel already shows stuck counts for every surface).
- **Suggestions are offered in words (decided 2026-09-15, FC-126).** An action the player didn't ask for (in the
  question, or in an offer they said yes to) isn't run and gets no card: the call is dropped in code (`ASKS_FOR` in
  `server/src/agent.ts`) and the model offers it as a question instead. A yes makes it asked; map changes then still
  go through a card. Before, unasked suggestions became cards, and players got "I've dropped a tag, confirm it in the
  app" after "what do I do?". Measured in the S23 evals: 66 unasked calls dropped over 273 turns; the request eval
  (`scripts/eval-requests.ts`) shows cards only when asked, 26/26 over 2 runs.
- **Anything sent back into the game needs RCON or UDP.** Factorio Lua can't read files (§8 Q5).
  Actions, camera jumps, in-world highlights and in-game UI all use that channel.

### Visual component library

The agent answers with text plus **visual components**. For each one the model emits a compact
spec, and the web app renders it from real data. The model never draws freehand, and nothing
here is image generation. Rendering takes milliseconds; the real cost is spec tokens
(~60 tok/s decode), so specs use terse line formats, not verbose JSON.

| Component | What it shows | Rendered from |
|---|---|---|
| `rate_chart` | Item rate over a time window, with annotations | Snapshot history kept by `server/` |
| `recipe_graph` | Production chain with bad nodes highlighted | `prototypes.json` + entity status |
| `layout_sketch` | Top-down tile schematic of a build idea, with a "copy blueprint string" action | Tile grid spec, validated against prototypes (names exist, no overlaps) |
| `action_preview` | Approval card: what will change, how many entities, where. Paired with in-world highlights. | Action spec, dry-run result from the mod |
| `camera_jump` | A card proposing a camera move the player didn't ask for | Surface + position |
| `entity_map` | Simple top-down map of an area with problem entities marked | Entity positions from state |
| `screenshot` | An in-game screenshot of an area (`game.take_screenshot`) | Game, via script-output. Built in S19: ~0.1 ms in Lua, JPEG ready in 40–60 ms, no UPS drop (measured). |
| `comparison` | Side-by-side table (e.g. quality vs productivity modules) | Model-provided rows |

Inline game icons (`[item=…]`-style tags) use the icon sheets from the Factorio app bundle and
from mod zips. Each validated component shows its checks, e.g. "throughput not simulated".

### Actions: the helmet rule (decided 2026-09-13)

The agent has the character's hands, not god mode. **If the player can do it, the agent can.
If the player can't, the agent can't.**

Every action must pass three checks, and the mod re-checks them at the moment it runs, since the
game may have changed since the preview:
1. **Could the player do this?** The tool is available, the tech is researched, the items are in
   the inventory.
2. **Could the player do it from here?** Hands-on actions need the character in reach. Planning
   actions are allowed anywhere the game allows remote view to plan (radar coverage in 2.0).
3. **Does it cost the same?** Same time, items and robot work. No instant results.

**Approval** (decided 2026-09-13):

| Kind | Examples | Approval |
|---|---|---|
| Look | Find or count entities in an area, read a machine's status, inspect a blueprint | None |
| Small requests | Queue research, add a map tag or ping, a camera jump the player asked for | None: runs when asked |
| Map changes | Mark for deconstruction or upgrade, place a blueprint as ghosts, change a recipe, stop limit, filter or circuit setting | Preview (in-world highlight + `action_preview` card), then the player confirms |
| Character control | Walk somewhere, mine by hand, craft, move items between inventory and chests, drive | Confirm, and a stop hotkey that cancels immediately |
| Anything the agent suggests unprompted | "Want me to mark these?" | Always confirm |

Map changes are recorded as done by the player (the `player` and `undo_index` arguments), so they
should go on the player's own Ctrl+Z history (§8 Q9).

**Action catalog** (initial; each is a named action in the mod, built on player-equivalent API calls):

| Action | Built on | Behaves like the player |
|---|---|---|
| `find_entities` / `count_entities` | Area-limited search around a position | Looking around |
| `mark_deconstruction` / `cancel_deconstruction` | `order_deconstruction`, `deconstruct_area` with `player` | Deconstruction planner drag; bots do the work |
| `mark_upgrade` | `order_upgrade` with `player` | Upgrade planner |
| `place_blueprint` | Building a blueprint as ghosts with `player` | Pasting a blueprint |
| `set_recipe`, `set_stop_limit`, `set_filter`, … | The same settings the in-game menus change | Clicking in the menu (remotely where 2.0 allows) |
| `queue_research` | Adding to the force's research queue | Research screen |
| `add_map_tag`, `ping` | `add_chart_tag`, chat GPS tag | Same |
| `camera_to` | Remote view at a position | Opening the map / remote view |
| `walk_to` | `walking_state` plus `request_path` | Movement keys, real speed |
| `mine_by_hand` | `selected` + `mining_state`, one entity at a time | Holding the mine key: reach and mining time apply |
| `craft` | `begin_crafting` | Real ingredients, real crafting queue |
| `transfer_items` | Remove from the player inventory, insert into an entity in reach | Ctrl-click / drag |

**Never allowed:** creating real (non-ghost) entities, `destroy()`, `teleport`, inserting items
from nothing, changing tiles, instant mining that skips mining time, finishing research, cheat
mode, the map editor, changing game speed, and any arbitrary Lua.

**Enforcement is structural, not trust:**
- The agent can only call named actions. The server rejects unknown action names and never
  sends raw console commands.
- The mod implements each action and checks the three conditions itself.
- Tests prove each action *fails* when the player couldn't do it: out of reach, missing items,
  unresearched, outside radar coverage.

**Spatial language:** the camera never rotates, so "right" means east of the character. "Near"
uses a default radius. The agent always says how it read the request ("12 rails within 40 tiles
east of you") before a preview.

**Performance** (§5 still applies): searches are limited to an area and run only when asked.
Long actions (walking, mining a row by hand, placing many ghosts) are spread across ticks.

### Blueprints

- **Review:** paste a blueprint string into chat, or use the mod's selection tool to drag over a
  build. Either way the entities go to `server/`.
- **Encoder, decoder and checker in TypeScript.** A blueprint string is compressed JSON. Checks
  against `prototypes.json`: entities and recipes exist, no overlapping footprints, the recipe fits
  the machine, pipes and underground belts connect. Factorio 2.0 uses 16 directions; direction
  numbers differ from 1.1.
- **Throughput math in code:** machines × crafting speed × modules and beacons vs belt and
  inserter capacity, to find the real limit without the model guessing.
- **Creating:** the model picks a template and parameters ("smelting column, 24 furnaces, turbo
  belt, 8-beacon"); code builds the layout. **Built (S14):** a production-row template
  (`server/src/blueprint-template.ts`) for single recipes with at most 2 solid ingredients. A request
  with a rate is built before the model runs; poles are placed by inserter reach and wired
  explicitly, because pasted blueprints don't auto-connect. Measured in the dev game: gears 149.8/min
  for 150 promised, circuits 299.6/300, automation science 30.0/30. Not yet: fluids, furnaces, fuel
  machines, beacons, several rows. Sources: the player's own blueprints and well-known
  community designs. Freehand `layout_sketch` is for small ideas only and always goes through the
  checker.
- **Output:** a before/after preview, a copyable string, and `place_blueprint` (a map change, so
  it's confirmed).
- **Approximate, not simulated (decided by the player 2026-09-15):** no second Factorio instance and no custom
  simulator. Estimates only need the right bottleneck and a roughly right rate, said as a rounded range, pessimistic
  side first; they use measured inserter tables and machine insertion limits (FC-161) and are regression-tested
  against rates measured in the dev game. When the exact rate matters, it's measured in the player's own game from
  machines' `products_finished` over a minute (FC-162).

---

## 4. Directory layout

| Path | Purpose |
|---|---|
| `mods/factorio-companion/` | The Factorio mod: state export, queries and player-equivalent actions. `info.json` + `control.lua`. |
| `interfaces/` | Transport, state schema, query and tool definitions, component specs — the game↔agent contract. |
| `server/` | Agent loop, oMLX client, prompt assembly, conversation state. |
| `displays/` | Output surfaces. v1 = local web app on the 2nd monitor (§3). Later = in-game UI, voice. |
| `data/` | Captured state samples and prototype dumps for offline dev. Gitignored. |
| `scripts/` | Dev helpers (install mod into Factorio dir, replay a capture, `--dump-data`, benchmarks). |

**Stack (decided 2026-09-13): TypeScript on Bun, one process.**
- Bun is the runtime, package manager, test runner and bundler. It serves the web app (HTML
  imports with hot reload in development) and has UDP sockets, WebSockets and SQLite built in,
  so there are no extra dependencies for the hot path.
- No Vite for now. Vite is a frontend dev server, not an alternative to Bun. Add it only if we
  pick a UI framework that needs a Vite plugin (e.g. Svelte).
- UI framework (decided 2026-09-14, FC-041): **Preact + `@preact/signals`**. It's ~4 KB, JSX builds in Bun natively (no
  Vite), and signals update streamed tokens and live panels without re-rendering. Plain DOM wouldn't scale to three
  panels, cards and charts. Components get DOM tests with happy-dom (no browser needed).
- `Bun.udpSocket` is Bun-only; accepted, since this is a local tool.

---

## 5. Performance design — this is the whole game

Measured on this machine (2026-09-12), Flash-Next at 48k context:

| Path | Throughput | TTFT on ~32k prompt |
|---|---|---|
| Cold prefill | ~1,400 tok/s | **41.8 s** |
| Warm, 94% prefix-cache hit | ~16,200 tok/s effective | **~2.0 s** |
| Decode | 55–67 tok/s | — |
| Thinking budget 8192 | — | up to ~2 min |

**A 20x difference lives entirely in prompt ordering.** Every request must be assembled
stable-first so the cached prefix survives:

```
1. system rules + base overview     never changes      <- cached
2. prototype digest (modded data)   changes on mod change <- cached
3. conversation history             append-only        <- cached
4. current state.json snapshot      volatile           <- LAST, always
```

Putting volatile state anywhere but last invalidates the whole prefix and costs ~40 s per turn.

**Verified 2026-09-13 (`scripts/probes/cache.ts`):** oMLX caches in **2,048-token blocks** (every
measurement is a multiple: 2,048, 4,096, 14,336 = 7×, 22,528 = 11×, 57,344 = 28×). A
15,214-token prompt: cold 11.5 s to first token; repeated, 14,336 cached and 1.24 s; same prefix
with a new question or an appended turn, 0.93 s. Anything past the last full block is prefilled
again, so up to ~2k tokens of each prompt are uncached even when nothing changed. The server stores each user turn *with* its snapshot in
history, so the next turn's prefix is byte-identical to what was sent.

**Also:** pass `chat_template_kwargs: {"enable_thinking": false}` for quick lookups; reserve
thinking for planning questions. That alone is the difference between a 60 s and a 3 s answer.

### Speed is the top priority (decided 2026-09-13)

When a choice trades effort for speed or less lag, take the faster option up front. Factories
get huge, so every game-side cost must stay flat as the base grows.

Two different kinds of lag, in order of how much each decision is worth:

| Decision | Worth |
|---|---|
| Prompt ordering / prefix cache | ~40 s per answer |
| Thinking off for quick questions | up to ~60 s |
| Number of tool round-trips per answer | ~2 s each |
| Size of the fresh state digest | ~0.7 s per 1k tokens on a cold prefill |
| Mod cost per tick | game stutter / lower UPS, which is felt constantly |
| Transport (RCON ~17 ms, UDP ~45 ms round trip, measured) | milliseconds |

**Game side: cost is proportional to changes, never to factory size.**
1. **No full sweeps on a timer.** `find_entities_filtered` across a megabase is the thing that
   stutters the game. Never call it periodically.
2. **Read what the engine already aggregates.** Production statistics per surface
   (`force.get_item_production_statistics(surface)`), research state, and `player.get_alerts()`,
   which already tracks attacks, destroyed entities, turrets out of ammo, trains with no path or
   no fuel, and more. That covers most Tier 1 alerts at almost no cost.
3. **Entity registry kept up by events.** Track relevant machines through build/remove events
   (with event filters). Build the initial registry once, spread across ticks.
4. **Amortized status polling.** There is no "status changed" event, so check a fixed number of
   registered machines per tick in rotation and keep running aggregates in `storage`. The cost
   per tick stays constant as the base grows; only the refresh period gets longer.
5. **Pull, not push.** The pushed digest is tiny aggregates. Detail ("every stuck biochamber on
   Gleba") is computed only when a query asks for it, and capped.
6. **Small payloads.** Serialization (`helpers.table_to_json`) runs on the main thread, so keep
   routine messages small. Prototype data is sent only when the mod set changes, and
   `--dump-data` can produce it offline without the game running.
7. **No unfiltered hot events** (`on_entity_damaged`, heavy `on_tick` work).
8. **No periodic file writes.** Files are for one-off dumps and explicit captures only.

**Baseline (2026-09-13, `bun scripts/benchmark.ts`, dev save = copy of "Space Age Boom - Bio
Planet"):** 0.66 ms/tick (~1,500 UPS), worst tick ~3.3 ms, without the mod. Mod skeleton (RCON
command only, no tick handlers): no measurable cost. This save is mid-size, not a megabase; find
or build a heavier save before trusting the budget at scale.

**Megabase profile (S11, 2026-09-14, `bun scripts/megabase.ts`):** test tooling adds a lab-tile surface
with 22,254 assemblers (built through build events, never saved) to reach 25,000 registered machines.
Lua time per call from `helpers.create_profiler`:

| Path | Dev save (2,746 machines) | Megabase (25,000) |
|---|---|---|
| Status polling, one tick | 0.055 ms | 0.051 ms (refresh every 1,250 ticks) |
| Rate refresh step (every 30 ticks) | 0.060 ms (max 0.17) | 0.054 ms (max 0.18) |
| Alert sampler, 10 filtered `get_alerts` (every 30 ticks) | 0.027 ms | 0.040 ms |
| Events poll (every 250 ms) | 0.017 ms | 0.022 ms |
| Digest (every 2 s, incl. JSON) | 0.46 ms | 0.48 ms |
| `find_entities`, 32-tile radius | 0.10 ms | 0.11 ms |
| `find_machines`, all 22,254 matching machines | — | 0.79 ms (**was 5.9 ms, max 10.9**) |
| `find_machines`, player's surface, every recipe | 0.14 ms | 0.16 ms |
| `dump_prototypes` (mod change or research completed) | 27 ms | 26 ms |
| Registry scan, per tick (one-time) | listing Nauvis's 11,844 chunks: one ~7 ms tick | median 0.11 ms, p95 0.40 ms; a few ticks 1–2 ms |

What changed to get there (FC-102):
- **`find_machines` visits chunks, not machines.** Machines are indexed by surface → recipe →
  chunk, and each chunk group keeps its own status counts. Counts come from the groups, visibility
  is one check per chunk, and only up to 200 references touch individual machines. The old version
  walked every registered machine on every call.
- **Machines keep their name and position** (they never move), so lookups make no API calls
  except a validity check on the references they return.
- **The scan stops after 100 entities or 16 chunks per tick.** Its progress stays in `storage`, including
  each surface's chunk list (two flat number arrays). Walking the chunk iterator across ticks would avoid
  the listing tick, but the iterator can only live in a local, and a peer that just loaded the map
  wouldn't have it (desync). Deterministic wins over smooth for a once-per-save job.
- **Still open (FC-104):** listing a big surface's chunks takes one ~7 ms tick (Nauvis on the dev save),
  and a few scan ticks reach 1–2 ms while the registry tables grow past 8k and 16k entries. Both happen
  once per save. The 26 ms prototype dump on every research completion is a visible one-frame hitch (FC-103).

**With the mod (2026-09-14, after S11–S14, `bun scripts/benchmark.ts`, no player connected):** without
0.614 ms/tick, with 0.696 ms/tick, so **0.082 ms/tick** (1,800 ticks × 3 runs). Per-tick script time
(`scripts/probes/bench-ticks.ts`, `--benchmark-verbose`): 0.088 ms average with the mod vs 0.014 without; only 3
of 1,800 ticks over 1 ms, all from the one-time registry scan starting on a save without a registry:
7.5 ms at tick 0 and 6.5 ms at tick 741 (listing a big surface's chunks), 2.6 ms at tick 1340. The
benchmark's 1,800 ticks don't reach the end of that scan, so the steady-state cost is lower than the
average (polling alone profiles at 0.055 ms/tick). FC-104 tracks the listing ticks.

**Re-run after S15–S20 (2026-09-14, renamed mod `second-shift`, same command):** without 0.635 ms/tick, with
0.678 ms/tick, so **0.043 ms/tick**; worst tick 10.8 ms without and 11.0 ms with (the base game's own spikes). Within
the benchmark's ~0.05 ms run-to-run noise of the earlier result, so public copy says "under 0.1 ms per tick" and
names the one-time registry scan rather than quoting either number as exact.

**Re-run after S22 (2026-09-15, mod 0.2.0: build record, player status, surroundings, map id; 1,800 ticks × 5 runs):**
without 0.627 ms/tick, with 0.682 ms/tick, so **0.055 ms/tick** (an earlier 3-run pass read 0.102, inside the noise; a
second 5-run pass 0.054). Nothing new runs per tick; the player's own builds now reach one shared, unfiltered
`on_built_entity` handler. On-demand costs on the dev save (981 recipes, 1,405 force recipes): `player_status` 1.5 ms
with an empty inventory and 1.7 ms with plates (asking `get_craftable_count` for all 233 hand recipes measured
6.8 ms, so it's only asked for recipes the inventory can reach); `surroundings` 1.5 ms at radius 32 (the server's
default) and 7.6 ms at the 64 cap on a dense Gleba base.

**Registry scan spread out (S25, FC-104):** per-tick script time over 6,000 ticks: with the mod 0.047 ms in the last 600
ticks vs 0.013 without, so **0.034 ms/tick** steady state; the benchmark's rising 0.055–0.085 readings were base-game
noise. The chunk-listing ticks (8.1, 6.2, 3.2 ms) are gone: the scan walks a `LuaChunkIterator` kept in `storage` (it
survives save and load mid-scan, checked in-game), slowest scan tick 0.88 ms.

**Benchmark vs script profile (S25):** the 5-run benchmark read 0.107 ms/tick after S25, while per-tick script time
(`scripts/probes/bench-ticks.ts`) stays ~0.05 ms with the registry scan running and 0.034 ms after it. Whole-tick
benchmark readings have ranged 0.043–0.107 ms across runs with no per-tick change, so quote the script profile.

**Stable prefix overshoot (S25):** two new tools left the aligned prompt 83 tokens past its 2,048-token block (usual
~30); those tokens are re-read every turn: grounding first token 1.59–1.61 s vs 1.31–1.50 s without the tools (A/B,
same conditions). `alignToCacheBlock` now swaps the overshooting padding line for shorter ones: 4,126 tokens, first
token 1.14–1.39 s. Check the "aligned" line after adding tools or rules.

**Long voice conversations (FC-158, 2026-09-15):** the first voice session's first words took 5–7.6 s (server first
token 2.2–7.4 s). Two measured causes:
- **The model idles.** oMLX waits ~1.5 s before starting a request that arrives ≥3 s after the last one (1–2 s after:
  no wait); with the game running the wait was ~2.7 s in the logs. A 1-token request on a one-word prompt wakes it and
  leaves the conversation's cached blocks alone (`scripts/probes/idle-gap.ts`, `wake.ts`). Evals ask back to back, so
  they never showed it. The console now sends "wake" every 1.2 s while the player talks (words heard) or typed in the
  last 10 s; the server sends the ping unless a turn is running. A/B on 12 alternating turns with a 6 s pause and 4 s
  of talking each (`scripts/e2e-wake.ts`, game running): server first token median **1.1 s with wake-ups vs 2.7 s
  without** (1.00–1.59 vs 2.23–3.12); visible first words median 1.98 s vs 3.99 s.
- **History past the last cached block.** Prefill costs ~1 ms per uncached token past the cached 4,096 (410 → 0.70 s,
  1,215 → 1.14 s, 1,714 → 1.55 s, 2,216 → 2.34 s; `scripts/probes/suffix-prefill.ts`). History grows ~100–125 tokens a
  turn and oMLX stores the next block only once the prompt crosses it, so the uncached part rises to ~2,000 tokens and
  drops back each block (the session's turns at 6,144 cached had 376–950 uncached). Keep history append-only:
  compacting earlier rewrites cached blocks, which costs a cold prefill.

**The list in the game and the bots filling it (FC-164, FC-168, 2026-09-16):** the panel is drawn only when the
list changes (mod benchmark **0.031 ms/tick**, per-tick script time unchanged at 0.05 ms), shows the whole list with
done items ticked and greyed, caps at 25 lines and has nothing clickable — the player shows and hides it with
Alt+L and asks the companion for any change. Handing the list to the bots keeps the companion's requests in its own
"Second Shift" section of the player's requester point (0.09 ms to set), so their own sections come back untouched
(checked in-game); stopping switches the section off and leaves its slots, clearing the list removes it, and
`trash_not_requested` is read and warned about but never written.

**The packing list (FC-166, FC-167, 2026-09-16):** the player's own example — "20 ovens, a couple hundred belt,
enough arms to feed the ovens and chests for storage" — becomes a list with counts, and the save's data adds what
the build can't run without: fuel for burners, poles and a power-source reminder for electric machines, each with
its reason attached. The rule runs the moment the list changes, so one answer covers what was added and what the
player already has; items tick themselves off against stock. `scripts/e2e-packing.ts` passes 5/5 on the dev save.
Two rules came from getting it wrong first: pick the fuel the player *has* (else the most energetic gathered one,
not the least), and the pole that covers the most ground (else a big electric pole gets suggested, which reaches
far between poles but powers almost nothing).

**Stock: what the player can reach (FC-165, 2026-09-16):** their inventory plus the containers they can see within
48 tiles, summed by item with the nearest container for each and their free slot count. On demand only and capped
at 60 containers: **0.58 ms** for 22 containers on the dev save (50 item kinds), matching the game's own counts.
This is the pre-bots answer; with a logistic network the network can answer far more cheaply (FC-168).

**The list tool costs nothing (FC-163, 2026-09-16):** adding `update_list` left the system prompt at 3,876 tokens,
inside the same cached 4,096-token block, so eval-grounding first token came in at a median **1.29 s** (1.55 s
before it, same conditions) and the follow-up at 1.82 s. The active list rides in the turn's tail, so a long list
costs a few tail tokens rather than breaking the cache.

**The second shift itself (FC-193, 2026-09-18):** the background pass the name has promised since S01, now that
FC-192 has shown it's affordable. It is off until the player turns it on, looks every five minutes, and writes at
most one line into the console's feed — never spoken, never acted on, and nothing at all when the factory is fine.
The findings are computed in code (the turn's own `diagnose()` rules plus anything down more than 30% since the last
look, and only for lines above 10 a minute); the model is asked exactly one thing, which is which single finding is
worth a line and how to say it flat. A note that would need a grounding correction (FC-171) is dropped rather than
shown, because a claim nobody asked for is the easiest place for an invented name to hide.

Two rules keep it tolerable to leave on: the same finding stays quiet for 30 minutes, and **nothing at all is said
within two look intervals of the last note** — without that floor, a factory that dips and recovers produces a new
finding every look, never repeating itself and still chattering. **Re-measured with the real pass running** every 10
seconds rather than every five minutes: a lone request still reported `cached 4096` throughout, first token 0.63–0.68 s,
memory peaking at 83 GiB — so FC-192's conclusion holds for the actual feature and not just for the probe.

**Concurrency is cheap, not fast (FC-192, 2026-09-18):** oMLX 0.7.0.dev4 keeps Lightning MTP on across concurrent
requests, so a background pass is finally affordable — but not for the reason the release note gives.
`scripts/probe-concurrency.ts`, against the real aligned prefix: **the cached prefix survives everything** — a
concurrent request sharing our system prompt, one with an unrelated 4,534-token prefix, and three at once all left
a lone request reporting `cached 4096`, with the stranger holding its own 4,096 blocks at the same time. First
token moved 0.59 → 0.74 s with a job alongside, inside FC-191's run-to-run spread. Decode halves (45.4 tok/s alone,
27.4 each with one alongside, 14.8 each with three), which the player won't feel: 27 tok/s is ~20 words a second,
five times reading speed and six times what the voice speaks.

**The throughput claim doesn't transfer and shouldn't be repeated.** The release measured +34% and a local run
measured 1.6× total on long generations; at our 85–110 token answers, three concurrent gave ~44 tok/s total against
45.4 alone — no gain, the same work spread thinner. Memory peaked at 83 GiB footprint against the 118 GB guard
(and `ps` RSS is useless here: ~5 GiB for a model holding ~69 GB, because MLX weights aren't resident).
Write-up, including the five ways the probe measured the wrong thing before it measured the right one, in
`work/spikes/FC-192-batch-mtp.md`.

**Re-baselined on oMLX 0.7.0.dev4 (FC-191, 2026-09-18):** the runtime changed under us — Lightning MTP now stays
on across concurrent requests — so every figure below was re-measured rather than assumed. **Nothing moved beyond
run-to-run noise.** Block alignment is unchanged (aligned prompt **4,121 tokens**, boundary 4,096, against 4,120–4,122
before), so FC-178's "personality is free" and FC-181's "the table rides in the tail" both still hold. Twenty
eval-grounding turns on the new build: visible first token median **1.26 s**, single-round 1.25 s, with tools 2.31 s,
against 1.46 / 1.31 / 2.36 s from the whole prior history.

The honest comparison is eval-grounding against itself, and it says the same thing: three runs on the old build gave
medians of 1.13, 1.39 and 1.79 s; two on the new build gave 1.53 and 1.21 s. **The run-to-run spread is larger than
any difference between builds**, which is worth remembering whenever a single latency run is quoted as evidence.
Single-request decode is unchanged as expected — single-request MTP was already on — at a median **52.1 tok/s** over
23 turns against 49.3 tok/s over 116 turns on the old build. That is the baseline FC-192's concurrency numbers get
compared against.

**Ballast costs nothing (FC-178, 2026-09-17):** the companion has a name and eight lines of past
(`brand/CANON.md` is the single source; the prompt carries a condensed version and the test fails if the two drift).
Identity sits at the very top of the stable prefix, and `alignToCacheBlock` traded padding for it rather than
crossing a boundary: aligned prompt **4,120 tokens** against 4,122 before, system 4,080 against 4,078, and the
latency report is unchanged to the last measurement — median visible first token **1.46 s**, single-round 1.31 s,
with tools 2.36 s, before and after. Personality is free as long as it displaces padding; a stage table would not
be, which is why FC-180's table rides in the tail (§7 Phase 4).

`scripts/eval-canon.ts` asks him about himself — who he is, what he did before, what happened to the crew, what the
ship was called, whether he can fly them out — and checks he invents no ship name, crew member, date, cargo or
route, never supplies a fate for the crew however it's asked, and that a plain recipe question still answers plainly:
**46/46**. The blank about the crew is the load-bearing part, and he holds it: "That's all you get — the rest stays
where the ship is."

**Direction costs only the turns that ask for it (FC-181, 2026-09-17):** the stage table is authored text
(`server/src/stages.ts`, from FC-180's spike), and only the matched row rides in the tail of a "what should I do"
turn. Measured on the dev save: **107–164 tokens** per row (Gleba widest at 164, Nauvis lightest at 107, platform
121), against the whole table's ~2,650 — which is why it can't live in the cached prefix. At PLAN's suffix-prefill
rate of ~1 ms per uncached tail token that's ~0.16 s on those turns, and **nothing at all on every other turn**:
the lookup turns in the same run recorded zero player-line tokens, unchanged.

The row is chosen from what the save proves — the character's surface first (someone standing on Gleba with a silo
at home wants Gleba advice; remote view doesn't move them), then two planets producing, then the technology gates
from the most advanced down — and a row whose own names aren't in the save's dump is **withheld rather than
shipped wrong**, which is FC-171's lesson applied at load time. A modded planet with no row (maraxsis, cerys) and
an unrecognised technology tree both fall through to a row that asks instead of guessing. `scripts/eval-stages.ts`
**8/8**: the answer names nothing outside the dump, answers for the stage it's in, doesn't recite the table, and a
recipe lookup gets no direction at all. It also names the stage so the player can disagree, which they should: on
the dev save it said "Gleba, I'd say — though your view says otherwise… So I may have the stage wrong; tell me if
so."

**S31's experiment, run (2026-09-18, the player's Chrome session, ten sentences, nine clips kept):** the two
mechanisms were tested on both engines and the verdict is clean. **Chrome's online service refuses a phrase list
outright** (`phrases-not-supported`, the moment recognition starts) — biasing is on-device only, as the explainer
hinted. On that service the five test sentences came through 5/5 and **every winner was the engine's own first
guess**: rescoring the alternatives (FC-175) never changed an answer, and the one time it reordered anything was
"testing 1 2 3" → "testing one two three", overlap without sense. Tuesday's "of there" error was sitting in second
place, so the engine still makes it; it just didn't rank it first. **The on-device engine accepts the list (101
phrases), returns one alternative, and is far more sensitive to boost than the spike assumed:** the name at boost 8
produced "Ballast Ballast okay I'm running wireBallast Ballast…" forty times in one utterance, then "Ballastral";
at boost 1 across the whole list it went 4/5, missing "bottles **of** research" for "to". Also observed: the
on-device engine ends recognition mid-sentence like Safari, and FC-183's carry-over stitched the halves.

**So: FC-175 is removed (FC-210)** — inert on the service, nothing to work with on-device, and a known way to
make a right answer wrong. FC-177 stays as the on-device path at boost 1, to be raised only against measurement.
Yesterday's note that on-device was "stuck downloading" is superseded: it installed in under a minute today.
Ten sentences on a quiet evening is a measurement of what our code does with the engine's output, not of the
engine's accuracy; the nine clips in `data/captures/voice/` (one with the player's own correction) are FC-189's.

**Hearing the player properly (S31, 2026-09-17):** their early-game session had three of 24 spoken turns come
through wrong ("I'm running wire" → "running wine", "I've got 10 red bottles" → "Got10 red bottles", "a big red
dots on the map up there" → "a big red darts on the map of there"). Two changes, neither costing the prompt
anything: the player chooses the engine (on-device is used only when it's ready and they asked for it — Chrome
reports the model as still downloading here, so their session was on the online service all along), and the console
now asks for four transcripts and keeps the one carrying the most words from their own save, with the server
sending that vocabulary on connect (555 words, 5.5 KB on the dev save). A spoken question is also marked as spoken,
so an odd word reads as a mis-hear. Whether the online engine's alternatives really rescue these cases is for the
player's next session to show; if not, FC-176's local transcriber is the answer.

**Sending the spidertron (S29, 2026-09-15):** the engine's own autopilot does the walking, so the mod only hands
it a spot after the player confirms a card, and the order lives in `storage` so the stop key can end it. Looking up
the player's spidertrons costs **0.67 ms** (near the player first; a type-filtered sweep of the whole gleba surface
was 4.0 ms, so that only runs when nothing is within 256 tiles). Mod benchmark after the module was added
(5 runs): without 0.644, with 0.725, so **0.080 ms/tick**; per-tick script time 0.070 ms with the mod vs 0.017
without (last 600 ticks 0.055 vs 0.014) — unchanged, because nothing new runs per tick. In-game 10/10
(`scripts/test-spidertron.ts`), through the server 4/4 (`scripts/e2e-spidertron.ts`). The request is recognised in
code and proposed as a card, so the cached prompt is untouched: no new model tool.

**Facts instead of memory (FC-160, 2026-09-15):** the prototype dump (v10) now carries what a modded save can change
about a thing itself: chest inventory size, logistic job, fluid capacity, and a pole's supply area and wire reach.
Those go into the pointed-at lines, and the turn asks for the save's facts only. Before: "what is this?" on a passive
provider chest added "inserters can pull items out of it, but nothing puts items in" (wrong) and two of four answers
explained mechanics nobody asked about. After (`scripts/eval-pointing.ts`, 9/9): the facts are the save's own
(48 stacks, 25,000 fluid, 15 items/s, "powers machines within 3.5 tiles"), one sentence still describes what a thing
does and it matches those facts, and answers add "that part is base game; mods can change it" when asked further.

**Measured output (FC-162, 2026-09-15):** every machine counts its own finished crafts, so `machine_output` reads
them twice and reports the real rate from the player's own game — no estimate. On demand only, capped at 200
machines a read (about 6 µs a machine: 200 in 1.03 ms, measured), refusing machines the player can't see. In-game
the reported rate matched the game's own craft counts (289.9 vs 289.0/min over 10 s), and through the server
"what rate are they really hitting?" answered 266/min against 263.9/min measured independently
(`scripts/e2e-measure.ts`).

**Re-run after S28 mod changes (2026-09-15, dump v10 fields and `machine_output`, 5 runs):** without 0.678, with
0.729, so **0.051 ms/tick**; per-tick script time 0.066 ms with the mod vs 0.016 without (last 600 ticks 0.055 vs
0.014), slowest script tick 0.32 ms. Nothing new runs per tick.

**Throughput estimates against the game (FC-161, 2026-09-15):** `scripts/test-generated-builds.ts` now feeds each
generated row through its own belts (the level script tops up the head of the input belt and empties the tail of the
output belt, one surface per case), so belts, inserters and machines all count. Three healthy rows and two crippled
ones (half the input inserters removed; every inserter replaced with a plain one), 13/13: measured 149.8, 300.2 and
30.2/min against promises of 150, 300 and 30, and the estimate landed within **1.1%** of the game on every case,
blaming the right part each time. What the estimate gained: a belt lane cap (`belt_speed × 240` items a second, the
biggest correction — a bulk inserter with a big hand on a yellow belt moves ~6.4/s, not 30/s), a hand-size share for
belt ends fitted to the wiki's 2.0.26 tables and to a measured row (plain inserter, hand 3: 2.38/s measured, 2.39/s
estimated), the game's machine insertion rule (a machine holds one craft plus what it finishes in one swing), and
zero output for a machine with no inserter on a side. Rates are now given as a range with the cautious end first.
An input-belt lane limit can't be measured with this rig: a scripted feed isn't held to belt speed the way a real
source is (`scripts/probes/belt-feed.ts` measures the feed at exactly one lane per lane, but a consumer taking a
batch frees the entry sooner), so the lane cap is checked against the wiki's tables in unit tests instead.

**Numbers in answers (FC-153, 2026-09-15):** no calculator tool. Every tool round pays another first token (1–2.5 s in
the voice session's logs; turns with a tool round reached first words in 3.3–5.4 s vs 1.5–2.0 s for one round in
`scripts/e2e-wake.ts`), and the model would still have to choose to call it. Instead the save's facts come in the
turn's lines (follow-ups like "what do I use these for?" retrieve for what the last answer named) and sums written out
in an answer are checked in code afterwards, adding a correction line (no model time).

**Voice session replay (S27 acceptance, 2026-09-15, `scripts/eval-voice-session.ts`):** 8/8; first words median
1.52 s, max 4.16 s, against 5.66 s and 10.02 s in the original session.

**Re-run after S27 mod changes (2026-09-15, hover record, `pointed_at`, `container_contents`, highlight boxes tied to
entities, 5 runs):** without 0.779, with 0.899, so 0.121 ms/tick whole-tick, while per-tick script time
(`scripts/probes/bench-ticks.ts`) reads 0.075 ms with the mod vs 0.019 without (last 600 ticks 0.055 vs 0.014), slowest
script tick 0.88 ms: in line with S25 (nothing new runs per tick in a benchmark; the hover event only fires when a
player's mouse moves to another entity). A selection change costs ≤18 µs including the engine's own work (5,000
scripted changes in 90 ms, `scripts/probes/hover-cost.ts`), so a fast mouse sweep over a dense area stays well under
the budget. On demand: `pointed_at` 0.06 ms, `container_contents` 0.08 ms.

**Re-run after S24 (2026-09-15, `find_entities` stops counting unseen entities, 5 runs):** without 0.624, with 0.708, so
**0.085 ms/tick**. No per-tick change since S22, but the readings have gone 0.055, 0.070, 0.085: profile per-tick
script time (`scripts/probes/bench-ticks.ts`) before the next mod change.

**Re-run after S23 (2026-09-15, wider resource look in `surroundings`, 5 runs):** without 0.619, with 0.689, so
**0.070 ms/tick**, within the noise of 0.055 (nothing new per tick). On demand on the dev save: `surroundings` with no
resources within 32 tiles looks for resources out to 96 in 2.1 ms.

**Measure every mod change** with `factorio --benchmark <save copy> --benchmark-ticks N`,
with and without the companion mod, and watch the in-game time-usage debug view (F4 →
show-time-usage). Proposed budget: under 0.1 ms per tick on average, no single tick over 1 ms.

**Server side:**
- One Bun process. The web UI gets updates pushed over a WebSocket, never by polling.
- Snapshot history lives in an in-memory ring buffer. Persist it to SQLite in batches, if at all.
  No file per snapshot.
- Warm the model's prefix cache when the server starts and when prototype data changes, so the
  first question isn't a ~42 s cold prefill.
- Do analysis in code, not in the model. For example, walk bottlenecks and compute ratios in
  TypeScript, then give the model conclusions. That means fewer tokens and fewer round-trips.

---

## 6. Grounding on MODDED data

This save runs Space Age + maraxsis + Cerys-Moon-of-Fulgora + factorissimo-2 + PlanetsLib.
The model's training knowledge of "Factorio recipes" is vanilla and will be confidently wrong.

**Therefore:** the mod dumps real prototype data (`prototypes.json`) from the running game —
recipes, technologies, items, planets, as actually loaded. The agent grounds on that file,
never on recalled recipes. Treat any model statement about a recipe it can't cite from the
dump as a hallucination.


**Measured 2026-09-13 (FC-011, `scripts/probes/recipe-digest.ts`):** as compact one-line text, the
save's data is 34.7k tokens of recipes (21.9k unlocked only), 22.0k of technologies, 2.0k of
machines and 0.6k of spoil/fuel traits: 59.3k in total. With all of it in the cached prefix, the
first question took 42.3 s and a warm follow-up 4.17 s. Warm first-token time grows with context
length (15k → 0.93 s, 26.7k → 4.05 s with a ~2.7k uncached tail, 59k → 4.17 s), and uncached tail
tokens cost ~0.75 s per 1k.

**Decision (FC-011):** a small cached prefix (rules, machines, item traits, ~3k tokens). The server
retrieves the recipe/technology lines relevant to each question in code (name and alias matching,
one level of ingredients and uses, capped) and puts them in the uncached tail next to the
snapshot, with no extra model round trip. Retrieved lines stay in history like the snapshot.
Lookup tools are a later fallback for what matching misses. Target tail: question + ≤ ~1.5k
tokens of retrieved lines + snapshot.

**Result (S02, 2026-09-13, `scripts/eval-grounding.ts`):** 10 questions (Gleba, maraxsis, Cerys,
nicknames, research prerequisites and triggers, spoilage, machine speed, one nonexistent item),
expected facts computed from the dump. Final runs with a replayed digest: 10/10 (all 30 factual
checks passed across the last three runs), first token median ~1.6 s and max ≤ 2.2 s, warm
follow-up 2.5–2.8 s, answers median ~70 tokens. What made the difference:
- Computed "made in" crafters on recipe lines. The model otherwise confused `organic` with
  `organic-or-assembling`.
- Retrieving the technology that unlocks a matched item, and research triggers written as verbs
  ("trigger: craft 1 biochamber").
- Snapshot production lines only when the question is about rates or names a tracked item.
- An 80-word limit that still requires every amount, machine, prerequisite and trigger.
- Qwen's recommended sampling (temperature 0.7, top-p 0.8, top-k 20); oMLX defaults to 1.0.

Follow-ups sit at 2.5–2.8 s because history past the last 2,048-token block is re-prefilled on
every turn.

**With tools (S03, 2026-09-14, `scripts/probes/tools-latency.ts`):** the tool definitions grow the
system prompt past 4,096 tokens, so warm prompts cache 4,096. First visible token for a recipe
question is ~0.75 s warm with the game closed. Measured costs on top of that:
- A running game costs ~12% on cached prefill (0.92 s vs 0.82 s on a 15k prompt).
- There's a constant ~0.33 s between oMLX's reported first token and the first visible text.
- An unnecessary tool round trip adds 3–5 s. The model made one on 4 of 10 recipe questions until
  the server started classifying world questions in code and adding a no-tools note to the other
  turns. `tool_choice: "none"` isn't usable: oMLX drops the tools from the prompt, which breaks
  the cached prefix.
- Grounding eval with the game running and live snapshots: 10/10, first token median 2.56 s, max
  3.61 s. Rails flow: first answer in 3.5–4.7 s total, including the find round trip.

**Cache block alignment (S05, 2026-09-14, `scripts/probes/block-alignment.ts`):** the stable
prefix (rules, machines, traits, tool definitions) was ~3,770 tokens. oMLX caches whole 2,048-token
blocks, so every *new* question re-read ~1,700 stable tokens: server first token median 2.03 s.
Padding the prefix with useful reference lines (recipe category → crafters) until it crosses 4,096
brought the same novel questions to **0.80 s**. The server now does this automatically at startup
and whenever prototypes change (`alignToCacheBlock`, measured through oMLX, so the template's own
tokens count). With a 60-word answer limit, the S05 suite with the game running: first token median
1.23 s, max 1.92 s; follow-up 2.39 s; answers median 90 tokens; tool turns ~3.3 s (two model calls).
Per-turn breakdowns: `data/eval/turns.jsonl` → `scripts/latency-report.ts`.

**Final S05 numbers (2026-09-14, game running):** after tighter retrieval (uncached tail 1,004 → 531
tokens) and conversation compaction (history over ~8k estimated tokens loses old recipe lines and
snapshots, then the cache is re-warmed), first token median 1.11 s and max 1.80 s; follow-ups in a
16-question conversation median 1.59 s, p90 2.23 s, max 2.51 s. When aligning, the measured prefix
includes the probe's placeholder user turn (~10 tokens), so alignment keeps a 24-token margin.
Aligning exactly to 4,096 cost a whole block (first token 2.48 s).

**S08 prompt changes (2026-09-14):** planning tools pushed the system prompt to 6,169 tokens, and
follow-ups rose to 2.75–2.85 s. Three fixes restored the targets:
1. The machine list moved out of the system prompt into retrieval (machines named in the question,
   and crafters for rate/machine questions).
2. Each past question is stored in history compacted (no recipe lines or snapshot). The previous turn
   sits past the last cache block and is re-read either way, so a short version is cheaper than a
   byte-identical one.
3. Alignment re-estimates chars/token from the reference lines it adds (a fixed estimate stopped at
   4,082 < 4,096).

Result over 3 runs: first token median 1.16–1.43 s, follow-ups 1.90–2.04 s, 16-question conversation
median 1.72 s / p90 2.30 s. The system prompt is now 4,121 tokens. Conversation trimming (FC-076) and block-aware prompt layout are the next levers.
---

## 7. Phases

Phases are the roadmap. Day-to-day work is tracked as goal-based sprints in `work/`
(`bun run board`); each sprint pulls items from `work/BACKLOG.md`, which is grouped by phase.

**Current phase (2026-09-18): Phase 4, voice and extras.** Phases 1–3 are done. Phase 5 has its first action
(the spidertron, S29) and the rest is deferred by the player; Phase 6 is a spike plus a deferred implementation.
What's open in Phase 4 is verification by the player (`work/VERIFY.md`) and the local transcriber comparison
(FC-189); S33 is paying down debt across all of it without the game running.

**Phase 1 — vertical slice (target: one evening)**

Setup decisions (2026-09-13): git with small commits; RCON keys in the real `config.ini`;
develop and benchmark against a copy of the largest save ("Space Age Boom - Bio Planet", 22 MB)
in `data/`. Order: workspace → launcher → mod skeleton → benchmark baseline → protocol →
server → web chat. oMLX model id: `Qwen3.8-Flash-Next-oQ4e-mtp`; API key read from
`~/.omlx/settings.json` at runtime, never committed.

- Server polls the mod over RCON for a small digest (§8 Q5), built from engine
  aggregates and amortized polling (§5). Proposed contents, from §1 use cases:
  - tick, player's current surface
  - entity status counts by recipe per surface (working / no ingredients / output full / low power), for #1, #3, #4
  - top item production/consumption rates per surface, for #1, #2, #4
  - power satisfaction per surface, for #1
  - current research, progress and queue, for #5
  - enemy evolution factor per surface, for #7
  - trains waiting at signals or with no path, for #8
  - space platforms: location, state, ammo on hand, for #6
  - No full entity scans (§5). Benchmark the mod on a copy of the real save from day one.
- `server/` receives it, answers one typed question with state in context
- Output to a minimal local web chat page (streaming text only, no visual components yet)
- *Success:* one grounded answer, end to end, under 5 s warm

**Phase 1 result (2026-09-13): done.** On the dev save, asked through the web chat:
"What's my science output?" (751-token prompt) got a correct grounded answer with the first
token in 2.1 s and the whole answer in 3.8 s. A follow-up about iron plates (1,487 tokens) took
1.5 s and 2.4 s and quoted the live rate (798/min on nauvis-factory-floor). The mod's cost on the
benchmark is within noise. Model load on a cold oMLX is ~22 s, absorbed by the warm-up at server
start.

Follow-up the same day: the first science answer was technically right ("no science output") but
missed that science had *stalled* (0/min now, ~15–17/min over 10 h), and it listed vanilla pack
names that weren't in the data. The digest now reports every science pack with current and 10-hour
rates, and the rules forbid naming items that aren't in the data. Re-asked, the model reported
the stall, cited "nothing researching" and the 10-hour averages. First token 2.1 s; the full
232-token answer took 7.1 s at ~45 tok/s, so long answers exceed 5 s total. Keep answers short or
judge by time to first token.

**Phase 2 — make it useful, and let it act** — done (S02–S08)
- Prototype dump + grounding
- Prefix-cache-aware prompt assembly (§5) — verify the ~2 s warm path holds
- Tier-1 alerts firing from Lua, no inference, shown in the web app's alert feed
- Richer state: production rates, logistics, research, per-planet
- Measure large incoming RCON commands (e.g. a big blueprint string) before `place_blueprint`
- First actions: `find_entities`/`count_entities`, `mark_deconstruction`/`cancel_deconstruction`,
  with in-world highlight preview, approval card, and undo
- Blueprint encoder/decoder/checker; reviewing pasted blueprints
- *Success:* "how many rails are near me on the right?" → "mark them for deconstruction" →
  preview → confirm → bots remove them → Ctrl+Z restores them

**Phase 3 — make it pleasant** — done (S04, S13–S25)
- Full web console per the mockup (§3): live state rail, visual component library
- More planning actions: `place_blueprint`, `mark_upgrade`, entity settings, `queue_research`,
  map tags, `camera_to`
- Blueprint selection tool, throughput analysis, template-based creation
- Tool calling: let the agent pull detail on demand rather than stuffing everything in context
- Optional: screenshots for layout/blueprint questions (model is multimodal)

Phase order decided by the player 2026-09-15: voice and the other console extras come before character control,
and car driving is last, split into a spike and an implementation.

**Lists the agent keeps (decided with the player 2026-09-15, S30).** Inventory management is the player's biggest
day-to-day pain, and half of it is a to-do list: "I'll need 20 ovens, a couple hundred belt, arms to feed them,
chests" — then you arrive at the outpost without the belts. So the companion gets one small primitive: named lists
it owns and the player asks it to change, shown in the console and on a **read-only** panel in the game (the player
shows or hides it; only the agent edits it). The packing list is a list with a rule that ticks items off against
what the player carries. Phase 1 is before logistic bots, so nothing is set on the player's behalf: it does the
arithmetic, finds where things are, says what the save's data proves is also needed (fuel for a burner oven, poles
for an electric one), and checks the load against free inventory slots. Phase 2, once bots exist, hands the list to
the player's own logistic network behind a card: the companion keeps its requests in **its own named section** of
the player's requester point (2.0 sections), so their own requests are never touched, switches the section off when
the list is done rather than deleting it, and never writes `trash_not_requested` (FC-168, decided with the player
2026-09-15). Sorting chests (FC-169) was dropped: storage filters only place *incoming* items, and once chests are
on the network `get_supply_counts` already says which one holds what.

**Phase 4 — voice and extras** — current
- ~~Voice in/out in the web console, using the browser's own speech features~~ done in S26; heard properly in S31
  (engine choice, N-best rescoring, contextual biasing, a local-transcriber spike, and six fixes from the player's
  own sessions) — **pending the player's Chrome check** of whether biasing works and whether rescoring stays
- ~~What the player is looking at~~ done in S27 (pointing, container contents, hover facts, the wake ping)
- ~~Numbers and facts you can lean on~~ done in S28 (throughput model, measured machine output, entity facts)
- ~~Lists the agent keeps, with a read-only in-game panel~~ done in S30, with the packing list and bots (FC-168)
- ~~The companion is somebody~~ done in S32: Ballast, eight lines of canon, dry everywhere and flat when it counts,
  direction from an authored stage table, the arc, and the invented-name check (FC-171) — measured free
- ~~A background pass while the player plays~~ done as FC-193 after FC-192 showed the cache survives concurrency
- Local speech-to-text comparison on the player's own clips (FC-188 built, FC-189 waiting on the clips)
- In-game UI (mod GUI chat panel / hotkey popup) — deferred by the player (FC-060)
- ~~Background Factorio test instance for measuring blueprints~~ dropped (see Blueprints): better estimates and measuring builds in the player's game instead
- ~~Session memory across play sessions~~ done in S18 (FC-063) and per map in S22 (FC-137)

**Voice (S26, decided by the player 2026-09-15):** the Web Speech API in the console, as in Chrome's demo; Brave
doesn't work and that's fine. Recognition prefers the device: Chrome 153 reports on-device recognition as
"downloadable" for en-US with `install()`, so the console offers the one-time download and uses `processLocally` after.
Until then voice goes to Chrome's speech service and the console says so, and the README qualifies "nothing is sent to
the cloud". Answers are read with a local voice (`localService`) sentence by sentence as they stream. The game's
push-to-talk key (custom input `second-shift-talk`, Alt+V) reaches the console in ~80 ms through the event feed.

**Transcription accuracy (S31, after the player's first long voice session):** three of 24 spoken turns came
through wrong, and the diagnosis changed twice. The on-device model never finished downloading on this machine, so
that session was already on Chrome's *online* service — the better of the two — and the engine choice (FC-174) is
about honesty, not accuracy. Only one miss was acoustic (`wire → wine`); `"I've got 10" → "Got10"` and
`"red dots up there" → "red darts of there"` are weak-text-prior and no-number-normalization failures, which says to
shop for a strong text prior rather than a low word error rate. Two things ship against it: the console asks for four
transcripts and keeps the one carrying this save's own words (FC-175, 555 words and 5.5 KB sent on connect, nothing
in the prompt), and the recognizer is told which phrases to expect (FC-177) — Chrome shipped contextual biasing in
desktop M140 as `SpeechRecognition.phrases` with `new SpeechRecognitionPhrase(phrase, boost)`, boost 0–10, and
verified by hand in Chromium 153: the property exists, takes a plain array (`SpeechRecognitionPhraseList` is
undefined), and rejects a boost over 10. The server sends 100 phrases, the save's own things said the way a player
says them, at boost 3, ranked by how often each is an ingredient of an enabled recipe or technology with a bonus for
anything the player places — 1.8 KB on the dev save, and the ranking matters: the dump's own order spent the list on
chests and ducts and left out stone furnace, iron gear wheel and the science packs. **Unverified until the player's next session:** whether the engine applies the bias at all,
and whether it does so outside `processLocally`. If it does, FC-175's re-ranking is dead code and comes out.

**Local speech-to-text (S31, FC-176 spike, nothing installed):** the verdict was *not* "keep the browser engine" —
but do the free Chrome check (FC-177) before building audio plumbing. Biasability discriminates the field more than
word error rate does, because the player's misses are domain words: whisper.cpp `whisper-server` with
large-v3-turbo (MIT, ~0.6–1.6 GB, `prompt` biasing) and mlx-whisper (`initial_prompt`) take a text prior;
`parakeet-tdt-0.6b-v3` has the best local WER (6.34% on the Open ASR Leaderboard, against ~7.4% for Whisper
large-v3) and real streaming but no hotword support; ElevenLabs Scribe v2 has keyterm prompting and sends the
player's voice off the Mac, so it's a fallback behind the same opt-in as the ElevenLabs voices. Memory is a
non-issue (128 GiB here, oMLX resident at ~69.5 GB, largest candidate ~1.6 GB) — keep the model loaded, because the
cost is load time. Latency is the open number: Whisper's own `pad_or_trim` and `N_SAMPLES = 480000` mean a 4 s clip
still pays a full 30 s encoder window, so a 3–6 s utterance is almost all fixed cost, estimated 0.3–1.0 s for
turbo-class against today's ~1.5 s to first words, with no trustworthy short-clip measurement on M5-class silicon
to lean on. If we build it: 16 kHz mono WAV from an `AudioWorklet` (`MediaRecorder` only gives Opus) to a `/stt`
route mirroring `/tts`, proxied to a resident `whisper-server` with the vocabulary as `prompt` and `--vad`; Chrome
keeps driving the live `heard` display and the local transcript is the authoritative one. Capture the player's audio
with the chosen transcript into `data/captures/` *first* — it's their voice, so local-only — then measure accuracy
against what they actually said versus Chrome on the same audio, delay p50/p95, resident memory beside oMLX with
TTFT unchanged, and hallucination rate on short and near-silent clips. **Stop and keep the browser engine if** it
invents text (Whisper's documented failure mode on short noisy audio, and worse than a mis-hear because it doesn't
look wrong), delay exceeds ~1 s p95, FC-177 already fixes the acoustic misses, or the captured set shows no clear
win.

**ElevenLabs voices (S26, FC-148, player request):** opt-in online voices for reading answers. The server keeps
`ELEVENLABS_API_KEY` (gitignored `.env`) and streams `eleven_flash_v2_5` audio per sentence through `/tts`, so the key
never reaches the page; the picker labels them online.

**Phase 5 — character control** (was Phase 3b)
- ~~Stop hotkey first; decide how agent control and the player's own inputs interact (§8 Q11)~~ done in S29
  (FC-051), with the spidertron (FC-144): one order at a time, Alt+X or "stop" cancels it, and the player taking
  over ends it by itself
- ~~Spidertron autopilot on request~~ done in S29 (FC-144) — pending the player's own send
- `mine_by_hand`, `craft`, `transfer_items`, each with a confirm — deferred by the player (FC-050)
- No `walk_to`: walking stays the player's (decided by the player 2026-09-15)

**Phase 6 — car and tank driving** — spike done, implementation deferred by the player (FC-146)
- Spike done (FC-145, 2026-09-15): `work/spikes/FC-145-driving.md`. Route-finding for a car-sized box is in the
  engine after all — `request_path` documents "emulate pathing behavior by script for non-unit entities, such as
  vehicles" and takes a free-form bounding box and collision mask — while throttle and steering are only
  `riding_state` (4 acceleration × 3 direction states). So the work is a waypoint follower, not a pathfinder, and
  `LuaEntity.orientation` / `.speed`, which the existing driving mods write, are cheats under the helmet rule.
- Recommendation: build a **reduced** version — drive a pre-checked path and stop and say so rather than swerve —
  **after FC-144**, whose confirm card and stop hotkey it reuses. Dynamic avoidance is the unbounded part and is cut.
- Estimated 0.02–0.04 ms/tick while driving against ~0.05 ms of headroom, and the whole-tick benchmark can't see a
  cost that size (its noise band is 0.043–0.107), so FC-146 measures the script profile, a `try_again_later` counter
  and stop latency, with a go/no-go path-quality gate first.

---

## 8. Open questions

1. **State cadence.** Two separate questions. (a) How often the server polls the mod over RCON:
   ~100–250 ms into an in-memory ring buffer. (b) Which snapshot goes last in the prompt: the
   latest one, taken when a question is asked. Never rebuild the prompt on every poll.
2. **How much state per turn.** Full dump is simple but expensive; tool calling is cheaper
   but adds round-trips (each ~2 s warm). Probably: small always-on digest + tools for detail.
3. ~~**Display surface.**~~ Decided: local web app on the 2nd monitor, in-game UI as a stretch goal (§3).
4. **Model choice.** Flash-Next for quality (82.3%). Ornith-1.5 is 2.2x faster prefill at
   72.3% — possibly worth it for cheap/frequent queries if we ever split by query class.
5. ~~**Structured-decision models (TypeSafe "System One" / Jev).**~~ Looked at 2026-09-18, not adopted.
   Verified from their blog and repo: Jev doesn't generate text at all ("gives up string generation"),
   answers typed questions sampled in parallel rather than token by token, is trained with RLCD for
   calibrated confidence, claims 70–500 ms end to end, demos Doom and Wikiracing, caps choice
   cardinality at 255, and is **cloud API only behind a waitlist with no weights** — which is the whole
   of the answer for a project whose premise is that nothing leaves the machine. `system-one-adapter-python`
   is real and MIT-licensed and does run the same typed interface over any OpenAI-compatible endpoint
   (`base_url`), so the shape can be borrowed today; it exposes no temperature control, and its
   `normalize_probabilities` only rescales a distribution to sum to 1, which is mathematical validity
   and not calibration.

   **Why we're not building a "Tier 1.5" of typed model questions for routing:** a routing call pays a
   full first token, 1.3–2.4 s on our own measurements, to decide something our regexes decide in
   microseconds — and a local run of the adapter against Flash-Next took 2.7–4.0 s and got a
   power-deficit question right twice in four tries, on arithmetic a two-line Lua rule gets right every
   time. That is the two-tier split in CLAUDE.md working as designed, and S32 is the same lesson three
   more times: the register tier (FC-179), the stage row (FC-181) and the invented-name check (FC-171)
   are all decided in code precisely because a round costs a first token. Self-reported probabilities
   are a hint, never a threshold.

   **Where the shape could still earn its keep:** inside work we're already paying for — a background
   pass (FC-193) asking "which of these forty alerts is worth mentioning", where no code rule expresses
   the judgement and the latency is nobody's wait. Revisit Jev itself only if TypeSafe ships local
   weights; that single change is what would reopen this.
5. ~~**Transport: RCON or UDP?**~~ **Decided 2026-09-13: RCON**, after testing and prior-art
   research. The player accepted the multiplayer-hosting trade-offs below. The RCON keys go in
   the player's real `config.ini` (set by `scripts/setup-rcon.ts` with the game closed).

   **How RCON works in the normal client** (confirmed by test, Wube staff and several projects):
   - `--rcon-port` / `--rcon-password` flags do nothing in the GUI client (tested with
     `--load-game` and `--host`). They're for `--start-server` only.
   - RCON *does* open when `config.ini` has `local-rcon-socket` and `local-rcon-password` **and**
     the game is hosted as multiplayer: `--host <save>` or Multiplayer → Host. Tested with
     `--config <copy> --host`: "Starting RCON interface at 127.0.0.1:27015". Single-player never
     gets RCON (Wube staff, [forum t=31962](https://forums.factorio.com/viewtopic.php?t=31962)).
   - Hosting alone runs one simulation, not a server plus client, so CPU cost is unchanged.
   - Used this way by lveillard/factorio-ai-companion, nerdpudding/factorio_llm,
     danielriddell21/factorio-mcp and phiresky/factorio-mcp.

   **Measured on this machine** (Factorio 2.0.76, macOS, window unfocused, test map):

   | | RCON (hosted alone, mod-registered command) | UDP (single-player, `--enable-lua-udp`) |
   |---|---|---|
   | Round trip | **~17 ms** (1 tick), p95 17 ms | ~45 ms (41–54), up to ~290 ms after load |
   | 100 requests at once | all answered in 17 ms, same tick | all handled in one tick; replies arrived over ~2 s |
   | Largest reply | **5 MB in one reply, 28 ms** | ~9.2 KB; larger is **silently dropped** |
   | Delivery | TCP: reliable, ordered | no guarantee; lost while paused or saving (API docs) |
   | Game → agent push | not possible; poll with a tiny "events since N" command | yes |
   | Achievement prompt | none for mod-registered commands (`/sc` triggers it) | none |

   **Conflicts with other people's measurements:**
   - FLE reports RCON stalls ~40 ms per 4 KB of reply on their Linux/Docker/Python stack. Our Bun
     client on macOS loopback got 5 MB in 28 ms. If large replies ever get slow, compress in Lua
     with `helpers.encode_string` (FLE: 10.5 s → 0.52 s).
   - FkLua measured ten `send_udp` calls in one tick all arriving, but didn't report timing. Our
     test sent 60 in one handler and they arrived spread over ~1.3 s (~47/s).
   - Long *incoming* RCON commands can be split across ticks (100 B/tick with remote peers) and
     overtaken by shorter ones. kovarex reports a 500k-character command took ~20 ms with no other
     players. **Measure with a large blueprint string before relying on it.**
     **Measured 2026-09-14 (FC-022, `scripts/probes/inbound-size.ts`):** hosting alone, commands
     aren't split. Round trip 17 ms for 10 KB, 14–21 ms for 100 KB, 32 ms for 1 MB, ~175 ms for 5 MB.
     A small command sent right after a 1 MB one lands in the same tick. The real cost is JSON
     parsing on the main thread: 0.16 ms per 10 KB, 1.5 ms per 100 KB, 14 ms per 1 MB, 71 ms per
     5 MB. So commands are capped at 48 KB (`MAX_COMMAND_BYTES`), and larger payloads must be
     split across ticks.

   **RCON trade-offs (accepted):**
   - Each session is hosted as a private multiplayer game (127.0.0.1, password, not public/LAN),
     via a launcher script (`--host <save> --server-settings …`) or the Host menu.
   - In multiplayer, Esc and menus don't pause the game. Pausing is the admin pause button.
   - Autosave follows `server-settings.json` (`autosave_interval`, `autosave_slots`).
   - The game rewrites `config.ini` on exit, so edit it only with the game closed, or use a
     dedicated `--config` profile (lveillard does this).
   - Multiplayer is lockstep: Lua run via RCON must stay deterministic. There's no desync risk
     alone, but keep the discipline.

   **UDP risks found in research:**
   - FactoryVerse reports a macOS 2.0.76 client dying after 80 minutes from "an engine bug in
     `helpers.send_udp` on macOS" (unverified, no public root cause).
   - Headless `recv_udp` crashes were fixed in 2.1.10; the GUI client isn't affected.
   - Name clash: ob1-s/factorio-AI-coop calls itself "Factorio Companion" and uses UDP.

   **Design:**
   - All agent → game requests and all queries/actions go through one mod-registered command
     (e.g. `/companion {json}`) with request IDs. Never `/c` or `/sc`.
   - The digest and events come from polling a tiny command every ~100–250 ms. Tier 1 alerts
     still show in-game instantly from Lua.
   - No UDP flag needed. Add UDP push later only if polling latency matters.
6. ~~**Language.**~~ Decided: TypeScript on Bun (§4).
7. **Screenshot cost.** Does `game.take_screenshot` hitch the game? Measure before relying on it.
   **Measured 2026-09-14 (`scripts/probes/screenshot-cost.ts`, hosted dev game):** the Lua call takes 0.10–0.23 ms
   at any size, and the game kept 60 UPS through every capture (the render happens on the client). File ready after:
   PNG 512 px 58 ms (668 KB), 1024 px ~100 ms (2.6 MB), 2048 px ~280 ms (10 MB); JPEG q80 1024 px ~40 ms (486 KB),
   2048 px ~60 ms (2.2 MB). **Decision:** 1024 px JPEG at zoom 0.5 (64 tiles across) on request only. A frame-level
   render hitch on the client wasn't measured (UPS doesn't show it).
8. **Engine aggregates vs polling.** Which digest fields can come from engine aggregates
   (production stats, alerts, research) and which need amortized status polling? This decides
   how well the mod holds up on a huge base.
   **Measured 2026-09-13 on the dev save** (Lua time via `helpers.create_profiler`):
   - `get_flow_count` for all 412 item series across 4 surfaces: ~0.5 ms. One surface/category:
     ~0.1 ms. So rates are refreshed one (surface, category) every 30 ticks into a cache.
   - Unfiltered `player.get_alerts({})` with 1,149 alerts: 0.55–0.7 ms. Filtered by one type:
     ~0.01 ms. So only urgent types are fetched, each filtered.
   - Resulting `digest` handler: ~0.19 ms per call (was ~1.6 ms), 4 KB JSON.
   - Benchmark with the refresher running: no measurable cost (−0.027 ms/tick, within run-to-run
     noise of about ±0.03 ms).
   - **Machine status (S07, 2026-09-14):** event-kept registry of 2,746 machines on the dev save;
     polling 20 per tick costs ~0.055 ms (full refresh every 138 ticks, 2.3 s). The one-time
     registry scan (16 chunks per tick, ~27 s after load) costs median 0.10 ms, max 0.34 ms per
     tick. On a megabase the refresh period grows, not the per-tick cost.
   - **The benchmark can't resolve costs this small.** Run-to-run noise is ~0.05 ms/tick, and
     `--benchmark` doesn't run RCON, so the digest path isn't in it. Derived cost from the
     profiler: refresh ~0.1 ms per 30 ticks + digest ~0.2 ms per 120 ticks (2 s poll) ≈
     **0.005 ms/tick**. Use `helpers.create_profiler` numbers for the mod's budget, and
     `--benchmark` only to catch whole-game regressions.
9. **Undo.** Do actions passed `player` / `undo_index` really land on the player's Ctrl+Z history,
   and does Ctrl+Z reverse them? Verify with deconstruction marks first.
   **2026-09-13:** yes for the history. `order_deconstruction(force, player, 0 then 1)` on 8 rails
   added one undo item holding 8 `removed-entity` actions, like one planner drag.
   **2026-09-14, player-verified:** one Ctrl+Z removed all 4 marks the mod had placed on belts to the
   player's right (`scripts/check-undo.ts`). Two things to know: Ctrl+Z undoes the newest action first, so
   anything the player did after the companion's marks is undone before them; and if construction robots
   carry out the marks first, the undo entry becomes "put the removed entities back" (ghosts).
10. **Exact remote-view rules.** What does 2.0 let a player do remotely (radar coverage vs merely
    charted; which entity settings can be changed)? Action checks must match exactly.
    **2026-09-13:** no authoritative source found. The API's `deconstruct_area` defaults to
    *not* skipping fog of war, which hints the game allows more. Adopted the conservative rule:
    search and mark only in chunks the force can see now (`force.is_chunk_visible`).
    **2026-09-14, player-verified:** in remote view, a deconstruction planner drag is blocked both over fog of
    war (charted, not currently seen) and over uncharted map. The conservative rule matches the game for marks.
    **2026-09-14, decided with the player (FC-092):** "here / this / on screen" means where the player is looking;
    "near me / to my right / where I'm standing" means the character; otherwise searches use the character and
    placements use the view, and answers say which was used when they differ.
    **2026-09-14, player-verified (FC-093):** changing a recipe by hand from map view moves the machine's
    ingredients into its trash slots (`crafter_trash`, documented as "items that are ejected when changing the recipe
    via remote view"), not the player's inventory. Scripts can't fill those slots (size 0, inserts refused), so the
    companion (decided with the player): leftovers go to the character's inventory when the machine is in reach
    (player-verified: a hand change next to the machine does the same), otherwise spill next to the machine marked
    for the player's robots.
    Still open: other entity settings remotely (train stop limits, filters).
11. **Character control vs player input.** ~~Does the player's own movement override `walking_state` and
    `mining_state`? Should any player input cancel an agent action?~~ **Decided 2026-09-15 (FC-051), with the
    first thing the companion moves (the spidertron, FC-144):** the player's input always wins, and the rules are
    the same for anything the companion moves later.
    - **One order at a time**, held in `storage`, with the stop key (`second-shift-stop`, Alt+X, rebindable)
      cancelling it in the tick it's pressed. Saying "stop" does the same.
    - **The player taking over ends it by itself**, with no key press needed: driving the vehicle
      (`on_player_driving_changed_state`), sending it with their own remote
      (`on_player_used_spidertron_remote`), or losing it (`on_entity_died`, filtered to that type).
    - **Every stop says why**, in the game and in the console feed (`control_stopped`), and arrival is reported
      once (`control_arrived`).
    - **Stopping uses the same means the player has:** clearing the order (`autopilot_destination = nil`).
      Never `stop_spider`, `speed` or `orientation` — a source-level test fails the build if those appear.
    - For character control later (FC-050, deferred): a `linked_game_control` custom input with
      `consuming = "none"` fires before the game's own handler, and a guard comparing the last state the mod
      wrote against the current one catches anything else changing it. Written up in
      `work/spikes/FC-145-driving.md` §4.
12. ~~**Prototype data source.**~~ **Decided 2026-09-13: runtime view over RCON.** The mod's
    `dump_prototypes` action on the 22 MB dev save with the full mod list returned 981 recipes,
    402 items, 43 fluids, 342 technologies and 69 machines (incl. 115 maraxsis and 27 Cerys
    recipes) as 0.44 MB in ~30 ms. It includes per-force state (recipe enabled, tech researched).
    `--dump-data` isn't needed. Note: `helpers.table_to_json` writes empty arrays as `{}`.
    **2026-09-14 (FC-082):** the dump also carries footprints for the 167 buildable entities (type, tile
    size, collision box): 0.46 MB, Lua time ~23 ms. That's a one-off hitch on connect or when mods change,
    an accepted exception to the per-tick budget (split it across ticks if it's ever noticeable).

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Mod stutters the game on a huge base | Cost proportional to changes, not size (§5). Benchmark with and without the mod on every change. |
| Prefix cache doesn't hold in practice | Verify in Phase 2 against the measured ~2 s target before building further. |
| Model hallucinates modded recipes | Ground on `prototypes.json`; distrust uncited recipe claims. |
| Latency makes it feel sluggish | Tier 1 handles anything time-critical; disable thinking for quick queries. |
| Agent does something the player couldn't (god mode) | Named actions only, no raw Lua; mod re-checks reach, items, research and coverage when the action runs; tests that each action fails when the player couldn't do it. |
| Agent does the wrong thing | Preview with in-world highlights, explicit approval for map changes and character control, undo history, stop hotkey. |
| Scope creep into "AI plays the game on its own" | Acts only on request; no autonomous loops. |
| Model emits wrong visual specs (bad layouts, fake entities) | Validate specs against `prototypes.json`; show checks on each component. |
| Verbose specs make visual answers slow | Terse spec formats; measure tokens per component. |
| Hosted game port reachable on the LAN | The client ignores `--bind` when hosting, so 34197 listens on all interfaces (macOS firewall is off). Mitigated by a random game password, no public/LAN listing, `max_players: 1`. RCON itself is bound to 127.0.0.1. Enabling the macOS firewall would close it. |
