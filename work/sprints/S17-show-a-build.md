# S17 — Show the companion a build

- **Status:** done
- **Goal:** The player can drag an in-game tool over a build and get it reviewed in chat, without copying a blueprint string.
- **Acceptance:** A shortcut gives a selection tool; dragging it copies the area like a blueprint tool and the review (summary, throughput, sketch) appears in chat on its own. Verified through the same capture code in the dev game; using the shortcut by hand is the player's check. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-046 Blueprint selection tool in the mod
  - Acceptance: shortcut + selection tool prototypes; on selection the mod makes a blueprint of the area, announces it in the event feed, and the app fetches it and reviews it like a pasted blueprint; e2e through the server
  - `data.lua` adds `companion-selection-tool` (spawned by the `companion-select-build` shortcut, blueprint icon, copy-style box). `scripts/selection.lua` copies the dragged area with `create_blueprint` like the player's blueprint tool, pushes a `selection` event (entity count, surface, centre) and keeps the string in a module local for `get_selection` (capped at 4 MB). The event feed moved to `scripts/feed.lua` so modules can share it. The server fetches the string when the event arrives and asks the review for the player ("Review the build I just selected: [blueprint 1]"); the guidance says the build already exists, so the answer doesn't offer to paste it. `scripts/e2e-selection.ts` 7/7 twice via the `debug_select_area` test handler (same capture code): 49 entities around the player, feed event, automatic review with sketch and entity count in 3.8 s, stale selections refused. Prototypes verified loaded (`scripts/probes/selection-prototypes.ts`). Blueprint e2e still 9/9
- [ ] FC-115 Player check: use the shortcut in-game
  - Acceptance: the player clicks "Show the companion a build" on the shortcut bar, drags over a build, and the review shows up in the companion page
  - Pending player verification

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. The selection tool only reads what the player selects, like the blueprint tool; it never changes the map. No per-tick cost: the handler runs only on selection events (not benchmarked separately).

## Review

The whole path from selection to review works, tested through the same capture code; the hands-on shortcut check is pending. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Prototypes load; capture, feed event, fetch, automatic review with sketch (`e2e-selection` 7/7 twice).
- ⏳ Pending player: clicking the shortcut and dragging by hand (FC-115).
- ✓ Blueprint review unchanged (9/9).

**What we learned:**
- Keeping big data out of the event feed (the feed carries a count, the app fetches the string) keeps the 250 ms event poll small.
