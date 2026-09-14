# S15 — Machine settings

- **Status:** done
- **Goal:** The player can ask the companion to change what machines make ("set those assemblers to gears"), under the same limits as doing it by hand, and pasted blueprints get the same layout sketch as generated ones.
- **Acceptance:** A `set_recipe` action changes the recipe of machines from the last search after an approval card, refusing what the player couldn't do (another force, not visible, locked or hidden recipe, wrong crafting category, fixed-recipe machines, furnaces); ingredients the machine held go to the player's inventory or spill at the machine, never vanish or appear. Helmet tests prove each refusal in-game. Pasted blueprints show a layout sketch with a copy button. All suites pass.
- **Started:** 2026-09-14
- **Finished:** 2026-09-14

## Items

- [x] FC-093 Entity settings actions: set recipe
  - Acceptance: mod `set_recipe` with helmet checks and item handling as above; in-game tests for success and every refusal; `set_recipe` tool acts on the last search result through an approval card with in-game highlight; e2e: find assemblers, ask to change their recipe, confirm, the game shows the new recipe
  - Mod `set_recipe`: refuses unknown, hidden and locked recipes outright, and per machine: gone, not yours, not an assembler (furnaces, silos), fixed recipe, not visible, wrong crafting category, same recipe. Held ingredients go to the player's inventory, and what doesn't fit spills at the machine. `scripts/test-settings.ts` 11/11 in-game: 20 iron plates held by a machine came back to the player (+20), and every refusal was proven (stone-brick wrong category, stack-inserter locked, loader hidden, a stone furnace, a neutral assembler, one 3,000 tiles away in unseen chunks). The server tool `set_recipe` resolves the recipe from the player's words and acts on the last search through a card. `scripts/e2e-settings.ts` 3/3 twice: "Switch the assembling machines around me to copper cable" found 3, showed a card, and after approval the game had copper-cable on all 3 (4.6–5.6 s to the card). System prompt still one block (4,127 tokens). Fixed-recipe machines weren't tested in-game: no such assembler in this save
- [x] FC-044 Layout sketch for pasted blueprints
  - Acceptance: a pasted blueprint's review also sends the layout sketch card (entities drawn from the save's footprints, copy button with the original string); unit and display tests
  - Pasted blueprints now get the same card as generated ones, with the player's original string (books included) to copy back. Big blueprints draw their first 4,000 entities, and tiles shrink to 2 px so the sketch stays about a panel wide. Agent unit test, display test for the scaling, and `e2e-blueprint` gained a check that the card arrives with every entity drawn (9/9 twice). With several blueprints pasted in one message, the page shows the last one's sketch

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Train stop limits and filters (the rest of FC-093's title) stay in the backlog as FC-109. For the player to check: when you change a recipe by hand in remote view, do the machine's ingredients go to your inventory? The action assumes they do (and spills what doesn't fit), like changing it while standing next to the machine. **Checked 2026-09-14 (S20, FC-116):** they don't; from map view they go to the machine's trash slots. The action now sends leftovers to the inventory only when in reach, and otherwise spills them for robots.

## Review

The companion can change what machines make, under the helmet rule, and every blueprint in chat now comes with a sketch. Closed overnight on the player's delegation.

**Acceptance:**
- ✓ `set_recipe` with every refusal proven in-game (`test-settings` 11/11); held ingredients returned to the player (+20 iron plates).
- ✓ Through the server: search, card, approval, new recipe in the game (`e2e-settings` 3/3, three runs).
- ✓ Pasted blueprints show the sketch card with the original string (`e2e-blueprint` 9/9 twice, unit and display tests).
- ✓ All suites pass on a server running this code, with occasional model misses that passed on rerun: grounding 10/10 twice after one 9/10 (it answered "how do I craft a quantum widget?" with "Ready when you are — what should I look for?"), ratios 8/8 twice after one 7/8 (left out the foundry count), throughput 8/8 twice after one 7/8 (wrote a chart block despite "no chart"), blueprints 9/9 twice after one 8/9 (the "no invented problems" check). Rails 6/6, charts 2/2, blueprint requests 6/6, console 4/4, planning 7/7, diagnosis 4/4, helmet 13/13, machines 7/7, planning helmet 13/13. Tracked as FC-110.
- Not tested: an assembler with a fixed recipe (none in this save), and spilling when the player's inventory is full.

**What we learned:**
- A new tool costs little in the prompt (4,127 tokens, still one cache block), but each full regression run now shows about one model miss somewhere. Rules the code can enforce (no chart on a pasted blueprint) should be enforced in code, not just asked for.

