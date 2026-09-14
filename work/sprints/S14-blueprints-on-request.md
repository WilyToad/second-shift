# S14 — Blueprints on request

- **Status:** active
- **Goal:** The player can ask for a build ("a blueprint for 120 gears a minute") and get a checked, copyable blueprint string sized in code, which really makes that much when built.
- **Acceptance:** Code builds a single-recipe production row from the save's data (machine count from the planner, belt and inserter tiers that keep up, power poles), and the checker finds no problems. Built in the dev game on a temporary surface with infinite inputs, it makes the requested rate within 10%. In chat, the answer gives the summary and a copyable string, and pasting it in-game goes through the existing approval card. All suites pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-048 Template-based blueprint creation
  - Acceptance: `production row` template for recipes with at most 2 solid ingredients and no fluids: N machines in a row, input belt with one ingredient per lane, input and output inserters, output belt, medium power poles; machine count from the planner, fastest unlocked belt and the slowest unlocked inserter that keeps up (throughput analysis finds no limit); unit tests; out-of-scope recipes get a clear reason
  - `server/src/blueprint-template.ts`: machine and productivity from the planner; the slowest unlocked belt whose lane carries the flow (inserters fill only the far lane); the slowest unlocked inserter that keeps up, doubled per machine if needed; poles placed so their supply areas reach every inserter (every 2 machines when one pole can cover both neighbours) and wired explicitly, because a pasted blueprint doesn't auto-connect poles (found in-game: the first build had unpowered output inserters). Every build must pass the blueprint checker and throughput analysis. Refuses fluids, more than 2 ingredients, furnaces, fuel-burning machines (dump v7 `burner` flag) and flows beyond one lane, with the reason. 4 unit tests. Correction: the earlier "one pole every 2 machines" rule covered the machines but not their inserters
- [x] FC-107 Measure generated builds in the dev game
  - Acceptance: test tooling builds a generated blueprint on a temporary lab surface with infinite inputs and power, runs it, and compares the measured output per minute with the request and with the throughput estimate (within 10%) for at least 3 recipes; the surface is deleted afterwards
  - `scripts/test-generated-builds.ts` 6/6: pasted through a real blueprint item, powered by an energy interface, infinity chests in place of the belt tiles the inserters use, 60 game seconds at speed 10. Gears: promised 150/min, measured 149.8. Circuits: 300, measured 299.6. Automation science: 30, measured 30.0. All machines working. Not exercised: belts (chests stand in for them) and productivity (none of the three recipes has any on this save)
- [ ] FC-108 Blueprint requests in chat
  - Acceptance: "make me a blueprint for N X per minute" returns the build summary and a copyable blueprint string (the model never writes the string); the string can be pasted through the place_blueprint approval card; e2e on 2 requests

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. The player's early request: "I could see me requesting the agent create a blueprint." PLAN §3 Blueprints: the model picks a template and parameters, code builds the layout. Measuring in the dev game is test tooling only; the companion never builds test layouts in the player's game.

## Review
