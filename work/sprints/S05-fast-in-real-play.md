# S05 — Fast in real play

- **Status:** active
- **Goal:** Answers start fast again while the game is running, without losing accuracy.
- **Acceptance:** With the dev save hosted and live snapshots: grounding eval first token median ≤ 2.0 s and max ≤ 3.0 s; follow-up question ≤ 2.5 s; answers median ≤ 90 tokens; rails flow's first answer ≤ 4 s total. No regressions: grounding 10/10, rails 6/6, charts 2/2. Numbers recorded in PLAN §6.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-080 Per-turn latency breakdown
  - Acceptance: each answer records prompt section sizes (system, history, retrieved lines, snapshot, notes), cached tokens, server and visible first-token times and tool rounds to `data/eval/turns.jsonl`; a script summarizes where the time goes
- [ ] FC-079 Get first-token latency back under target with the game running
  - Notes: S04 measured median ~2.6–2.9 s, max ~4.1 s, answers ~110 tokens (S02: ~1.6 s, ~70 tokens, game closed). Suspects: bigger system prompt (tools + chart rule), live snapshot tail, 2,048-token block alignment, GPU contention (~12%)
  - Acceptance: the S05 acceptance numbers above, measured with the game running
- [ ] FC-081 Shrink the uncached tail: compact snapshot and retrieved lines
  - Acceptance: typical question tail at least 30% smaller in tokens with no eval regression
- [ ] FC-076 Conversation trimming plan that limits cache invalidation
  - Notes: warm follow-ups are 2.5–2.8 s because history past the last 2,048-token block is re-prefilled each turn (PLAN §6)
  - Acceptance: a long conversation keeps follow-ups ≤ 2.5 s; trimming invalidates the cache at most once per trim and is recorded in history

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Chosen because speed is the project's top priority and S04 measured a latency regression (FC-079).

## Review
