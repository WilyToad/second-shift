# S07 — Bottleneck diagnosis

- **Status:** active
- **Goal:** "Why is X slow?" gets a grounded answer: which machines are stuck, on what (missing ingredients, full output, no power), and the upstream cause, from live machine status that costs the game almost nothing to collect.
- **Acceptance:** On the dev save, machine status is tracked by an event-maintained registry and round-robin polling: average added cost ≤ 0.1 ms/tick and no single tick over 1 ms (profiler). In a scripted scenario (test tooling starves or blocks some machines), asking "why is <recipe> slow?" names the stuck machines' status and the missing input or blocked output, and a follow-up highlights them in-game. Grounding 10/10, rails 6/6 and the other suites still pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-083 Machine registry kept by build/remove events
  - Acceptance: crafting machines, furnaces, labs and drills tracked per surface via build/remove events and `register_on_object_destroyed`; initial registry built across ticks after load; counts match a one-off scan on the dev save
  - `scripts/machines.lua`: build events with type filters + `register_on_object_destroyed`; initial registry from a 16-chunks-per-tick scan (27 s on the dev save, tick cost median 0.10 ms / max 0.34 ms). 2,746 machines, matching a direct count; build/destroy tracked (`scripts/test-machines.ts` 5/5)
- [x] FC-084 Round-robin status polling with a fixed per-tick budget
  - Acceptance: status counts per surface and recipe (working, no ingredients, full output, no power, …) refreshed in rotation; profiler cost within the S07 budget; refresh period reported
  - 20 machines per tick in rotation (refresh every 138 ticks on the dev save), incremental counts per surface/recipe/status; ~0.055 ms per tick by profiler. First real finding: 241 iron and 317 copper drills on Nauvis are waiting for space in destination
- [x] FC-085 Status in the digest and a `find_stuck` look tool
  - Acceptance: the snapshot shows stuck counts for relevant recipes; the agent can list and highlight stuck machines for a recipe near the player or on a surface
  - Digest carries each surface's worst stuck recipes (Lua digest now ~0.48 ms per 2 s poll); snapshot adds them for slowness/rate questions, filtered to named surfaces and items, plus computed diagnosis hints ("root cause: research has stopped …", output-blocked or starved surfaces). `find_stuck_machines` lists and highlights (visible chunks only). On the dev save: "Why is my Nauvis factory floor so slow?" leads with the research stall; "Show me the stuck yumako processing machines" highlights them on Gleba
- [ ] FC-043 `recipe_graph` component
  - Acceptance: optional for this sprint. Recipe chain with stuck nodes highlighted, drawn from prototypes and status
- [ ] FC-086 Diagnosis scenario eval
  - Acceptance: scripted scenario on the dev save; "why is <recipe> slow?" names the right status and missing input; runs in `scripts/`

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Use case #1 in PLAN §1 ("why is X slow?") still had no machine-status data; the digest only had aggregates. Follows PLAN §5 rules 3–4 (event registry, amortized polling).

## Review
