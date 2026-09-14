# S18 — Picks up where you left off

- **Status:** done
- **Goal:** Restarting the companion (or reloading the page) doesn't lose the conversation, and the first question afterwards is still fast.
- **Acceptance:** The conversation (compacted model history plus what the page showed) is saved after each answer as one small file and restored when the server starts; the page shows the earlier conversation when it connects; the model's cache is warmed with the restored history; "New conversation" clears the saved file. After a server restart, a follow-up that depends on the previous question is answered correctly and its first token arrives within the usual follow-up time. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-063 Session memory across play sessions
  - Acceptance: as above; unit tests for save, restore and reset; display test for the replayed thread; e2e across a server restart
  - The agent keeps a transcript of what the page showed and, after each answer (after any compaction), writes it and the compacted model history to `data/session.json`. A new server loads it; pages that connect get a `transcript` message and rebuild the thread (only if empty, so a second page doesn't duplicate it); start-up warming includes the restored history; "New conversation" deletes the file. Agent unit test (save → new agent restores and the model sees the earlier answer → reset clears), display test. `scripts/e2e-session.ts` across a real restart: the page showed the earlier question, "What did I ask you about just before this?" answered "carbon fiber", first token 780–812 ms with the 4,096-token prompt block cached

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. One JSON write per answer (seconds apart), not a periodic write; `data/` is gitignored.

## Review

Restarting the companion or reloading the page keeps the conversation. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Saved after each answer, restored on start, replayed to the page, cleared by "New conversation".
- ✓ After a real restart, the follow-up used the earlier question, with first token in 0.78 s.
- ✓ Suites on this server: grounding 10/10, rails 6/6, console 4/4, planning 7/7, selection 7/7, ratios 8/8. Charts 1/2 and blueprints 8/9 in the first run; both causes found and fixed below, then charts 2/2 and blueprints 9/9 twice.

**What we learned (fixes made during the regression run):**
- The blueprint "no invented problems" check's pattern matched the correct answer "Checks: no problems found". Its earlier failures (FC-110) were probably this test bug, not the model. The pattern now ignores "no problems found".
- The fallback chart needs an item. "How is my science doing?" names none, so when the model skipped the chart there was nothing to draw. Science questions now chart the pack with the most 10-hour production.

