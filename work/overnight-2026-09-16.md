# Overnight 2026-09-16 — S30

The player asked for autonomous progress overnight ("Get as much done as you can… I'm headed to bed"), with FC-168
pulled into S30. Rules as always: follow CLAUDE.md and PLAN.md, never push, only the dev save copy, benchmark every
mod change, `bun run check` before every commit, and leave anything that needs the player's own hands marked as pending
rather than claimed done.

Order: FC-163 (lists) → FC-165 (stock) → FC-167 (what the save says you need) → FC-166 (packing list) → FC-164
(in-game panel) → FC-168 (bots fill the list).

## Log

### FC-163 lists the agent keeps — done

- `server/src/lists.ts`: up to 5 named lists × 25 short items, one active, saved with the map's conversation.
  One `update_list` tool per turn can start a list, add, tick off, put back, remove, rename or clear, and it
  matches the player's wording ("the belts" → "200 transport belt"; "packing" → "packing list").
- The active list goes in the turn's tail; the ask guard (FC-126) drops edits on turns that aren't about lists.
- Console: a read-only panel above the alerts, done items struck through, other lists named underneath.
- Measured: system prompt 3,876 tokens (same cached block), eval-grounding 10/10 with first token median
  **1.29 s** vs 1.55 s before the tool. No prompt cost.
- Tests: 10 unit + 1 agent test; full check 177 tests.

### FC-165 what you have, and where — done

- Mod `stock` look: inventory + containers the player can see (area-limited, 60 cap, out-of-sight skipped), nearest
  container per item, free slots. **0.58 ms** for 22 containers, counts matching the game.
- Server: stock questions ("where are my 200 steel", "how many belts do I have around here") pull it into the turn,
  narrowed to the items the question mentions.
- Through the server: "224 iron plates in reach — none carried, all in a storage chest 16 tiles east at (25, 4)."
- Fixed: the first answer explained the container scan; the turn now says to answer from the line and not describe
  how it looked.

### FC-167 what the save says you also need — done

- `server/src/packing.ts`: fuel for burners (the fuel the player has most of, else the most energetic *gathered*
  one — a first pass picked the least energetic and suggested wood), poles plus a power-source reminder for
  electric machines (a first pass picked the *smallest* supply area and suggested a big electric pole, which
  reaches far but powers almost nothing). Each addition carries its reason as the item's note.
- Covered by kind, not by name, so a later pass can't add a second pole or a second fuel.

### FC-166 a packing list you build by talking — done

- The rule runs the moment the list changes, not a turn later: the first answer used to miss both the additions
  and the ticking.
- Ticks items off against stock with notes ("have 24 (0 carried)", "0 of 200 in reach"); `set` added to the tool
  after the model wrote the *difference* as a second line ("20 stone furnace" plus "10 stone furnace").
- "Am I ready?" gives what's missing, what's craftable now, and the load's slots against free slots.
- `reset` now clears lists: a stale list outlived its conversation and confused both answers and the eval.
- `scripts/e2e-packing.ts` 5/5. Turn guidance added twice along the way: list every item the player named (an
  early run dropped the belts and chests), and say whether the load fits.
- For the player to look at: on this save the fuel pick is *carbon* (2,000+ in reach beats coal), and "ovens"
  resolved to stone furnaces in one run and electric furnaces in another. Both are defensible from the data, but
  worth a glance.

### FC-164 the list on a panel in the game — done

- `scripts/panel.lua`: `gui.left` frame, done count, tick + grey for done items, notes in brackets, 25-line cap
  with "+N more", nothing clickable. Alt+L toggles; an empty list draws nothing.
- Benchmark after the module: 0.031 ms/tick whole-tick, script 0.065 vs 0.015 without the mod — unchanged.
- In-game 7/7 (the test reads the GUI back and counts clickable elements); verified live from a conversation.

### FC-168 packing lists filled by your own bots — done

- `scripts/logistics.lua`: `logistic_network` (in range, robots free, kinds, trash-unrequested) and `set_requests`
  writing only the companion's own "Second Shift" section; `clear_requests` switches it off or removes it.
- In-game 9/9: the player's own "player test" section came back with its slot untouched, a second list replaced
  our slots instead of piling up, and trash-unrequested was read but never written.
- Through the server: card reads "Ask the bots for 30 stone-furnace, 200 transport-belt, 12 burner-inserter?", and
  the answer is honest about 0 of 383 robots being free on this base.
- A finished list switches the section off by itself; clearing the list removes it.

### Fixes found by running it

- The packing rule ran a turn late; it now runs the moment the list changes.
- `set` added to the list tool after the model wrote a count change as a second line.
- Items sharing one word were treated as the same item ("50 iron gear wheel" overwrote "5 iron chest"); matching
  is now exact, then unambiguous subset, then a single unambiguous shared word.
- `reset` clears lists: a stale list outlived its conversation and confused both answers and the eval.

### Regressions after all of it

- 188 unit tests; in-game player 30/30, panel 7/7, requests 9/9; server-side packing 5/5, measure 3/3,
  pointing 9/9, voice replay 8/8, grounding 10/10 (first token median 1.32 s).

### Wrap-up (02:50)

S30 is 6/6 with its review written. Game and server closed; the dev-save conversation from before the night was
restored (the e2e runs reset it, so it was backed up first — the packing lists made while testing went with it).

Not touched, on purpose: README and the website. Every feature this sprint is player-facing, so they probably want
a docs pass, but the last one was done on their explicit word and the site only deploys when they ask.

Nothing is blocked. The backlog's remaining items (FC-050 character control, FC-146 car and tank driving, FC-060 an
in-game panel you can click) are all in the Future section by the player's decision, so nothing was started there.

Commits tonight, oldest first: S30 setup · FC-163 · FC-165 · FC-166/FC-167 · FC-164/FC-168. Nothing pushed.
### Docs pass (07:40, at the player's word)

- README: packing-list section, "what you're pointing at" section, in-game keys table, first questions, two
  troubleshooting rows, and two captures (console panel, in-game panel).
- Website: packing-list feature with the in-game capture, a "What is this?" block, four new "also" cards, a nav
  link, stats updated (0.05 ms script time, ~1.5 s to first words). Built into `website/dist`, **not deployed**.
- Three code fixes found while capturing the screenshots:
  1. A build description now becomes a *packing* list even when the model omits the kind (it did, and the list
     then never ticked itself off).
  2. The ask guard lets "I'm building an outpost, I need…" edit the list without the word "list" in it.
  3. The server sends the lists on connect: a reloaded console showed no panel until the next change.

