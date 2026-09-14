# S05 — Fast in real play

- **Status:** active
- **Goal:** Answers start fast again while the game is running, without losing accuracy.
- **Acceptance:** With the dev save hosted and live snapshots: grounding eval first token median ≤ 2.0 s and max ≤ 3.0 s; follow-up question ≤ 2.5 s; answers median ≤ 90 tokens; rails flow's first answer ≤ 4 s total. No regressions: grounding 10/10, rails 6/6, charts 2/2. Numbers recorded in PLAN §6.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-080 Per-turn latency breakdown
  - Acceptance: each answer records prompt section sizes (system, history, retrieved lines, snapshot, notes), cached tokens, server and visible first-token times and tool rounds to `data/eval/turns.jsonl`; a script summarizes where the time goes
  - `data/eval/turns.jsonl` + `scripts/latency-report.ts`. First findings: single-call answers median 1.11 s, two-call (tool) 3.36 s; ~0.35 s constant between server and visible first token; the stable prefix (~3.7k tokens) spans a 2,048-token block, so novel questions re-read ~1.7k stable tokens (1.8–2.0 s). Repeated eval questions hit 4,096 cached because the same text was asked earlier, which flatters the eval
- [x] FC-079 Get first-token latency back under target with the game running
  - Notes: S04 measured median ~2.6–2.9 s, max ~4.1 s, answers ~110 tokens (S02: ~1.6 s, ~70 tokens, game closed). Suspects: bigger system prompt (tools + chart rule), live snapshot tail, 2,048-token block alignment, GPU contention (~12%)
  - Acceptance: the S05 acceptance numbers above, measured with the game running
  - Met with the game running: first token median 1.23 s / max 1.92 s, follow-up 2.39 s, answers median 90 tokens, rails first answer 3.6 s; grounding 10/10, rails 6/6, charts 2/2. Main fix: the system prompt is padded with category→crafter reference lines until it crosses the 4,096-token cache block (`alignToCacheBlock`, measured at startup): novel questions' server first token went 2.03 s → 0.80 s. Also a 60-word answer limit
- [x] FC-081 Shrink the uncached tail: compact snapshot and retrieved lines
  - Acceptance: typical question tail at least 30% smaller in tokens with no eval regression
  - Median uncached tail 1,004 → 531 tokens (−47%); retrieved lines −30% (recipes nothing can craft and recycling loops skipped, canonical producers first, one producer per ingredient, two uses, category dropped when crafters are listed, `pressure=2000` form). Grounding 10/10, first token median 1.11 s. Also a deterministic `rate_chart` fallback for trend answers that omit the block (the model skipped it ~1 in 4), charts 6/6 over 3 runs. Alignment margin lesson: `measure` includes ~10 placeholder user-turn tokens, so stopping right at 4,096 left block 2 uncached (first token 2.48 s); a 24-token margin fixed it
- [ ] FC-076 Conversation trimming plan that limits cache invalidation
  - Notes: warm follow-ups are 2.5–2.8 s because history past the last 2,048-token block is re-prefilled each turn (PLAN §6)
  - Acceptance: a long conversation keeps follow-ups ≤ 2.5 s; trimming invalidates the cache at most once per trim and is recorded in history

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Chosen because speed is the project's top priority and S04 measured a latency regression (FC-079).

## Review
