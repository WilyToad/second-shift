# S27 — What you're looking at

- **Status:** active
- **Goal:** The companion knows what the player is pointing at, holding or has open, can say what's inside a container they can see, keeps a request when they correct themselves, stops repeating research status, gets numbers right, and stays fast in long conversations.
- **Started:** 2026-09-15
- **Acceptance:** Each item's acceptance below; the player's voice session from 2026-09-15 replayed as an eval (same questions, with the game in the same state where it matters) gives none of the odd replies found in it; existing suites still pass.

## Items

- [ ] FC-151 What the player is pointing at, holding or has open
  - Notes: player test (2026-09-15, voice): hovering over something and asking "Can you see what I have highlighted, what is this?" got an invented "storage tank 22 tiles north at (16, -24)"; after selecting another thing, "I can't see your cursor highlight directly". Factorio exposes the entity under the cursor (`LuaControl.selected`, and `on_selected_entity_changed`), the item in hand (`cursor_stack`) and the open window (`opened`); an inventory slot merely hovered isn't exposed to mods. With voice, the question arrives ~2 s after speaking, so the mouse may have moved: remember the last hovered entity and when
  - Acceptance: "what is this / what am I pointing at / what's this I'm holding / this building" questions get what's under the cursor now, the last thing hovered (with how long ago), the item in hand and the open window; with nothing there, the answer says so instead of guessing; the hover record is cheap (one event per hover change, benchmarked); helmet: only the companion's player; in-game test with `selected` set by test tooling
- [ ] FC-152 What's inside a container the player can see
  - Notes: "what is in this red chest" got "I can't read chest contents from the data I have". Hovering a chest shows its contents in the game
  - Acceptance: a look action returns the contents of a container (chests, wagons, machines' input and output) the player can see, capped; used for "what's in this/that chest" with the pointed-at entity (FC-151) or the last search; refuses what the player can't see; helmet test
- [ ] FC-153 Numbers in answers: a calculator and follow-up references
  - Notes: "What do I use these for" (storage tanks) answered "25,000 units each… 1,250,000 capacity total" (7 × 25,000 is 175,000, and neither number came from the save): "these" matched nothing, so nothing was retrieved. Player: "Maybe we need to have some type of small calculator or something it can use to do math"
  - Acceptance: follow-ups with "these/them/it/that" retrieve for what the previous turn was about; a way for the model to get arithmetic right is chosen by measurement (a `calculate` tool vs checking arithmetic in the answer in code vs computing the facts up front), with latency recorded; the replayed question gives the right total from save data or says the capacity isn't in the data
- [ ] FC-154 A correction keeps the request
  - Notes: "Where is the rocket silo, can you point it out to me" then "I meant the rocket silo" dropped `show_the_way` as unasked (FC-126's guard): the request was in the previous question
  - Acceptance: short corrections ("I meant…", "no, the…", "actually…", "not that, the…") carry the previous question's request into this turn; unit tests from the session's wording
- [ ] FC-155 Offers phrased differently still count as asked
  - Notes: "Want me to try marking it on your map?" then "Yes please" dropped `map_action`: the pattern knew "mark on the map", not "marking it on your map". The answer then said "no card was confirmed", which isn't what happened
  - Acceptance: map, research, paste and marking patterns cover the forms the model uses in offers (marking, your/my map, pin it, drop a marker…), tested with the session's wording and the offers in the eval logs; the not-asked tool reply is reworded so answers don't invent a card
- [ ] FC-156 Research status only when it matters
  - Notes: 7 of 10 answers in the session ended with "labs are still idle, nothing researching", including "Testing hello". The S22 rule sends research state whenever labs are idle, and the dev save has 47 idle labs all the time
  - Acceptance: research state goes in only for research, science, rate and machine questions; the console's Research panel shows it anyway; unit test; the replayed session doesn't mention labs unless asked
- [ ] FC-157 One position, one direction
  - Notes: the silo was "14 tiles west", then "roughly (-5, 0)" (invented), then "14 tiles north-west at (-4, -5)": two lookups rounded the character position differently and the silo sits on a compass boundary
  - Acceptance: surroundings and find results measure from the same rounded character position; the nearest position of each thing listed goes in the surroundings line so the model doesn't guess coordinates; unit test
- [ ] FC-158 Long conversations lose the prompt cache
  - Notes: in the session, first words took 5–7.6 s (server first token 2.2–5.1 s) against ~1.2–2 s before. Prompts were 5,000–6,100 tokens: past the cached 4,096-token system block but short of the next full 2,048-token block, so 1,000–2,000 tokens of history were read again on every turn
  - Acceptance: measured cause and a fix (compact earlier, align history to blocks, or a smaller tail), with first-token times before and after on a replayed long conversation recorded in PLAN §5
- [ ] FC-159 Highlight boxes outlive what they mark
  - Notes: player (2026-09-15): after approving a deconstruction, "the marks stayed on the screen after the deconstruction for about 30 seconds". The boxes are drawn at fixed positions with a 30–60 s time to live, so they stay after the robots remove the entities
  - Acceptance: highlight boxes are tied to their entities, so a box disappears when its entity is removed (the rendering API destroys objects whose entity target is gone), still expiring on their timer otherwise; in-game test: highlight, destroy the entity, the box is gone

## Notes

Planned from the player's first real voice session (2026-09-15) and activated after they confirmed the rest of S26.
