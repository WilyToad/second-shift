# Verify

What has shipped with tests and evals but hasn't been seen by the player. One Chrome session with the game running
walks most of it; the order below front-loads the checks that answer open questions. Tick a row, note what you saw,
and the item it names gets its `[x]` honestly.

**Setup:** launch the game, then `bun run start`, then open http://127.0.0.1:5170 in **Chrome** (Safari has no
`phrases` API, so it can't answer the biasing question). Tick **Keep my audio** before you talk. Say **Talk** or
Alt+V to start listening.

| # | Status | Do | Say / expect | Pass looks like | Closes |
|---|---|---|---|---|---|
| 1 | ✅ 18 Sep — nine clips; two mic consumers work in Chrome (after FC-207 fixed the tap not opening on reload) | Tick **Keep my audio**, then say anything | A clip count appears under the composer | "1 clip kept"; no error line; if Chrome refuses a second microphone consumer, a visible error and voice still works | FC-188 |
| 2 | ✅ 18 Sep — service 5/5, all first guesses; on-device 4/5 at boost 1. Service refuses the list; rescoring removed (FC-210) | Say the five sentences | "Okay, I'm running wire" · "I've got 10 red bottles to research automation" · "I see a big red dots on the map up there, that must be monsters" · "I built ten of them" · "a bit further" | Read the server log's `Heard (…)` lines: which alternative won and whether phrases were applied. **Wire** heard right with phrases applied = biasing works and FC-175 rescoring comes out; heard right via an alternative = rescoring earned its keep; wrong = FC-189 is next | S31, FC-177, FC-175 |
| 3 | ✅ 18 Sep — one correction saved ("bottles to research") | On any mis-hear, click **Not what I said** and type it | The count's "with your own wording" rises | Ground truth is being saved | FC-188 |
| 4 | ✅ 18 Sep — every sentence went up on both engines | Speak, then stop for 2 s | The sentence goes up into the thread | Nothing vanishes | FC-183 |
| 5 | ✅ 18 Sep — both paths: twice it held then sent at the 6 s cap; the third time the resume was stitched on ("What's the best way to get my Coal up here") | Say "…what's the best way to get my" and pause | It waits; finish the sentence | One question, not two | FC-173 |
| 6 | ✅ 18 Sep — "Ballast how many rails are near me", name intact at boost 1 | Say "Ballast, how many rails are near me?" | The transcript shows **Ballast** | His name survives recognition (boost 8) | FC-178 |
| 7 | ✅ 18 Sep — heard, and it found two bugs: pointer at the end (FC-213) and a whole paragraph silenced for one sentence (FC-218), both fixed | Turn on **Read answers aloud**, ask "how many biochambers for 60 bioflux a minute?" | The voice says the headline then "the chart's in the app" | No recital of the working | FC-190 |
| 8 | ✅ 18 Sep — "before power", goals from the row, wreckage and patches from the save, one throwback | Ask "what should I work on next?" | It names the stage it thinks you're in | You can tell it it's wrong; it answers from that stage's goals | FC-181, FC-205 |
| 9 | ✅ 18 Sep — dry: "Every day, and it's not a thing I talk about on shift" (no second throwback after the restarts: FC-215 holds); flat: the monsters answer, row 19 | Ask "do you ever miss flying?" then "is anything attacking me?" | Dry, one clause of the past; then flat, nothing about himself | The register tiers | FC-179, FC-182 |
| 10 | ⬜ | Hover a modded entity (a maraxsis or Cerys thing), ask "what is this?" | Only the save's facts about it | No invented mechanics | S27 |
| 11 | ⬜ | Hover a chest, ask "what's in this chest?" | Its contents, and no explanation of how it looked | — | FC-165 |
| 12 | ✅ 18 Sep — third ask by an assembler: "Landfill: 26/min from that one machine… stone-brick at 0/min — stalled". Two findings on the way: drills have no craft counter and it denied they were there (FC-222), and one answer led with the labs hint instead of the measurement (FC-223) | Stand by a row of machines, ask "what rate are they really hitting?" | A measured rate, from craft counts | Not the theoretical one | S28, FC-162 |
| 13 | ⬜ | With a spidertron and a remote: "send the spidertron to the ore patch" | A card; confirm; it walks; press Alt+X | It stops within a tick; the feed says so | S29 |
| 14 | ✅ 18 Sep — on the third try: FC-211 (classifier) and FC-214 (guard) both needed; "arms to feed them" came through as "belt arms" and was read as belts | Describe a build: "I'm going to build a smelting outpost, 20 furnaces, a couple hundred belt, arms and chests" | A packing list appears; Alt+L shows it in game | Counts are rounded up and say so; fuel or poles added with a reason | S30 |
| 15 | ✅ 18 Sep — short of 19/250/20/173, 7 slots of 76, offer in words | Pick some of it up, ask "am I ready?" | Missing / ready / slots | Ticks itself off as items arrive | FC-166 |
| 16 | ⬜ (no bots on this map) | If you have bots: "get the bots to fill it" | A card; confirm; your own requests untouched | A "Second Shift" section appears on your requester point and switches off when done | FC-168 |
| 17 | ✅ 18 Sep — nothing on the player's new map; one line five minutes into the dev save (47 idle labs), quiet and grounded | Tick **Keep an eye on things**, play ten minutes | At most one quiet line in the alerts panel, or nothing | It never speaks and never acts | FC-193 |
| 18 | ✅ 18 Sep — asked which metal, offered a one-row paste as ghosts, no card until asked. (It listed "aluminium" as a possible metal — a single-word name FC-171 can't check; noted, not filed) | Ask "build a line up to my metal" | It says what it can paste and what it can't | No flat refusal | FC-172 |
| 19 | ✅ 18 Sep — two enemy searches ran, flat answer, no invented name | Ask "I see a big red dot on the map up there, that must be monsters" | A search for enemies runs | Not "I don't know what enemy refers to" | FC-194, FC-204 |

**Scripts to run once with the game hosted** (they were migrated to the shared harness without being run): every
`scripts/e2e-*.ts` and `scripts/eval-*.ts` that doesn't say otherwise in its header. A first clean run of each
retires FC-197's caveat. Not yet run as of 18 Sep.

**Session log, 18 Sep:** ten rows closed, fourteen bugs found and fixed while the player talked (FC-206–FC-215,
FC-218), S31 settled on both engines, and two requests filed (FC-216, FC-217).

**Still open after this session, by design:** the planet surface names for Vulcanus, Fulgora and Aquilo (FC-181)
are inferred; closing that is a small mod change, not a check.
