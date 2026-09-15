# S26 — Talk to it

- **Status:** active
- **Goal:** The player can ask by voice and hear answers in the console, and start talking without leaving the game.
- **Acceptance:** In Chrome, speaking a question into the console sends it and the answer is read aloud as it streams; the console says whether recognition is on-device or goes to the browser's speech service; a hotkey in the game starts listening in the console (or, if the browser refuses without focus, the limit is measured and recorded with the fallback the player sees); display and unit tests; the player tries it in Chrome.
- **Started:** 2026-09-15

## Items

- [ ] FC-062 Voice in the console: ask by speaking, hear the answer
  - Notes (player, 2026-09-15): do this first, using the browser's own voice features since the console runs in Chrome or Safari: `SpeechRecognition` (webkit-prefixed) for push-to-talk questions and `speechSynthesis` to read answers aloud. Check before building: whether each browser recognizes speech on the device or sends audio to a cloud service (the README and site promise nothing leaves the machine, so a cloud path must be off, opt-in or clearly labelled), which voices are local, and how charts, code and cards are skipped when reading aloud
  - Decision (player, 2026-09-15): use the Web Speech API as in Chrome's demo (https://www.google.com/intl/en/chrome/demos/speech.html, spec https://webaudio.github.io/web-speech-api/). Not working in Brave is fine
  - Acceptance: a mic button (and a keyboard shortcut) in the composer listens, shows the words as they're recognized, and sends the question when speech ends; errors say what to do (blocked microphone, no speech, speech service unreachable as in Brave, no microphone); recognition runs on the device when the browser offers it (`processLocally` via `available()`), otherwise the console says the voice goes to the browser's speech service; "Read answers aloud" speaks each answer sentence by sentence as it streams, with a local voice when there is one, skipping chart blocks and markdown, and stops when the player talks or asks again; settings remembered per browser; the mic hides where the API doesn't exist; display tests with fake recognition and synthesis; checked by the player in Chrome
- [ ] FC-147 Push to talk from the game
  - Notes: the console sits on the second monitor while the game has focus. A mod hotkey (custom input, e.g. V) can reach the console through the server as an event; whether Chrome lets a page without focus start `SpeechRecognition` is the open question
  - Acceptance: pressing the hotkey in-game starts listening in the console within ~0.5 s and the answer is read aloud; the hotkey is a player setting under Controls; if Chrome won't start recognition without focus, that's measured and recorded, and the console shows a clear prompt instead; mod benchmark unchanged (one event per key press)

## Notes

Activated on the player's request ("Go ahead", after reordering the phases so voice comes first). The console promise "nothing leaves your machine" needs care: Chrome's recognition may use Google's speech service unless it runs on the device, so the console labels which one is in use, and the README and site copy get updated to match.
