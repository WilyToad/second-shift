# S01 — Vertical slice

- **Status:** done
- **Goal:** Ask one question in a web page and get an answer grounded in the live game.
- **Acceptance:** "What's my science output?" answered from live state on the dev save, first token under 5 s warm, no measurable UPS cost.
- **Started:** 2026-09-13
- **Finished:** 2026-09-13

## Items

- [x] FC-001 Bun workspace, strict tsconfig, test runner
  - Commit: 727d8b8
- [x] FC-002 Enable RCON in the real config.ini (`scripts/setup-rcon.ts`)
  - Commit: 727d8b8
- [x] FC-003 RCON client with request-id matching and partial writes
  - Commit: 727d8b8
- [x] FC-004 Mod skeleton with `/companion` JSON command; link and launch scripts
  - Commit: 60d94e7
- [x] FC-005 `dump_prototypes` runtime view over RCON (Q12)
  - Commit: 60d94e7
- [x] FC-006 Benchmark harness with mirrored mod folders
  - Commit: 2b275ae
- [x] FC-007 Digest with amortized rate refresh and filtered alerts
  - Commit: 649e4d1
- [x] FC-008 Server: game link, oMLX streaming client, prompt assembly, web chat
  - Commit: 31cc375
- [x] FC-009 Science stall rates and tighter grounding rules
  - Commit: b54684c

## Review

Shipped the whole path: mod → RCON → Bun server → oMLX → web chat.

- Grounded answers; first token 1.5–2.1 s; short answers 2.4–3.8 s total, a 232-token answer
  7.1 s (decode ~45 tok/s).
- Digest Lua cost cut from ~1.6 ms to ~0.2 ms per call; mod ≈ 0.005 ms/tick (PLAN §8 Q8).
- Full modded prototype dump: 0.44 MB in ~30 ms (PLAN §8 Q12).
- oMLX prefix cache works in ~512-token blocks: 15k-token prompt 11.5 s cold → 0.93 s warm (PLAN §5).
- Findings: Factorio auto-updated to 2.0.77; hosted game port is reachable on the LAN (PLAN §9).
