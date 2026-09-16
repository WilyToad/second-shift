# Overnight 2026-09-16 — S30

The player asked for autonomous progress overnight ("Get as much done as you can… I'm headed to bed"), with FC-168
pulled into S30. Rules as always: follow CLAUDE.md and PLAN.md, never push, only the dev save copy, benchmark every
mod change, `bun run check` before every commit, and leave anything that needs the player's own hands marked as pending
rather than claimed done.

Order: FC-163 (lists) → FC-165 (stock) → FC-167 (what the save says you need) → FC-166 (packing list) → FC-164
(in-game panel) → FC-168 (bots fill the list).

## Log

### FC-163 lists the agent keeps — done

- `server/src/lists.ts`: up to 5 named lists × 25 short items, one active, saved with the map's conversation.
  One `update_list` tool per turn can start a list, add, tick off, put back, remove, rename or clear, and it
  matches the player's wording ("the belts" → "200 transport belt"; "packing" → "packing list").
- The active list goes in the turn's tail; the ask guard (FC-126) drops edits on turns that aren't about lists.
- Console: a read-only panel above the alerts, done items struck through, other lists named underneath.
- Measured: system prompt 3,876 tokens (same cached block), eval-grounding 10/10 with first token median
  **1.29 s** vs 1.55 s before the tool. No prompt cost.
- Tests: 10 unit + 1 agent test; full check 177 tests.

