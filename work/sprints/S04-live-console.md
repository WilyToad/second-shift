# S04 — Live console

- **Status:** done
- **Goal:** The second-monitor page becomes the console from the mockup: urgent alerts and live factory state beside the chat, and answers can include a real rate chart.
- **Acceptance:** On the dev save, with the server running: an urgent alert triggered in-game appears in the page's alert feed within ~1 s, with no page polling. The live-state panel shows research, per-surface production and science with sparklines drawn from server history. Asking "how is my science doing?" returns an answer with a `rate_chart` drawn from real snapshot history. The mod's added cost stays within budget by profiler, `bun run check` passes, and the page works at 2560 px wide and at phone width.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14 (visual check of the layout pending)

## Items

- [x] FC-020 `events` action: ring buffer of urgent events with "since N" polling
  - Acceptance: server polls every ~250 ms; no event lost across polls; cost measured with the profiler
  - `scripts/events.lua`: urgent alert types sampled every 30 ticks (rises only) + `on_research_finished`, 200-event ring buffer. Poll costs 0.03–0.04 ms; research and destroyed-wall events arrived within 469 ms (`scripts/probes/events-ingame.ts`). Server reports gaps as `dropped`
- [x] FC-021 Alert feed in the web page
  - Acceptance: alerts appear within ~1 s of the event; severity, surface and count shown; no polling from the page
  - Alert feed (newest first, severity stripe, surface, position, age) fed by `events` messages; recent events replayed to pages that connect later. `scripts/e2e-console.ts`: in-game alert reached the page in 307–424 ms
- [x] FC-041 Choose a UI framework for the console
  - Acceptance: decision and reasoning recorded in PLAN §4; the chat page ported to it with no loss of function
  - Preact + @preact/signals (PLAN §4). Chat ported (`store.ts`, `chat.tsx`, `main.tsx`) with a "New conversation" button; happy-dom render test; rails e2e still 6/6
- [x] FC-040 Full web console per the mockup
  - Acceptance: three-column layout from the mockup (alerts | chat | live state), stacks on narrow screens; live state from the digest stream
  - `console.tsx`: alerts | chat | live state (per-surface tabs, top produced with sparklines, science now/10 h with stall flag, research) from streamed digests and server-built series. DOM-tested with happy-dom; the narrow-screen layout isn't checked visually (no browser overnight)
- [x] FC-042 Visual component renderer and `rate_chart`
  - Acceptance: server keeps snapshot history per item; the model emits a terse `rate_chart` spec; the page draws it from history, not from model numbers
  - Model writes a terse ```rate_chart item=… surface=… window=…``` block; the page draws it from its recorded series (`components.tsx`), or says there's no history. Charts are gated in code (`wantsChart`). `scripts/e2e-chart.ts`: valid charts for science and iron plates

## Notes

Planned and activated 2026-09-14 overnight: the player delegated sprint activation for this night. Chosen from the backlog because the alert feed and console build directly on S01–S03 and need no player input. Blueprints (FC-030–FC-032) are the next candidate.

## Review

The console now matches the mockup's structure: alerts on the left, chat in the middle, live factory
state on the right, and answers can include charts drawn from recorded history. Closed overnight on
the player's delegation; **the page hasn't been looked at in a real browser** (no browser available
overnight).

**Acceptance status:**
- ✓ An in-game alert reaches the page's feed in 307–424 ms with no page polling (`scripts/e2e-console.ts`, 4/4).
- ✓ The live panel shows research, per-surface production with sparklines, and science now/10 h with a
  stall flag, all from streamed digests and server history (happy-dom render test plus real WebSocket data).
- ✓ "How is my science doing? Show me a chart." returns valid `rate_chart` blocks drawn from history
  (`scripts/e2e-chart.ts`).
- ✓ Mod cost: events poll 0.03–0.04 ms per call; alert sampler 0.04 ms every 30 ticks.
- ✓ `bun run check` passes; grounding eval 10/10 and rails flow 6/6 still pass.
- **Pending:** visual check at 2560 px and at phone width.

**What we learned:**
- `script.on_nth_tick` replaces handlers for the same interval: the events module silently disabled
  the digest's rate refresher. Now there's a shared dispatcher, and the e2e requires non-empty
  production data.
- The model adds charts, tool calls and length when the prompt offers them. Per-turn guidance decided
  in code (world? chart?) keeps that in check without touching the cached prefix.
- **Latency regression:** with the game running, first token is median ~2.6–2.9 s (max ~4.1 s) and
  answers median ~110 tokens, versus S02's ~1.6 s and ~70 tokens with the game closed. Tracked as FC-079.

**Commits:** 57bf3c0 (FC-020), 4d6102b (FC-041), 86d27ad (FC-040/021), plus the FC-042 and closing commit.
