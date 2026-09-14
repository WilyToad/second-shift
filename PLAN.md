# Factorio Companion — Plan

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
- **Camera jumps** happen when the player asks for one. A jump the agent suggests on its own
  waits for a click. It never moves the camera unprompted.
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
| `screenshot` | An in-game screenshot of an area (`game.take_screenshot`) | Game, via script-output. Cost unmeasured. |
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
- **Later:** a separate background Factorio instance with the same mods that loads a proposed
  blueprint into a test map and measures real output, without touching the real game.

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

**Phase 2 — make it useful, and let it act**
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

**Phase 3 — make it pleasant**
- Full web console per the mockup (§3): live state rail, visual component library
- More planning actions: `place_blueprint`, `mark_upgrade`, entity settings, `queue_research`,
  map tags, `camera_to`
- Blueprint selection tool, throughput analysis, template-based creation
- Tool calling: let the agent pull detail on demand rather than stuffing everything in context
- Optional: screenshots for layout/blueprint questions (model is multimodal)

**Phase 3b — character control**
- `walk_to`, `mine_by_hand`, `craft`, `transfer_items`, driving
- Stop hotkey; decide how agent control and the player's own inputs interact (§8 Q11)

**Phase 4 — optional**
- In-game UI (mod GUI chat panel / hotkey popup)
- Background Factorio test instance for measuring blueprints
- Voice in/out
- Session memory across play sessions

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
   added one undo item holding 8 `removed-entity` actions, like one planner drag. Waiting for the
   player to confirm Ctrl+Z restores them.
10. **Exact remote-view rules.** What does 2.0 let a player do remotely (radar coverage vs merely
    charted; which entity settings can be changed)? Action checks must match exactly.
    **2026-09-13:** no authoritative source found. The API's `deconstruct_area` defaults to
    *not* skipping fog of war, which hints the game allows more. Adopted the conservative rule:
    search and mark only in chunks the force can see now (`force.is_chunk_visible`). Waiting for
    the player to test in-game.
11. **Character control vs player input.** Does the player's own movement override
    `walking_state` and `mining_state`? Should any player input cancel an agent action?
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
