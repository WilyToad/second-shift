# S02 — Grounded on your modded recipes

- **Status:** done
- **Goal:** The companion answers recipe and ratio questions about this save's modded content from the save's own data, not vanilla memory.
- **Acceptance:** A scripted set of 10 questions (including maraxsis, Cerys and Gleba items) is answered correctly with the recipe data cited, and first token stays under 3 s once warm at the full prompt size.
- **Started:** 2026-09-13
- **Finished:** 2026-09-13

## Items

- [x] FC-010 Typed zod schema for `dump_prototypes`
  - Acceptance: the capture from the dev save validates; a renamed field fails the test
  - Validated against `data/captures/prototypes.json`, captured live from the dev save with the current dump code
- [x] FC-011 Spike: recipe digest in the prompt vs lookup tools
  - Acceptance: measure the compact digest's token count; decide in PLAN whether recipes go in the cached prefix, behind tools, or both
  - Result: full data is 59k tokens (42 s cold, 4.2 s warm), too slow. Decided: small cached prefix + server-side retrieval into the tail (PLAN §6)
- [x] FC-012 Small cached prefix + server-side recipe retrieval (per FC-011), refreshed when the mod list changes
  - Acceptance: changing the mod set (info.mods) triggers a refetch; nothing else does
  - `server/src/game.test.ts` covers refetch on mod change only; recipe lines carry computed "made in" crafters; prototypes cached in `data/cache/` so grounding works before the game connects
- [x] FC-013 Verify the warm path at full prompt size
  - Acceptance: first token under 3 s on the second question; cached tokens reported; numbers recorded in PLAN §5
  - Follow-up question 2.47–2.77 s with a replayed digest; oMLX cache blocks are 2,048 tokens (PLAN §5)
- [x] FC-014 Grounding eval script: 10 questions with expected answers taken from the dump
  - Acceptance: `bun scripts/eval-grounding.ts` prints pass/fail per question
  - Results saved to `data/eval/`; exits non-zero on any failure
- [x] FC-073 Keep answers short enough to finish fast
  - Acceptance: typical answers under ~120 tokens unless the player asks for detail
  - Median ~70 tokens, totals 1.3–3.6 s
- [x] FC-074 `bun run check` runs tests, typecheck and `board --check` together
  - Acceptance: one command, non-zero exit on any failure
  - Done while setting up work tracking, before the sprint started

## Notes

Proposed and activated 2026-09-13.

## Review

The companion now answers questions about this save's modded recipes from the save's own data.

**Acceptance:** `scripts/eval-grounding.ts`, 10 questions with expected facts computed from the
dump, run through the real server with a replayed digest: 10/10; all 30 factual checks passed
across the last three runs. First token median ~1.6 s (max ≤ 2.2 s); warm follow-up 2.5–2.8 s.

**What we learned (details in PLAN §5 and §6):**
- The full save data is 59k tokens: 42 s cold, 4.2 s warm. Too slow for the prefix, so recipes are
  retrieved in code into the question tail instead (FC-011).
- oMLX caches in 2,048-token blocks, not 512 as first recorded.
- Accuracy came from doing analysis in code: computed crafters, unlocking technologies, trigger
  wording, relevance-filtered snapshots. Prompt wording and sampling settings helped less.
- The eval caught two real retrieval gaps and one bug in the eval itself.

**Carried forward:**
- The mod now dumps the character prototype (exact hand-crafting categories). It hasn't been run
  in-game yet, because the game was closed during this sprint: FC-077.
- Follow-up latency is close to the 3 s line as history grows: FC-076.
- Commits: cac9e27 (FC-010), 72a3c31 (FC-011), dadb01a (FC-012), plus this sprint's closing commit.

