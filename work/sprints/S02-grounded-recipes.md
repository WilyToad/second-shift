# S02 — Grounded on your modded recipes

- **Status:** planned
- **Goal:** The companion answers recipe and ratio questions about this save's modded content from the save's own data, not vanilla memory.
- **Acceptance:** A scripted set of 10 questions (including maraxsis, Cerys and Gleba items) is answered correctly with the recipe data cited, and first token stays under 3 s once warm at the full prompt size.
- **Started:** —
- **Finished:** —

## Items

- [ ] FC-010 Typed zod schema for `dump_prototypes`
  - Acceptance: the capture from the dev save validates; a renamed field fails the test
- [ ] FC-011 Spike: recipe digest in the prompt vs lookup tools
  - Acceptance: measure the compact digest's token count; decide in PLAN whether recipes go in the cached prefix, behind tools, or both
- [ ] FC-012 Recipe data in the prompt or tools per FC-011, refreshed when the mod list changes
  - Acceptance: changing the mod set (info.mods) triggers a refetch; nothing else does
- [ ] FC-013 Verify the warm path at full prompt size
  - Acceptance: first token under 3 s on the second question; cached tokens reported; numbers recorded in PLAN §5
- [ ] FC-014 Grounding eval script: 10 questions with expected answers taken from the dump
  - Acceptance: `bun scripts/eval-grounding.ts` prints pass/fail per question
- [ ] FC-073 Keep answers short enough to finish fast
  - Acceptance: typical answers under ~120 tokens unless the player asks for detail
- [x] FC-074 `bun run check` runs tests, typecheck and `board --check` together
  - Acceptance: one command, non-zero exit on any failure
  - Done while setting up work tracking, before the sprint started

## Notes

Proposed 2026-09-13; waiting for the player to agree before it becomes active.

## Review
