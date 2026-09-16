# S30 — Lists the agent keeps

- **Status:** planned
- **Goal:** The companion keeps lists for the player — the first and best one being a packing list for a build run — shown in the console and on a read-only panel in the game, so nobody gets to the outpost and finds they forgot the belts.
- **Acceptance:** "I'm building a smelting outpost: 20 ovens, a couple hundred belt, arms to feed them, chests for storage" becomes a list with real numbers and the things the save's data says it also needs (fuel or poles); the list survives a reload and a server restart, per map; the in-game panel shows it with a key and can't be clicked; "am I ready?" answers have / need / missing with what fits in the player's free slots and what's craftable now, and the list ticks itself off as the items arrive in the inventory; the list tool's cost to the cached prompt is measured before and after; the model never edits a list the player didn't ask about; mod per-tick cost unchanged; existing suites still pass.

## Items

- [ ] FC-163 Lists the agent keeps
  - Notes: the primitive everything else sits on (player's idea, 2026-09-15): several named lists, one active, fully managed by the agent — the player asks for changes rather than clicking. Item = text, done or not, with an optional note. Held per map with the conversation, so it survives a reload and a server restart. Capped (a handful of lists, ~25 items each) because it rides in the turn's tail
  - Acceptance: one model tool taking several edits at once (create, rename, add, remove, tick, untick, clear, make active), with the first-token cost measured before and after (PLAN §6 latency report) and recorded; the active list goes in the turn's tail, never the cached prompt; guarded like other actions so the model only edits when the player asked (no quiet deletions); unit tests plus an eval that unrelated questions leave lists alone; lists come back after a server restart and on the right map
- [ ] FC-164 The list on a panel in the game
  - Notes: read-only by the player's choice: they show or hide it, the agent owns the contents. One frame, one line per item, redrawn only when the list changes, toggled with a key (Alt+L). Factorio's labels have no strike-through, so done items are dimmed with a tick instead. Interactive buttons stay out of scope — that's FC-060 if the panel earns it
  - Acceptance: the server pushes the active list to the game; the panel shows every item with done ones dimmed and a done count, hides itself when there's no list, and has nothing clickable; the toggle key works and the panel survives save and load; in-game test reading the GUI back; benchmark shows no per-tick cost
- [ ] FC-165 What you have, and where
  - Notes: the packing list needs to know what the player already has: their inventory plus the containers they can see, summed by item, with the nearest container for each and how many free slots they have. On demand, capped, and measured — a container sweep is the expensive shape (`surroundings` is ~2 ms, a surface-wide type sweep was 4 ms)
  - Acceptance: a `stock` look returns per-item totals across the player's inventory and visible containers with the nearest position for each, plus free slots; matches a one-off count from the game; refuses what the player can't see; cost measured and recorded; answers "where are my 200 steel?" through the server
- [ ] FC-166 A packing list you build by talking
  - Notes: the player's own words: "20 ovens, a couple hundred belt, arms to feed the ovens, chests for storage". Vague amounts get a number with a generous round-up, and the assumption is said out loud ("48 inserters: 2 an oven, rounded up"). A packing list carries a rule, so it ticks itself off against the player's stock; plain lists don't
  - Acceptance: the example conversation produces a list with counts, changeable by talking ("make it 30 ovens", "drop the chests"); items tick themselves off as the player picks things up, and the change is said once, not repeated; "am I ready?" gives have / need / missing, the slots it needs against free slots, and what's craftable now; e2e through the server on the dev save
- [ ] FC-167 What the save says you also need
  - Notes: the forgetting is the real pain, so the list adds what the prototypes prove is needed and nothing else (FC-160's lesson): a burner oven needs fuel, an electric one needs poles and a power source, inserters need power unless they're burners. No "you'll also want" kit until the player has used it and says what they actually forgot
  - Acceptance: from the save's own data only, each addition names its reason ("stone-furnace burns fuel: coal"); a modded save's furnaces and inserters are read from prototypes, not assumed; unit tests over vanilla and modded cases; nothing added that the data doesn't support

## Notes

Planned with the player (2026-09-15) from their idea: inventory management is the biggest pain, and half of it is a to-do list the agent keeps. Decisions they made: several named lists with one shown in the game; automatic ticking only for lists that carry a rule; one model tool for editing, with its prompt cost measured; the panel shows the whole list with done items marked; the list is agent-managed and read-only to the player, who shows or hides it.

Phase 2, after logistic bots, stays in the backlog: personal logistic requests and chest settings set behind a card, so the bots fetch the list instead of the player (FC-168, FC-169).
