# S14 — Blueprints on request

- **Status:** done
- **Goal:** The player can ask for a build ("a blueprint for 120 gears a minute") and get a checked, copyable blueprint string sized in code, which really makes that much when built.
- **Acceptance:** Code builds a single-recipe production row from the save's data (machine count from the planner, belt and inserter tiers that keep up, power poles), and the checker finds no problems. Built in the dev game on a temporary surface with infinite inputs, it makes the requested rate within 10%. In chat, the answer gives the summary and a copyable string, and pasting it in-game goes through the existing approval card. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-048 Template-based blueprint creation
  - Acceptance: `production row` template for recipes with at most 2 solid ingredients and no fluids: N machines in a row, input belt with one ingredient per lane, input and output inserters, output belt, medium power poles; machine count from the planner, fastest unlocked belt and the slowest unlocked inserter that keeps up (throughput analysis finds no limit); unit tests; out-of-scope recipes get a clear reason
  - `server/src/blueprint-template.ts`: machine and productivity from the planner; the slowest unlocked belt whose lane carries the flow (inserters fill only the far lane); the slowest unlocked inserter that keeps up, doubled per machine if needed; poles placed so their supply areas reach every inserter (every 2 machines when one pole can cover both neighbours) and wired explicitly, because a pasted blueprint doesn't auto-connect poles (found in-game: the first build had unpowered output inserters). Every build must pass the blueprint checker and throughput analysis. Refuses fluids, more than 2 ingredients, furnaces, fuel-burning machines (dump v7 `burner` flag) and flows beyond one lane, with the reason. 4 unit tests. Correction: the earlier "one pole every 2 machines" rule covered the machines but not their inserters
- [x] FC-107 Measure generated builds in the dev game
  - Acceptance: test tooling builds a generated blueprint on a temporary lab surface with infinite inputs and power, runs it, and compares the measured output per minute with the request and with the throughput estimate (within 10%) for at least 3 recipes; the surface is deleted afterwards
  - `scripts/test-generated-builds.ts` 6/6: pasted through a real blueprint item, powered by an energy interface, infinity chests in place of the belt tiles the inserters use, 60 game seconds at speed 10. Gears: promised 150/min, measured 149.8. Circuits: 300, measured 299.6. Automation science: 30, measured 30.0. All machines working. Not exercised: belts (chests stand in for them) and productivity (none of the three recipes has any on this save)
- [x] FC-108 Blueprint requests in chat
  - Acceptance: "make me a blueprint for N X per minute" returns the build summary and a copyable blueprint string (the model never writes the string); the string can be pasted through the place_blueprint approval card; e2e on 2 requests
  - Requests with "blueprint/layout/schematic" plus a rate are built in code before the model runs (no tool round trip). The page gets a `blueprint` message and shows a `layout_sketch` card: a top-down tile drawing with direction ticks, the summary, and a "Copy blueprint string" button (a text box to copy by hand if the clipboard is blocked). The model sees one line describing the build, and the string becomes the last blueprint, so "paste it" goes through the existing approval card. `scripts/e2e-blueprint-request.ts` 6/6 twice: gears 120/min → 1 assembling-machine-3 (150/min) and automation science 30/min → 2; the answers use the build's numbers; the paste placed 11 of 11 ghosts (the test moves the player to open ground first and back after, and removes the ghosts). Found and fixed on the way: the model did extra arithmetic ("9.6 copper plate/min worth of ore") and opened a paste card before being asked; the turn's guidance now forbids both. Covers the display half of FC-044 too

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. The player's early request: "I could see me requesting the agent create a blueprint." PLAN §3 Blueprints: the model picks a template and parameters, code builds the layout. Measuring in the dev game is test tooling only; the companion never builds test layouts in the player's game.

## Review

The player can ask for a blueprint at a rate and get one that is checked, copyable, pasteable through the approval card, and measured to make what it promises. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Production rows built in code from the save's data; every build passes the checker and throughput analysis (4 unit tests).
- ✓ Measured in the dev game within 1%: gears 149.8/150, circuits 299.6/300, automation science 30.0/30 per minute. Belts weren't exercised in that test (chests stood in for them).
- ✓ Chat: summary plus a layout sketch with a copy button; the model never writes the string; paste through the approval card placed 11 of 11 ghosts (`e2e-blueprint-request` 6/6 twice).
- ✓ All suites pass on a server running this code: grounding 10/10 (first token median 1.22 s, max 1.90 s), ratios 8/8, rails 6/6, charts 2/2, blueprints 8/8, throughput 8/8, blueprint requests 6/6, console 4/4, planning 7/7, helmet 13/13, planning helmet 13/13, research 4/4, inserters 5/5. Diagnosis was 3/4 once (the model said the machines were already highlighted from the previous turn instead of searching again), then 4/4 three times. Machines was 6/7 once: an off-by-one from reading counts and the index in two calls while the game ran. The test now pauses the game for that comparison: 7/7 twice.
- Latency report after the change: median visible first token 1.61 s (single-round 1.35 s, with tools 2.06 s); system prompt 4,138 tokens, still one cache block past 4,096.

**What we learned:**
- A pasted blueprint doesn't connect its poles; wires must be in the blueprint. Only the in-game build showed it.
- One pole per two machines powers the machines but not necessarily their inserters. Coverage has to be checked for the smallest entities.
- Given a build summary, the model still adds its own arithmetic and offers actions early. Say "only these numbers" and "no tool call" in the turn guidance.

