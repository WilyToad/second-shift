# S31 — Hear you properly

- **Status:** active
- **Started:** 2026-09-17
- **Goal:** What the player says is what the companion reads: they choose the recognition engine, the console picks the alternative that matches their save's words, and a local transcriber is researched before anyone builds one.
- **Acceptance:** The composer offers a clear choice of recognition engine with the tradeoff stated, and remembers it; several alternatives are scored against a vocabulary the server sends, so the save's own words win; a spoken question is marked as spoken in the turn; the FC-176 recommendation is written up in these notes and PLAN, including what to measure before building anything; existing suites still pass.

## Items

- [ ] FC-174 Let the player pick the recognition engine
  - Notes: player, 2026-09-17: transcription is spotty ("running wire" heard as "running wine", "I've got 10" as "Got10", "red dots" as "red darts"). `voice.ts` sets `processLocally = true` whenever the on-device model is installed, with no way back to Chrome's online service, which is the more accurate of the two. The tradeoff is the player's to make, and the console already labels where the voice goes
  - Acceptance: a choice in the composer between Chrome's online service and on-device, with the tradeoff said plainly (accuracy versus nothing leaving the Mac); remembered per browser; installing the on-device model counts as choosing it; the "where the voice goes" label matches the actual choice; unit tests
- [ ] FC-175 Use the alternatives the recognizer already returns
  - Notes: we ask for `maxAlternatives = 1` and take the first guess. Chrome returns an N-best list; the alternative containing this save's own words is usually the right one ("belt" over "bolt", item names over near-homophones). The page has no prototype data, so the server sends a small vocabulary once per connection. Second half: the turn should know the question was spoken, so an odd word reads as a mis-hear rather than a fact
  - Acceptance: several alternatives requested and scored against a vocabulary the server sends on connect, best one used, engine order breaking ties; the vocabulary message is small (a few KB) and costs nothing in the prompt; a spoken question is marked as spoken in the turn; unit tests over the player's own examples and over sentences with no domain words (which must come through unchanged)
- [ ] FC-176 Local speech-to-text: spike
  - Notes: the real fix for accuracy may be a Whisper-class model on this machine — as accurate as the online service with nothing leaving the Mac, which is the project's stance. ElevenLabs Scribe is the online alternative once the audio plumbing exists (the key is already held server-side). Researched by a delegated pass, 2026-09-17
  - Acceptance: a written recommendation in the sprint notes and PLAN: the candidates with their accuracy, size, licence and streaming ability; what fits in memory beside oMLX's ~69.5 GB; the added latency for a 3–6 s utterance; how audio gets from the page to a transcriber and what happens to interim text; how each option can be biased toward the save's vocabulary; and a first slice with what to measure before committing — including "keep the browser engine" if the evidence says so

## Notes

Opened at the player's request (2026-09-17) after an early-game session where three of 24 spoken turns came through wrong: "I'm running wire" → "running wine", "I've got 10 red bottles" → "Got10 red bottles", "a big red dots on the map up there" → "a big red darts on the map of there". FC-176 was delegated as a research pass; FC-173 (hands-free cutting sentences off) sits next to these in the backlog and wasn't pulled in.
