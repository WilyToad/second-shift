# Factorio Companion — Plan

A local AI companion that watches a Factorio game and advises the player in real time,
running entirely on this machine against oMLX.

**Status:** planning. Nothing built yet.

---

## 1. Goal

Play Factorio on the main monitor. A companion agent on the second monitor answers questions
("why is my green circuit throughput capped?", "what should I research next?", "plan a bioflux
setup for Gleba") grounded in *actual live game state*, not guesses.

**Non-goals (v1):**
- No control of the game. Read-only. The agent advises; the player acts.
- No console commands (`/c` permanently disables achievements on a save).
- No cheating or automation of play.

---

## 2. Why this is feasible — verified, not assumed

| Capability | Evidence |
|---|---|
| Model is multimodal | `Qwen4ExpForConditionalGeneration` has `vision_config`, `image_token_id`, `vision_start/end_token_id` |
| Tool calling works | 90 `finish_reason=tool_calls` completions already in `~/.omlx/logs/server.log` |
| Model quality | 82.3% MMLU-Pro (n=300, paired) — best of the local models tested |
| Game is moddable | Factorio 2.0.76 Steam mac-arm64, 21 mods enabled, modding already in use |
| Headroom | Flash-Next is 69.5 GB resident against a 118 GB ceiling |

---

## 3. Architecture — two tiers

The single most important design constraint is **latency** (see §5). Split by response-time budget:

**Tier 1 — the mod. Deterministic, instant, no inference.**
Attack alerts, power brownouts, full output buffers, low ammo, idle assemblers.
These are `if` statements in Lua. They must never wait on the model.

**Tier 2 — the agent. Advisory, 2–30 s.**
Analysis, planning, "why is X slow", research ordering, blueprint critique.
Latency is acceptable here because the player is already thinking.

```
Factorio (Steam client)
  └─ mods/factorio-companion  (read-only Lua)
       ├─ every N ticks  → script-output/state.json      (live metrics)
       └─ on load        → script-output/prototypes.json (recipes/techs/items, MODDED)
                                  │
                          interfaces/  (watch files, validate schema, expose as tools)
                                  │
                          server/  (agent loop: prompt assembly → oMLX → response)
                                  │
                          displays/ (terminal on 2nd monitor; later overlay / voice)
```

---

## 4. Directory layout

| Path | Purpose |
|---|---|
| `mods/factorio-companion/` | The read-only Factorio mod. `info.json` + `control.lua`. |
| `interfaces/` | State schema, file watcher, tool definitions — the game↔agent contract. |
| `server/` | Agent loop, oMLX client, prompt assembly, conversation state. |
| `displays/` | Output surfaces. v1 = terminal. Later = overlay, voice. |
| `data/` | Captured state samples and prototype dumps for offline dev. Gitignored. |
| `scripts/` | Dev helpers (install mod into Factorio dir, replay a capture, etc.). |

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

**Also:** pass `chat_template_kwargs: {"enable_thinking": false}` for quick lookups; reserve
thinking for planning questions. That alone is the difference between a 60 s and a 3 s answer.

---

## 6. Grounding on MODDED data

This save runs Space Age + maraxsis + Cerys-Moon-of-Fulgora + factorissimo-2 + PlanetsLib.
The model's training knowledge of "Factorio recipes" is vanilla and will be confidently wrong.

**Therefore:** the mod dumps real prototype data (`prototypes.json`) from the running game —
recipes, technologies, items, planets, as actually loaded. The agent grounds on that file,
never on recalled recipes. Treat any model statement about a recipe it can't cite from the
dump as a hallucination.

---

## 7. Phases

**Phase 1 — vertical slice (target: one evening)**
- Mod writes `state.json` every ~5 s with ~10 key metrics
- `server/` tails it, answers one typed question with state in context
- Output to terminal
- *Success:* one grounded answer, end to end, under 5 s warm

**Phase 2 — make it useful**
- Prototype dump + grounding
- Prefix-cache-aware prompt assembly (§5) — verify the ~2 s warm path holds
- Tier-1 alerts firing from Lua, no inference
- Richer state: production rates, logistics, research, per-planet

**Phase 3 — make it pleasant**
- Better display (TUI, or overlay on 2nd monitor)
- Tool calling: let the agent pull detail on demand rather than stuffing everything in context
- Optional: screenshots for layout/blueprint questions (model is multimodal)

**Phase 4 — optional**
- Voice in/out
- Session memory across play sessions

---

## 8. Open questions

1. **State cadence.** 5 s? On-demand? Event-driven? Affects cache invalidation directly.
2. **How much state per turn.** Full dump is simple but expensive; tool calling is cheaper
   but adds round-trips (each ~2 s warm). Probably: small always-on digest + tools for detail.
3. **Display surface.** Terminal is trivial and probably enough. An overlay is nicer and much
   more work on macOS.
4. **Model choice.** Flash-Next for quality (82.3%). Ornith-1.5 is 2.2x faster prefill at
   72.3% — possibly worth it for cheap/frequent queries if we ever split by query class.
5. **Does `write_file` every 5 s cause a stutter?** Must measure; Factorio is single-threaded
   and file I/O on the main thread could hitch. Fall back to a longer interval or smaller payload.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Mod file writes stutter the game | Measure early (Q5). Increase interval, shrink payload. |
| Prefix cache doesn't hold in practice | Verify in Phase 2 against the measured ~2 s target before building further. |
| Model hallucinates modded recipes | Ground on `prototypes.json`; distrust uncited recipe claims. |
| Latency makes it feel sluggish | Tier 1 handles anything time-critical; disable thinking for quick queries. |
| Scope creep into "AI plays the game" | Explicit non-goal. Read-only, advisory. |
