# S07 — Bottleneck diagnosis

- **Status:** active
- **Goal:** "Why is X slow?" gets a grounded answer: which machines are stuck, on what (missing ingredients, full output, no power), and the upstream cause, from live machine status that costs the game almost nothing to collect.
- **Acceptance:** On the dev save, machine status is tracked by an event-maintained registry and round-robin polling: average added cost ≤ 0.1 ms/tick and no single tick over 1 ms (profiler). In a scripted scenario (test tooling starves or blocks some machines), asking "why is <recipe> slow?" names the stuck machines' status and the missing input or blocked output, and a follow-up highlights them in-game. Grounding 10/10, rails 6/6 and the other suites still pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-083 Machine registry kept by build/remove events
  - Acceptance: crafting machines, furnaces, labs and drills tracked per surface via build/remove events and `register_on_object_destroyed`; initial registry built across ticks after load; counts match a one-off scan on the dev save
- [ ] FC-084 Round-robin status polling with a fixed per-tick budget
  - Acceptance: status counts per surface and recipe (working, no ingredients, full output, no power, …) refreshed in rotation; profiler cost within the S07 budget; refresh period reported
- [ ] FC-085 Status in the digest and a `find_stuck` look tool
  - Acceptance: the snapshot shows stuck counts for relevant recipes; the agent can list and highlight stuck machines for a recipe near the player or on a surface
- [ ] FC-043 `recipe_graph` component
  - Acceptance: optional for this sprint. Recipe chain with stuck nodes highlighted, drawn from prototypes and status
- [ ] FC-086 Diagnosis scenario eval
  - Acceptance: scripted scenario on the dev save; "why is <recipe> slow?" names the right status and missing input; runs in `scripts/`

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Use case #1 in PLAN §1 ("why is X slow?") still had no machine-status data; the digest only had aggregates. Follows PLAN §5 rules 3–4 (event registry, amortized polling).

## Review
