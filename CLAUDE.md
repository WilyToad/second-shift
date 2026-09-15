# Second Shift (formerly Factorio Companion)

A local AI companion for a live Factorio game: a mod exports game state and performs
player-equivalent actions, and an agent loop answers questions and acts on request, using a
local oMLX model. **`PLAN.md` is the source of truth**
for goals, architecture, phases and measurements. Read it before starting non-trivial work, and
update it when a decision changes.

**Status:** Phase 1 slice works end to end (mod → RCON → server → oMLX → web chat). Stack: **TypeScript on Bun**
(runtime, package manager, test runner, bundler) for `interfaces/`, `server/` and `displays/`.
No Vite. UI: Preact + signals in `displays/src` (PLAN §4).

## Hard rules

- **Speed first.** When a choice trades effort for speed or less lag, pick the faster option.
  Factories get huge, so game-side cost must grow with *changes*, never with factory size
  (PLAN §5, "Speed is the top priority").
- **The helmet rule: if the player can do it, the agent can; if not, it can't.** Same tools, same
  reach or remote-view coverage, same time and item cost (PLAN §3 "Actions"). Nothing in the engine
  enforces this, so the mod must. Never use `create_entity` for real entities, `destroy()`,
  `teleport`, item insertion from nothing, tile changes, instant mining, instant research, cheat
  mode or game speed in agent-facing code.
- **Named actions only.** The agent never gets raw Lua or console commands. The server rejects
  unknown action names; the mod re-checks the player's reach, items, research and coverage when
  each action runs. Every action needs a test proving it fails when the player couldn't do it.
- **Approval:** looking and small requests (queue research, map tag, a camera jump the player
  asked for) run immediately. Map changes need a preview (in-world highlight + approval card) and a
  confirm. Character control (walk, mine by hand, craft, move items) needs a confirm and a stop
  hotkey. Anything the agent suggests on its own is offered in words and acts only after the player says yes
  (`ASKS_FOR` drops unasked calls, FC-126); map changes then still get a card. Pass `player` so map
  changes go on the player's undo history.
- Achievements don't matter, so console commands (`/c`, `/editor`) are fine for development.
- **Two tiers, split by latency.** Anything time-critical (attacks, brownouts, low ammo, full
  buffers) is plain Lua in the mod and never waits on the model. The model handles questions
  and requested actions (2–30 s).
- **Prompt order is fixed: stable first, volatile last.** System rules (+ traits, block-aligned) →
  conversation history (append-only; past questions stored compacted) → new question with retrieved
  lines → live snapshot, always last. Every new tool or rule grows the stable prefix: re-run the latency
  report (PLAN §6). Anything
  volatile placed earlier breaks the prefix cache: ~2 s warm vs ~42 s cold (PLAN §5). Don't
  put timestamps, tick counts or other changing values in the system prompt.
- **Ground recipes on `prototypes.json`, not on what the model remembers.** The dev save is heavily
  modded (Space Age, maraxsis, Cerys, factorissimo-2, PlanetsLib) and players' saves differ, so vanilla recipe
  knowledge is wrong here: a recipe or tech claim that can't be cited from the dump is a bug. The system prompt
  lists the connected save's own mods (FC-131).
- **Keep the stable prompt prefix block-aligned.** oMLX caches whole 2,048-token blocks; the server pads the system
  prompt past the next boundary at startup (`alignToCacheBlock`). Changing rules or tools re-aligns automatically,
  but check `scripts/latency-report.ts` after prompt changes.
- **Visuals are rendered from data, not drawn by the model.** The agent emits compact component
  specs (PLAN §3, visual component library); code renders them from `prototypes.json` and state.
  Keep specs terse, because spec tokens are the latency cost.
- Use `chat_template_kwargs: {"enable_thinking": false}` for quick lookups. Save thinking for
  planning questions.

## Environment (this machine)

