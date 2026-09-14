# S15 — Machine settings

- **Status:** active
- **Goal:** The player can ask the companion to change what machines make ("set those assemblers to gears"), under the same limits as doing it by hand, and pasted blueprints get the same layout sketch as generated ones.
- **Acceptance:** A `set_recipe` action changes the recipe of machines from the last search after an approval card, refusing what the player couldn't do (another force, not visible, locked or hidden recipe, wrong crafting category, fixed-recipe machines, furnaces); ingredients the machine held go to the player's inventory or spill at the machine, never vanish or appear. Helmet tests prove each refusal in-game. Pasted blueprints show a layout sketch with a copy button. All suites pass.
- **Started:** 2026-09-14
- **Finished:** —

## Items

- [x] FC-093 Entity settings actions: set recipe
  - Acceptance: mod `set_recipe` with helmet checks and item handling as above; in-game tests for success and every refusal; `set_recipe` tool acts on the last search result through an approval card with in-game highlight; e2e: find assemblers, ask to change their recipe, confirm, the game shows the new recipe
  - Mod `set_recipe`: refuses unknown, hidden and locked recipes outright, and per machine: gone, not yours, not an assembler (furnaces, silos), fixed recipe, not visible, wrong crafting category, same recipe. Held ingredients go to the player's inventory, and what doesn't fit spills at the machine. `scripts/test-settings.ts` 11/11 in-game: 20 iron plates held by a machine came back to the player (+20), and every refusal was proven (stone-brick wrong category, stack-inserter locked, loader hidden, a stone furnace, a neutral assembler, one 3,000 tiles away in unseen chunks). The server tool `set_recipe` resolves the recipe from the player's words and acts on the last search through a card. `scripts/e2e-settings.ts` 3/3 twice: "Switch the assembling machines around me to copper cable" found 3, showed a card, and after approval the game had copper-cable on all 3 (4.6–5.6 s to the card). System prompt still one block (4,127 tokens). Fixed-recipe machines weren't tested in-game: no such assembler in this save
- [ ] FC-044 Layout sketch for pasted blueprints
  - Acceptance: a pasted blueprint's review also sends the layout sketch card (entities drawn from the save's footprints, copy button with the original string); unit and display tests

## Notes

Planned and activated 2026-09-14 overnight under the player's delegation. Train stop limits and filters (the rest of FC-093's title) stay in the backlog as FC-109. For the player to check: when you change a recipe by hand in remote view, do the machine's ingredients go to your inventory? The action assumes they do (and spills what doesn't fit), like changing it while standing next to the machine.

## Review
