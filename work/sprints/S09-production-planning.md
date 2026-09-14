# S09 — Production planning

- **Status:** active
- **Goal:** "How many machines do I need for N/min of X?" gets exact answers for this save: computed in code from the modded recipes and machine speeds, narrated by the model, and drawn as a recipe chain.
- **Acceptance:** A ratio eval of at least 8 questions (vanilla, Gleba and modded items) passes with machine counts and raw input rates within 2% of values computed by an independent reference; answers come from the computed plan (no model arithmetic). The page draws the chain as a `recipe_graph`. Latency stays within S08's numbers and all suites pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-094 Ratio calculator
  - Acceptance: for an item and target rate, expands the recipe tree (canonical recipes, cycles cut, depth capped), picks a crafter the player can use, and returns machines per step and raw input rates; unit tests with hand-checked vanilla ratios
- [ ] FC-047 Throughput analysis for builds and blueprints
  - Acceptance: folded into FC-094/FC-095 for planning questions; blueprint throughput stays for later
- [ ] FC-095 Computed plans in rate questions
  - Acceptance: questions with a target rate get the plan in the tail; the model narrates it without its own arithmetic
- [ ] FC-043 `recipe_graph` component
  - Acceptance: optional for this sprint. Recipe chain with stuck nodes highlighted, drawn from prototypes and status
  - Acceptance: the page draws the plan's chain with machine counts per step, from a terse spec
- [ ] FC-096 Ratio eval
  - Acceptance: ≥ 8 questions, expected numbers from an independent reference implementation in the eval script, 2% tolerance

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Use case #2 in PLAN §1 ("ratios on modded recipes") is the main reason the companion grounds on the save's own data.

## Review