| Thing | Value |
|---|---|
| Game | Factorio 2.0.77 (Steam auto-updates), mac-arm64, Space Age |
| Factorio user dir | `~/Library/Application Support/factorio/` |
| Mods dir | `…/factorio/mods/` (zips + `mod-list.json`) |
| Mod output | `…/factorio/script-output/` (one-off dumps only; doesn't exist yet) |
| Runtimes | Bun 1.3.14, Node 26.3.1 |
| oMLX server | `http://127.0.0.1:8888`, config in `~/.omlx/settings.json`, logs in `~/.omlx/logs/server.log` |
| Primary model | Qwen3.8 Flash-Next (`~/.omlx/models/Jundot/Qwen3.8-Flash-Next-oQ4e-mtp`) |
| Memory ceiling | 118 GB oMLX guard; Flash-Next uses ~69.5 GB resident |

## Factorio 2.0 modding gotchas

Most Factorio Lua online (and in model training data) targets 1.1. In 2.0:

- `game.write_file` → `helpers.write_file(path, data, append)`, with the path relative to `script-output/`
- `game.table_to_json` → `helpers.table_to_json`
- `global` → `storage`
- `game.recipe_prototypes` / `game.technology_prototypes` / `game.item_prototypes` → `prototypes.recipe` / `prototypes.technology` / `prototypes.item`
- `info.json` needs `"factorio_version": "2.0"`
- Use `script.on_nth_tick` for periodic export. 60 ticks = 1 s.
- `script.on_nth_tick(n, f)` and `script.on_event(e, f)` *replace* any earlier handler for the same n or event.
  Register periodic work through `util.on_nth_tick` in the mod.
- `require` only works while the mod loads (main chunk), never inside handlers. Require modules at the top.
- Lua gotcha: `x and f(x) or default` returns `default` whenever `f(x)` is nil or false, and `cond and true or nil`
  turns false into nil. Use an explicit `if` or a plain boolean expression. (This bit three times.)
- Bump `DUMP_VERSION` in `control.lua` whenever `dump_prototypes` changes shape; the server's prototype cache is keyed on it.
- `helpers.table_to_json` writes empty tables as `{}`. Parse replies through the `interfaces` schemas.
- Anything that decides what goes into `storage` must itself live in `storage`. A module-local (say, a chunk
  iterator) survives on the host but is gone on a peer that just loaded the map, so the two drift apart (desync).
  Module-local caches are fine only if they feed RCON replies and nothing else.
- `/sc storage.x` is the level script's storage, not the mod's. Reset mod state through a mod-side test handler.

## Mod performance rules (huge factories)

- Never call `find_entities_filtered` (or any full sweep) on a timer. Keep an entity registry
  updated from build/remove events, and build the initial one spread across ticks.
- Prefer engine aggregates: `force.get_item_production_statistics(surface)`, research state,
  `player.get_alerts()` (attacks, destroyed, turret out of ammo, train no path/no fuel, …).
- No status-change event exists. Poll machine status round-robin with a fixed per-tick budget.
- Push only a tiny digest. Compute detail only when a query asks for it, and cap its size.
- No periodic file writes. Files are for one-off dumps and explicit captures only.
- No unfiltered hot events (`on_entity_damaged`), no heavy `on_tick` work.
- Benchmark every mod change: `factorio --benchmark <save copy> --benchmark-ticks N` with and
  without the mod. Budget: under 0.1 ms/tick on average, no tick over 1 ms.

## Factorio API reference

The exact API for the installed version ships with the game:
`…/factorio.app/Contents/doc-html/runtime-api.json` (and `prototype-api.json`). Check it before
using an API from memory; online docs track the latest version, which may differ from the installed one.

## Useful Factorio CLI flags

Binary: `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`

- **Transport is RCON (decided, PLAN §8 Q5).** Measured facts:
  - **RCON in the GUI client:** the `--rcon-*` flags are ignored. It works only with
    `local-rcon-socket` + `local-rcon-password` in the loaded `config.ini` **and** the game hosted
    as multiplayer (`--host <save>` or Host menu). Round trip ~17 ms; 5 MB replies fine. Use a
    mod-registered command with request IDs, never `/c` or `/sc` (those trigger the achievement
    prompt and give the agent raw Lua).
  - **UDP** (`--enable-lua-udp <port>`) works in single-player. Datagrams over ~9.2 KB are
    silently dropped; round trip ~45 ms; packets are lost while paused or saving. There's an
    unverified report of a macOS `send_udp` crash.
  - The game rewrites `config.ini` on exit. Edit it only with the game closed, or use `--config`.
- Launch Factorio through `spawnFactorio()` (`server/src/factorio.ts`). Launched directly, Steam restarts the
  game and shows a "Launch Game with custom arguments" prompt every time. Starting it from a working directory
  containing `steam_appid.txt` (427520) skips that restart. Steam must still be running.
- `--dump-icon-sprites` writes every icon, modded ones included, as PNGs and exits.
  Use it as the web app's icon source.
- `--benchmark`, `--benchmark-ticks`, `--benchmark-runs` measure UPS cost on a save copy.

## Dev workflow

- `bun run setup-rcon` (once, game closed) enables RCON in `config.ini`.
- `bun run link-mod` (once, game closed) symlinks the mod into the Factorio mods folder.
- `bun run launch -- --dev` hosts `data/saves/dev.zip` (a copy of the big save) privately with no
  autosaves, waits for RCON and checks the mod answers. The mod code reloads only on game restart.
- `bun scripts/benchmark.ts [--ticks N --runs N]` (game closed) benchmarks the dev save with and
  without the mod using mirrored mod folders. Run it after every mod change.
- `bun run start` runs the server (web chat on http://127.0.0.1:5170). It reconnects to the game
  on its own and warms the model at startup. The e2e and eval scripts talk to this running server, so
  **restart it after any server change** before trusting their results (it doesn't reload code).
- `bun test`, `bun run typecheck`, `bun run check` (all of it), `bun run board` (sprint progress).
- Website: `bun run site:dev` / `site:build` / `site:serve` locally; `bun run site:deploy` publishes to https://second-shift.wilytoad.com (outward-facing: only when the player asks).
- `bun scripts/test-planning.ts` (dev save hosted) runs the helmet tests for planning actions (research, tags, camera, upgrade, blueprint paste).
- `bun scripts/test-machines.ts` (dev save hosted) checks the machine registry and polling cost.
- `bun scripts/megabase.ts` (dev save hosted) scales the running game to 25,000 machines on a temporary surface and profiles every mod path (PLAN §5).
- `bun scripts/test-research.ts` and `bun scripts/test-inserters.ts` (dev save hosted) check the research patch and inserter geometry.
- `bun scripts/test-player.ts` (dev save hosted) checks the player's own data: map id, inventory, hand crafting, recent
  builds, surroundings and trigger research. Run it after changes to `scripts/player.lua`.
- `bun scripts/eval-new-game.ts [--switch-back]` (server running, game closed) creates a fresh map (~2 s), hosts it
  and runs the first-hour questions against the game's own data; `--switch-back` then hosts the dev save and checks
  its conversation returns. Run it after changes to player-data retrieval or turn guidance.
- `bun scripts/e2e-train-stops.ts` (server running, dev save hosted) finds train stops, sets their limit through a card
  and checks the game.
- `bun scripts/eval-requests.ts [--runs N]` (server running, dev save hosted) checks that cards and actions happen only
  when asked (blueprint requests with and without "paste", research questions, marking). Run it after changes to
  tool guards or turn guidance.
- `bun scripts/test-helmet.ts` (dev save hosted) runs the in-game helmet-rule tests. Run it after any change
  to mod actions or `scripts/helmet.lua`.
- Captures for offline work go in `data/captures/` (gitignored).
- `COMPANION_REPLAY_DIGEST=data/captures/digest.json bun run start` uses a captured digest while the
  game is closed, so offline answers see a realistic prompt.
- `bun scripts/eval-ratios.ts` (server running) checks production-plan answers against an independent reference.
- `bun scripts/eval-grounding.ts` (server running) runs the 10-question grounding check. Run it
  after any change to retrieval, prompt wording or sampling; results land in `data/eval/`.

## Layout

- `mods/second-shift/`: the Lua mod (`info.json`, `control.lua`). During development,
  link it into the Factorio mods dir as `second-shift` rather than copying it (`bun run link-mod`).
- `brand/`: the brand and style guide (`BRAND.md`), shared design tokens and fonts, logos. The console and the website load `brand/tokens.css`; follow the guide for anything user-facing.
- `interfaces/`: the game↔agent contract: transport, state schema, query/tool definitions, component specs.
  A change to the state shape must update the schema and the mod together.
- `server/`: agent loop, oMLX client, prompt assembly.
- `displays/`: output surfaces. The MVP is a local web app on the second monitor; in-game UI is a stretch goal (PLAN §3).
- `data/`: captured `state.json` / `prototypes.json` samples for offline development. Gitignored.
  Prefer developing `server/` against these captures so the game doesn't need to be running.
- `scripts/`: dev helpers (install mod, replay a capture).

## Working norms

- **Track work in `work/`** (see `work/README.md`). Check `bun run board` before starting; mark
  the item `[~]` when you start and `[x]` in the commit that finishes it; put the item ID in the
  commit message. New work gets a new `FC-###` item, not an untracked change. Only the player
  moves a sprint from planned to active.
- `bun run check` (tests + typecheck + work file validation) must pass before committing.

- Stay inside the current phase in PLAN §7. The agent acts only on request; no autonomous play loops.
- Performance claims need measurements (TTFT, cache hit rate from the oMLX logs), not estimates.
  Record new measurements in PLAN.md.
