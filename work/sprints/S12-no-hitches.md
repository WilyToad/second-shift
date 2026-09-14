# S12 — No hitches

- **Status:** done
- **Goal:** Nothing the companion does causes a visible frame drop in normal play, and the hosted game isn't reachable from the LAN.
- **Acceptance:** A research completion updates the companion's recipe data without a full prototype dump; the game-side cost is under 1 ms and the data matches a full dump. The dev game launched by `bun run launch` only listens on 127.0.0.1. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-103 Cheaper prototype refresh when research completes
  - Acceptance: on research_finished the server asks the mod only for what that research changed (unlocked recipes' enabled flag, recipe productivity, the technology's researched state) and patches its cache; patched data equals a fresh full dump; game-side cost profiled < 1 ms; a full dump still happens when the mod list changes or a patch fails
  - New `research_state` action: for named technologies, their researched flag plus the recipes their effects unlock or boost (0.06 ms); for the whole force (1.4 ms, compact lists: a table per recipe made it 5.4 ms). The server patches its data on research events and patches the whole force on reconnect, so research done while the server was off is picked up too (before, a same-mods reconnect kept stale flags). Falls back to a full dump if the mod lacks the action. The system prompt isn't re-measured or re-warmed when research leaves it unchanged. `scripts/test-research.ts` 4/4 in-game: atomic-bomb and mining-productivity-3 (which boosts maraxsis sand extraction) patched in 524 ms with no dump, identical to a fresh full dump. The patch is in memory only; the cache file is rewritten only by full dumps
- [ ] FC-072 Close the hosted game port to the LAN
  - Acceptance: `bun run launch` hosts bound to 127.0.0.1 (checked with lsof); RCON and the player's own client still work
  - **Blocked:** the GUI client ignores `--bind` when hosting (retried tonight: the log shows "Opening socket at 0.0.0.0:34197" with `--bind 127.0.0.1` in the arguments). Other options would change the player's config.ini or macOS firewall, which the overnight rules exclude. Already in place: a random game password, max_players 1 (not verified whether the host counts toward it), no LAN or public listing. Back to the backlog for the player to decide

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. S11 measured a 26 ms prototype dump (about 1.5 frames at 60 UPS) on every research completion. FC-072 changes only the launch flags of the companion's own launcher, not macOS firewall settings.

## Review

Research completion no longer causes a dropped frame. Closing the LAN port was blocked. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ Research completion patches recipe data without a full dump: 0.06 ms in the game (was 26 ms). The data matched a fresh full dump in-game (`test-research` 4/4).
- ✗ Not met: the hosted game still listens on 0.0.0.0:34197. The GUI client ignores `--bind`; FC-072 went back to the backlog for the player.
- ✓ All suites pass: research 4/4, grounding 10/10 (first token median 1.23 s, max 1.91 s), ratios 8/8, rails 6/6, charts 2/2, blueprints 8/8, console 4/4, planning 7/7, diagnosis 4/4, helmet 13/13, machines 7/7, planning helmet 13/13.

**What we learned:**
- Building a table per entry inside a mod reply is expensive: the same whole-force data cost 5.4 ms as tables and 1.3 ms as flat lists.
- A reconnect with the same mods used to keep stale research flags from the cache. The whole-force patch on connect fixes that for 1.4 ms, once.
- Some technologies boost other mods' recipes: mining-productivity-3 raises maraxsis sand extraction productivity. Reading each technology's effects caught it.

