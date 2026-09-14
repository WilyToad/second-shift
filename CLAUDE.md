# Factorio Companion

A local AI advisor for a live Factorio game: a read-only mod exports game state, and an agent
loop answers questions about it using a local oMLX model. **`PLAN.md` is the source of truth**
for goals, architecture, phases and measurements. Read it before starting non-trivial work, and
update it when a decision changes.

**Status:** planning / Phase 1. The directories exist but are empty. No language, package manager
or test runner has been picked for `interfaces/`, `server/` or `displays/` yet. Don't assume
one; ask or propose it before scaffolding.

## Hard rules

- **The mod is read-only.** It never changes game state, never uses console commands (`/c`
  permanently disables achievements on the save), and never automates play. The agent advises
  and the player acts.
- **Two tiers, split by latency.** Anything time-critical (attacks, brownouts, low ammo, full
  buffers) is plain Lua in the mod and never waits on the model. The model only handles
  advisory questions (2–30 s).
- **Prompt order is fixed: stable first, volatile last.** System rules → prototype digest →
  conversation history (append-only) → current `state.json` snapshot, always last. Anything
  volatile placed earlier breaks the prefix cache: ~2 s warm vs ~42 s cold (PLAN §5). Don't
  put timestamps, tick counts or other changing values in the system prompt.
- **Ground recipes on `prototypes.json`, not on what the model remembers.** The save is heavily
  modded (Space Age, maraxsis, Cerys, factorissimo-2, PlanetsLib). Vanilla recipe knowledge is
  wrong here, so a recipe or tech claim that can't be cited from the dump is a bug.
- Use `chat_template_kwargs: {"enable_thinking": false}` for quick lookups. Save thinking for
  planning questions.

## Environment (this machine)

| Thing | Value |
|---|---|
| Game | Factorio 2.0.76, Steam, mac-arm64, Space Age |
| Factorio user dir | `~/Library/Application Support/factorio/` |
| Mods dir | `…/factorio/mods/` (zips + `mod-list.json`) |
| Mod output | `…/factorio/script-output/` (doesn't exist yet; created on first write) |
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

File writes run on the game's main thread. Measure for stutter before raising the export
frequency or payload size (PLAN §8 Q5).

## Layout

- `mods/factorio-companion/`: the Lua mod (`info.json`, `control.lua`). During development,
  link it into the Factorio mods dir as `factorio-companion` rather than copying it.
- `interfaces/`: the game↔agent contract: state schema, file watcher, tool definitions.
  A change to the state shape must update the schema and the mod together.
- `server/`: agent loop, oMLX client, prompt assembly.
- `displays/`: output surfaces (v1 = terminal).
- `data/`: captured `state.json` / `prototypes.json` samples for offline development. Gitignored.
  Prefer developing `server/` against these captures so the game doesn't need to be running.
- `scripts/`: dev helpers (install mod, replay a capture).

## Working norms

- Stay inside the current phase in PLAN §7. Scope creep toward "AI plays the game" is a named risk.
- Performance claims need measurements (TTFT, cache hit rate from the oMLX logs), not estimates.
  Record new measurements in PLAN.md.
