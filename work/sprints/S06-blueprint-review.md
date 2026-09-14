# S06 — Blueprint review

- **Status:** done
- **Goal:** Paste a blueprint into the chat and get a correct review: what it contains, whether it's valid for this save, and what's wrong with it, without the raw string ever reaching the model.
- **Acceptance:** A blueprint exported from the dev save round-trips through the TypeScript encoder and imports back into the game with the same entity count. The checker flags a deliberately broken copy (unknown entity, overlapping entities, recipe the machine can't craft) and passes the original. Pasting the original into chat yields an answer with the correct entity counts and recipes; pasting the broken copy names the problems. The raw string never appears in the model prompt.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-030 Blueprint string encoder/decoder in TypeScript
  - Acceptance: decode/encode round-trip is lossless on real strings (blueprints and books); the game imports the re-encoded string with the same entity count
  - `server/src/blueprint.ts`: decode/encode, books flattened with paths. A real 49-entity blueprint exported from the dev save round-trips losslessly and the game imports the re-encoded string with 49 entities (`scripts/lib/devgame.ts` export/import helpers)
- [x] FC-082 Entity sizes and collision boxes in the prototype dump
  - Acceptance: every buildable entity has type, tile size and collision box; schema-validated; dump size and time recorded
  - 167 buildable entities with type, tile size and collision box; dump 0.46 MB, Lua ~23 ms (one-off, noted in PLAN). The prototype cache is now keyed on a `DUMP_VERSION` from the mod, so shape changes refresh it (it had silently kept the old shape)
- [x] FC-031 Blueprint checker: entities exist, no overlaps, recipe fits machine
  - Acceptance: flags unknown entities, overlapping footprints and recipes a machine can't craft; passes a real blueprint from the save
  - `server/src/blueprint-check.ts`: unknown entities, footprint overlaps (collision boxes rotated for cardinal directions; rails and signals skipped, since they use their own collision layers and diagonals), unknown or uncraftable recipes; counts, recipes and size. The real 49-entity blueprint passes with no issues
- [x] FC-032 Review a blueprint pasted into chat
  - Acceptance: a pasted string is replaced by a compact summary before the model sees it; the answer's counts and issues match the checker
  - `server/src/blueprint-review.ts`: pasted strings become `[pasted blueprint N]` plus a checked summary (size, counts, recipes, problems); the chat shows `[blueprint N]`; blueprint turns get their own guidance (lead with totals, then every problem). `scripts/e2e-blueprint.ts`: 8/8 twice (real blueprint: 49 entities, top counts, no invented problems; broken copy: unknown entity, bioflux on an assembler, overlapping chests all named; raw strings never in the prompt)

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Next Phase 2 work after the latency sprint; needs no player input (test tooling exports real blueprints from the dev save). Large blueprint *placement* stays out: commands are capped at 48 KB (FC-022).

## Review

Paste a blueprint into the chat and get a grounded review. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ A real 49-entity blueprint exported from the dev save round-trips through the TypeScript
  encoder and the game imports the re-encoded string with 49 entities.
- ✓ The checker passes the real blueprint (no false positives) and flags an unknown entity,
  overlapping entities and an uncraftable recipe.
- ✓ Chat review of the original: "49 entities over 30×28 tiles: express-transport-belt 20, …
  checks found no problems". The broken copy: all three problems named.
- ✓ Raw strings never reach the model (prompt question sizes 534–761 chars; history checked in a unit test).
- ✓ Regressions: grounding 10/10 (first token median 1.11 s), charts 2/2, helmet 13/13, console 4/4;
  rails 6/6 on reruns after fixing a brittle refusal pattern in its test.

**What we learned:**
- The prototype cache needed a format version: changing the dump's shape without one left it stale.
- Checks in code plus a compact summary give the model everything it needs for a review. The model's
  only extra claim worth watching: it once suggested bioflux could be made in a hydro plant (not true;
  "made in" says biochamber only).
- Several e2e failures tonight were brittle refusal regexes, not model errors. Prefer structural
  checks (cards shown, game state) over phrasing.

**Out of scope, still open:** placing blueprints (commands capped at 48 KB, so large blueprints need
chunking), throughput analysis (FC-047), templates (FC-048).

