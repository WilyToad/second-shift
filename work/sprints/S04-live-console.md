# S04 — Live console

- **Status:** active
- **Goal:** The second-monitor page becomes the console from the mockup: urgent alerts and live factory state beside the chat, and answers can include a real rate chart.
- **Acceptance:** On the dev save, with the server running: an urgent alert triggered in-game appears in the page's alert feed within ~1 s, with no page polling. The live-state panel shows research, per-surface production and science with sparklines drawn from server history. Asking "how is my science doing?" returns an answer with a `rate_chart` drawn from real snapshot history. The mod's added cost stays within budget by profiler, `bun run check` passes, and the page works at 2560 px wide and at phone width.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-020 `events` action: ring buffer of urgent events with "since N" polling
  - Acceptance: server polls every ~250 ms; no event lost across polls; cost measured with the profiler
  - `scripts/events.lua`: urgent alert types sampled every 30 ticks (rises only) + `on_research_finished`, 200-event ring buffer. Poll costs 0.03–0.04 ms; research and destroyed-wall events arrived within 469 ms (`scripts/probes/events-ingame.ts`). Server reports gaps as `dropped`
- [ ] FC-021 Alert feed in the web page
  - Acceptance: alerts appear within ~1 s of the event; severity, surface and count shown; no polling from the page
- [x] FC-041 Choose a UI framework for the console
  - Acceptance: decision and reasoning recorded in PLAN §4; the chat page ported to it with no loss of function
  - Preact + @preact/signals (PLAN §4). Chat ported (`store.ts`, `chat.tsx`, `main.tsx`) with a "New conversation" button; happy-dom render test; rails e2e still 6/6
- [ ] FC-040 Full web console per the mockup
  - Acceptance: three-column layout from the mockup (alerts | chat | live state), stacks on narrow screens; live state from the digest stream
- [ ] FC-042 Visual component renderer and `rate_chart`
  - Acceptance: server keeps snapshot history per item; the model emits a terse `rate_chart` spec; the page draws it from history, not from model numbers

## Notes

Planned and activated 2026-09-14 overnight: the player delegated sprint activation for this night. Chosen from the backlog because the alert feed and console build directly on S01–S03 and need no player input. Blueprints (FC-030–FC-032) are the next candidate.

## Review
