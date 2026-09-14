# S06 — Blueprint review

- **Status:** active
- **Goal:** Paste a blueprint into the chat and get a correct review: what it contains, whether it's valid for this save, and what's wrong with it, without the raw string ever reaching the model.
- **Acceptance:** A blueprint exported from the dev save round-trips through the TypeScript encoder and imports back into the game with the same entity count. The checker flags a deliberately broken copy (unknown entity, overlapping entities, recipe the machine can't craft) and passes the original. Pasting the original into chat yields an answer with the correct entity counts and recipes; pasting the broken copy names the problems. The raw string never appears in the model prompt.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [ ] FC-030 Blueprint string encoder/decoder in TypeScript
  - Acceptance: decode/encode round-trip is lossless on real strings (blueprints and books); the game imports the re-encoded string with the same entity count
- [ ] FC-082 Entity sizes and collision boxes in the prototype dump
  - Acceptance: every buildable entity has type, tile size and collision box; schema-validated; dump size and time recorded
- [ ] FC-031 Blueprint checker: entities exist, no overlaps, recipe fits machine
  - Acceptance: flags unknown entities, overlapping footprints and recipes a machine can't craft; passes a real blueprint from the save
- [ ] FC-032 Review a blueprint pasted into chat
  - Acceptance: a pasted string is replaced by a compact summary before the model sees it; the answer's counts and issues match the checker

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Next Phase 2 work after the latency sprint; needs no player input (test tooling exports real blueprints from the dev save). Large blueprint *placement* stays out: commands are capped at 48 KB (FC-022).

## Review
