# S19 — Show me

- **Status:** done
- **Goal:** "Show me the stuck assemblers" can answer with a picture of that spot, without making the game stutter.
- **Acceptance:** The cost of `game.take_screenshot` is measured and recorded in PLAN. A `screenshot` look action captures an area the player can see (refuses fog of war), the server serves the image to the page, and the agent can show the player's spot or its last search result. Screenshot files are capped in number. e2e: a screenshot request shows a real image in chat. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-049 Screenshots and their game cost (PLAN §8 Q7)
  - Acceptance: as above; in-game test for the visible and fog-of-war cases; unit tests for the tool and file handling; display test for the image card
  - Measured first (PLAN §8 Q7): Lua call 0.10–0.23 ms, the game kept 60 UPS through every capture, 1024 px JPEG ready in ~40 ms (486 KB) vs 2.6 MB for PNG. Mod `screenshot` look action: refuses spots the force can't see, clamps size (256–2048) and zoom (0.1–2), writes `script-output/companion/shot-<tick>-<n>.jpg`. The server waits until the file stops growing, keeps the newest 20, and serves only names matching the pattern at `/shots/<name>`. The agent tool `screenshot` (here, or centred on the last result) shows the picture on the page and tells the model it can't see it. Tests: `test-screenshot` 3/3 in-game (488 KB image, fog of war refused, clamping), unit tests for waiting and pruning, agent and display tests, `e2e-screenshot` 4/4 twice (real JPEG served, a path-traversal name gets 404, the answer doesn't pretend to see the image; 5.5–8 s for two model rounds)

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Screenshots are written by the game to `script-output/companion/` on request only (explicit captures, allowed by the file rules); the server keeps the newest 20.

## Review

"Show me" now works with a real picture, at no measurable game cost. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Cost measured and recorded in PLAN §8 Q7.
- ✓ Look action with the visibility rule, file handling, serving, page card; e2e 4/4 twice.
- ✓ All suites pass on this server: grounding 10/10, ratios 8/8, rails 6/6, charts 2/2, blueprints 9/9, throughput 8/8, blueprint requests 6/6, console 4/4, planning 7/7, diagnosis 4/4, settings 3/3, selection 7/7. In that run, grounding's first token median was 2.38 s (decoding was slow too: 14 s total for a 37-token answer, with the cache still hit). Two reruns right after: median 1.36 s and 1.20 s, so it was transient machine load, not the prompt (system prompt 4,120 tokens, still one block).

**What we learned:**
- The game renders screenshots on the client, so a capture doesn't cost ticks. JPEG is 5× smaller than PNG at the same size.
- A latency number from a single run can mislead: check whether decoding slowed too before blaming the prompt.

