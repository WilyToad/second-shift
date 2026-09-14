# S09 — Production planning

- **Status:** done
- **Goal:** "How many machines do I need for N/min of X?" gets exact answers for this save: computed in code from the modded recipes and machine speeds, narrated by the model, and drawn as a recipe chain.
- **Acceptance:** A ratio eval of at least 8 questions (vanilla, Gleba and modded items) passes with machine counts and raw input rates within 2% of values computed by an independent reference; answers come from the computed plan (no model arithmetic). The page draws the chain as a `recipe_graph`. Latency stays within S08's numbers and all suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-094 Ratio calculator
  - Acceptance: for an item and target rate, expands the recipe tree (canonical recipes, cycles cut, depth capped), picks a crafter the player can use, and returns machines per step and raw input rates; unit tests with hand-checked vanilla ratios
  - `server/src/planner.ts`: canonical unlocked recipes, fastest unlocked crafter, merged intermediates, catalysts counted net, cycles cut. The mod dump now lists raw resources (mined, harvested, pumped, asteroid chunks; DUMP_VERSION 3) so plans stop at ore and oil instead of asteroid crushing or barrel emptying. Hand-checked tests (circuits, gears, catalysts)
- [-] FC-047 Throughput analysis for builds and blueprints
  - Acceptance: folded into FC-094/FC-095 for planning questions; blueprint throughput stays for later
  - Split: planning throughput is done in FC-094/FC-095; throughput analysis of an actual blueprint moved to FC-097
- [x] FC-095 Computed plans in rate questions
  - Acceptance: questions with a target rate get the plan in the tail; the model narrates it without its own arithmetic
  - Rate questions ("60 bioflux per minute") get a computed plan line; the item next to the number is planned, not the machine being counted (the first version planned 60 biochambers/min). The model quotes the plan
- [x] FC-043 `recipe_graph` component
  - Acceptance: optional for this sprint. Recipe chain with stuck nodes highlighted, drawn from prototypes and status
  - Acceptance: the page draws the plan's chain with machine counts per step, from a terse spec
  - Drawn from the computed plan the server sends with the answer (no model-written spec, so numbers can't drift): layered chain with raw inputs, machine counts, locked steps outlined
- [x] FC-096 Ratio eval
  - Acceptance: ≥ 8 questions, expected numbers from an independent reference implementation in the eval script, 2% tolerance
  - `scripts/eval-ratios.ts`: 8 questions (circuits, gears, bioflux, agricultural science, plastic, LDS, red science, maraxsis glass) with an independent one-step reference; 8/8 on two runs

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Use case #2 in PLAN §1 ("ratios on modded recipes") is the main reason the companion grounds on the save's own data.

## Review

"How many machines for N/min of X?" gets exact answers for this save, drawn as a chain. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Ratio eval 8/8 on two runs; machine counts and input rates within 2% of an independent reference,
  including Gleba (bioflux, agricultural science) and maraxsis glass panes.
- ✓ Answers quote the computed plan (e.g. "0.75× biochamber … yumako-mash 225/min").
- ✓ The page draws the chain as a recipe graph from the plan (happy-dom test).
- ✓ Latency: grounding first token median 1.17–1.67 s (max ≤ 2.02 s), follow-ups 2.25–2.44 s (target 2.5 s).
- ✓ All suites pass: grounding 10/10, rails 6/6, charts 2/2, blueprints 8/8, console 4/4, planning 7/7,
  diagnosis 4/4, helmet 13/13, machines 5/5, planning helmet 13/13.

**What we learned:**
- A planner without a notion of *raw* resources wanders into alternative chains (iron ore from
  asteroid crushing, crude oil from barrels). The mod now reports what's gathered, not crafted.
- Parsing matters more than math: "how many biochambers for 60 bioflux" first planned biochambers.
- Another eval regex miss (curly apostrophes). Evals now accept both apostrophe styles.

**Carried forward:** productivity bonuses, modules and beacons aren't modeled (stated in every plan);
surface conditions (e.g. pressure) aren't checked against where the player builds; blueprint throughput
(FC-097). Follow-up latency is close to the 2.5 s line.

