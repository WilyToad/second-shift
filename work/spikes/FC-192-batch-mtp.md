# FC-192 — Batch MTP: what a concurrent request costs us

Spike, 2026-09-18, on oMLX 0.7.0.dev4 with Flash-Next and the dev save hosted. Measured with
`scripts/probe-concurrency.ts`, which talks to oMLX directly — our own server serialises turns
(`busy = busy.then(...)`), so concurrency can only ever come from a second client.

## Verdict

**Build the background pass (FC-193). The cache is not at risk, and that was the blocker.**

The cached prefix survived every arrangement tried: a concurrent request sharing our system prompt, a
concurrent request with an entirely unrelated 4,534-token prefix, and three at once. A lone request
reported `cached 4096` before, between and after all of them, and the stranger held its own 4,096
cached blocks at the same time. Nothing evicted anything.

## Measured

| | first token | decode |
|---|---|---|
| Alone | 0.59, 0.63, 0.66, 0.90 s | **45.4 tok/s** (3 samples) |
| One alongside, shared prefix | 0.74 s | 27.4 tok/s each |
| One alongside, unrelated prefix | 1.09 s | 25.2 tok/s |
| Three at once | 0.69 s | 14.8 tok/s each, ~44 total |

Memory: 72–83 GiB footprint (peak during three), against the 118 GB guard. `ps` RSS is useless here —
it reads ~5 GiB for a model holding ~69 GB, because MLX keeps weights in unified-memory buffers that
aren't resident; `footprint -p` is the number that matters.

## What this changes about the plan

**A background pass costs the player very little of what they feel.** First token is what they wait
for, and it moved 0.59 → 0.74 s with a job alongside — inside the run-to-run spread FC-191 measured.
Decode halves, but even 27 tok/s is about 20 words a second: five times faster than reading and six
times faster than the voice reads it aloud. The player will not notice a background pass; they would
notice a cold prefill, and that is the thing that doesn't happen.

**The throughput claim doesn't transfer to us, and we shouldn't repeat it.** The release measured
+34% and the player's own run measured 1.6× total (44.3 → 71.1 tok/s for three) on long generations.
At our answer lengths — 85–110 tokens — three concurrent gave ~44 tok/s total against 45.4 alone:
**no total gain at all**, just the same work spread thinner. Batch MTP makes concurrency *cheap for
us*, not *fast for us*, and those are different claims.

**So the "run the evals three wide" idea is not the free win I called it.** The token-rate evidence says
the gain is far below 1.6× at our lengths. Suite wall-clock could still improve, because one request's
prefill overlaps another's decode, but that is untested and shouldn't be assumed. If it's wanted, it
needs its own measurement.

## What the probe got wrong first, because the numbers looked fine each time

Six passes, and five of them produced plausible-looking output that was measuring the wrong thing.
Written down because the same traps are waiting for anyone who repeats this:

1. **Prefix too short.** The unpadded system prompt is 1,746 tokens, never crosses a 2,048-token block,
   and reports `cached 0` forever. The prompt has to be aligned exactly as the server aligns it.
2. **The tools are part of the prefix.** They are ~2,000 tokens of it: leaving them out aligned to one
   cached block instead of two, which is a different question from the one being asked.
3. **`tool_choice: "none"` drops them again.** Measured: prompt 4,137 → 2,283. So the tools stay and the
   question asks for prose instead.
4. **A tool call is not a decode sample.** With tools in the prefix the model often answers with one; it
   arrives in a single chunk, and "decode" read 26,000–29,000 tok/s. Samples now require streamed prose.
5. **The first-token clock missed tool-call deltas**, leaving ttft at 0 and folding prefill into decode.
6. **`ps` RSS under-reports MLX memory** by an order of magnitude (5 GiB against a 72 GiB footprint).

## Not measured

- Suite wall-clock with evals run two or three wide (see above).
- Anything above three concurrent: `max_concurrent_requests` is 3 and nothing here argues for raising it.
- Long generations, which is where the published 1.6× comes from. Our answers aren't long, so the case
  wasn't reproduced — and that asymmetry is the finding, not a gap to fill.
- Whether the cache still holds under memory pressure from a *long* background generation, which is what
  reportedly tripped the guard during earlier evals. FC-193 should re-check with the real pass running.
