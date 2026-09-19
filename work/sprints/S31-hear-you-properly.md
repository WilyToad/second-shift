# S31 — Hear you properly

- **Status:** done
- **Started:** 2026-09-17
- **Finished:** 2026-09-17
- **Goal:** What the player says is what the companion reads: they choose the recognition engine, the console picks the alternative that matches their save's words, and a local transcriber is researched before anyone builds one.
- **Acceptance:** The composer offers a clear choice of recognition engine with the tradeoff stated, and remembers it; several alternatives are scored against a vocabulary the server sends, so the save's own words win; a spoken question is marked as spoken in the turn; the FC-176 recommendation is written up in these notes and PLAN, including what to measure before building anything; existing suites still pass.

## Items

- [x] FC-174 Let the player pick the recognition engine
  - Notes: player, 2026-09-17: transcription is spotty ("running wire" heard as "running wine", "I've got 10" as "Got10", "red dots" as "red darts"). `voice.ts` sets `processLocally = true` whenever the on-device model is installed, with no way back to Chrome's online service, which is the more accurate of the two. The tradeoff is the player's to make, and the console already labels where the voice goes
  - Acceptance: a choice in the composer between Chrome's online service and on-device, with the tradeoff said plainly (accuracy versus nothing leaving the Mac); remembered per browser; installing the on-device model counts as choosing it; the "where the voice goes" label matches the actual choice; unit tests
  - Done: on-device is used only when it's ready *and* the player asked for it, remembered per browser, and downloading the model counts as asking. The composer shows the choice ("Chrome's speech service — hears more accurately" / "This device — nothing leaves your Mac") once the model is available, and the "where the voice goes" label follows the choice. **Correction to the diagnosis:** Chrome still reports the on-device model as "downloading" on this machine, so the player's spotty session was *already* using the online service — switching engines can't explain those errors, and this item is about honesty and choice rather than the accuracy fix
- [x] FC-175 Use the alternatives the recognizer already returns
  - Notes: we ask for `maxAlternatives = 1` and take the first guess. Chrome returns an N-best list; the alternative containing this save's own words is usually the right one ("belt" over "bolt", item names over near-homophones). The page has no prototype data, so the server sends a small vocabulary once per connection. Second half: the turn should know the question was spoken, so an odd word reads as a mis-hear rather than a fact
  - Acceptance: several alternatives requested and scored against a vocabulary the server sends on connect, best one used, engine order breaking ties; the vocabulary message is small (a few KB) and costs nothing in the prompt; a spoken question is marked as spoken in the turn; unit tests over the player's own examples and over sentences with no domain words (which must come through unchanged)
  - Done: the console asks for four transcripts instead of one and picks the one carrying the most words from this save, with the engine's own order breaking ties; singular and plural count as the same word. The server sends the vocabulary on connect — every word its prototype names are made of plus what players call things ("wire", "biter", "outpost") — measured at 555 words and 5.5 KB on the dev save, and it never touches the prompt. A spoken question is marked as spoken, and the turn says to read a nonsense word as a mis-hear. Unit tests use the player's own examples ("running wine" → "running wire", "red darts" → "red bottles") and check that a sentence with no save words comes through untouched. **Not yet confirmed against a real voice:** whether Chrome's online service returns useful alternatives for these cases needs the player's next session
- [x] FC-176 Local speech-to-text: spike
  - Notes: the real fix for accuracy may be a Whisper-class model on this machine — as accurate as the online service with nothing leaving the Mac, which is the project's stance. ElevenLabs Scribe is the online alternative once the audio plumbing exists (the key is already held server-side). Researched by a delegated pass, 2026-09-17
  - Acceptance: a written recommendation in the sprint notes and PLAN: the candidates with their accuracy, size, licence and streaming ability; what fits in memory beside oMLX's ~69.5 GB; the added latency for a 3–6 s utterance; how audio gets from the page to a transcriber and what happens to interim text; how each option can be biased toward the save's vocabulary; and a first slice with what to measure before committing — including "keep the browser engine" if the evidence says so
  - Done: recommendation below ("FC-176: what the spike found"), also in PLAN §5. Verdict: **not** "keep the browser engine", but do the cheap Chrome check first — which became FC-177. Memory is a non-issue (128 GiB, the largest candidate ~1.6 GB); latency is the open number and the first slice exists to measure it
- [x] FC-177 Tell the recognizer which words to expect
  - Notes: came straight out of FC-176. Chrome shipped contextual biasing in desktop M140 (`SpeechRecognition.phrases`, `new SpeechRecognitionPhrase(phrase, boost)`, boost 0–10) and the player is on 153, so the vocabulary FC-175 already sends can bias the engine instead of only re-ranking guesses it already made. Cheapest thing on the spike's list by a wide margin
  - Acceptance: the server sends a phrase list of the save's own things, said the way a player says them; the console sets it on each recognition where the browser has the API and is unharmed where it doesn't; unit tests for both
  - Done: `recognitionPhrases()` sends 100 phrases, ranked by how much each thing is actually used — how often it's an ingredient of an enabled recipe or a technology, with a bonus for anything the player places — hyphens spelled out as spaces, on the same `vocabulary` message so it costs nothing extra and never touches the prompt. Measured on the dev save: 100 phrases in 1.8 KB, 7.3 KB for the whole message. **Taking the dump's own order first was wrong:** it spent the list on chests, ducts and "space factory 3 instantiated" and left out stone furnace, iron gear wheel and the science packs; ranking by use puts all of those in and drops the internal variants. `biasRecognition()` sets them with boost 3, feature-detected and wrapped, returning 0 on a browser without the API. **Verified by hand in Chromium 153:** `'phrases' in SpeechRecognition.prototype` is true, assignment takes a plain array (`SpeechRecognitionPhraseList` is undefined), and boost 11 throws `SyntaxError`. **Not verified:** whether the engine actually applies the bias, and whether it does so outside `processLocally` — the on-device explainer hints biasing may be on-device only, and SODA is still stuck "downloading" here. That needs the player's voice. Also sent when the save connects, not only to a page that connects after it — the console usually opens first, so the first arrangement gave a fresh page no phrases and no vocabulary at all. One gap left standing: the phrases are set when a talk session starts, so a vocabulary message arriving mid-session only takes effect at the next Talk

- [x] FC-183 Spoken words vanish when the engine restarts mid-pause
  - Notes: player, 2026-09-17, in Safari: "when I speak and it transcribes, after 2 seconds it just disappears. It doesn't go up into message." The pending text and the send timer were scoped to one recognition run, so when the engine ended that recognition inside the player's pause window, `listen()` started a fresh run and cleared the screen, and the armed send then found its run was no longer current and returned without sending. Safari ends recognition after every utterance, which makes it the common case there; Chrome holds a session open for minutes, so it only bit rarely. Not a regression from this sprint — it came in with FC-149's restart path
  - Acceptance: words heard by a recognition that ends before the pause elapses are carried into the next one and still sent; the screen keeps them rather than clearing; a test that ends a recognition inside the pause window and asserts the sentence went out once
  - Done: the pending text (`carried`) and the send timer belong to the talk session now, and the timer reads whichever recognition is current when it fires. A restart carries the words forward and leaves them on screen. Test drives the Safari sequence — final result, engine end, restart, pause elapses — and asserts one send
- [x] FC-184 A tool call written as text eats the whole question
  - Notes: found in the player's own session log (2026-09-17). Asked "I see a big red dot on the map up there that must be monsters", the model emitted its call in text form — `<tool_call><function=find_entities><parameter=direction>up…` — instead of as a tool call, the server didn't parse it, and that raw block became the stored answer. The question was never answered and the search never ran; the surrounding turns used the JSON form and worked. So this is a parsing gap, not a model failure, and it silently costs a whole turn
  - Acceptance: a call written in the text form is parsed and run like a JSON one, or — if it can't be parsed — the turn retries rather than showing the player markup; the raw block never reaches the answer or the stored transcript; unit tests over this session's exact text and over an answer that merely mentions a tool name in prose
  - Done: `server/src/tool-text.ts` recovers a call from either shape the template produces — the XML form the player's session actually emitted and the JSON-in-tags form — coercing "128" to a number and "true" to a boolean because the tools' schemas expect those, and it only runs when oMLX parsed nothing for us, so a well-behaved round is untouched. The stream filter that already hid stray chart blocks now holds back a `<tool_call>` block too, at every possible token split, so the markup can't reach the page even if parsing fails. Tests use the session's verbatim text; prose that merely names a tool is left alone. **Not covered end to end:** reproducing it needs the model to emit the text form again, so the wiring line in `model.ts` is checked by types and by hand, not by a test
- [x] FC-185 Say which mechanism actually heard it
  - Notes: with FC-175 rescoring, FC-177 biasing and the engine's own guess all in the path, a good transcript can't be attributed — all three look identical afterwards. That made the player's check anecdotal when it could be conclusive, and in Safari it also answers a question I'd been guessing at: how many alternatives that engine even offers
  - Acceptance: one line per spoken question recording the engine's first guess, how many alternatives came back, what was picked, how many phrases were accepted and where the recognition ran; carried with the question for the log and never into the prompt; unit test
  - Done: `heardDetail()` in the console travels with a spoken `ask` and the server logs one line per spoken question. It never reaches the prompt. **First measurement, from the player's Safari session:** see the notes below
- [x] FC-186 The picker promised an accuracy it can't back
  - Notes: FC-174's picker said "Chrome's speech service — hears more accurately". The player's own Safari session contradicts it: Safari got "I've got 10 red bottles to research automation" exactly right and "up there" right, both of which Chrome's online service mangled, and matched it on the near-homophone. Several strings also named Chrome specifically, and the same console runs in Safari
  - Acceptance: the picker says where the audio goes rather than which engine is better; browser-specific wording only where the state really is browser-specific (the SODA download note); existing assertions updated deliberately rather than loosened
  - Done: the option now reads "Your browser's speech service — the audio leaves your Mac", the network error names Brave as the browser that can't reach the service instead of prescribing Chrome, and the push-to-talk permission message is browser-neutral. The comment in `voice.ts` records why the accuracy claim went, and that one voice in one session isn't a measurement either

- [x] FC-173 Hands-free cuts sentences off
  - Notes: three of 24 spoken turns were sent mid-thought on the 2 s pause: "Keep running out of fuel up here what's the best way to get my", "I just spent how does this look", "Got10 red bottles to research automation". The answers coped, but the player had to re-explain twice. Pulled into S31 (2026-09-17) while the player plays, since it's the one that bites again every session
  - Acceptance: when the heard text ends on a word that can't end a sentence (a preposition, conjunction, article or possessive), the console waits another pause before sending, with a cap so it can't hold forever; the picker's default stays as it is and the behaviour is off for typed questions; unit tests over these three sentences and over normal endings that must not be delayed
  - Done: a dangling ending buys up to two extra pauses (6 s at the default) and then sends anyway. The word list is deliberately narrow — articles, possessives, conjunctions and the prepositions that always take an object — and demonstratives and pronouns are left out, because "what is this", "look at this" and "can you see it" are finished questions and delaying those would make every normal turn feel slow. Typed questions never touch this path. **Honest about the three examples:** only the first is a dangling ending. "I just spent how does this look" ends on a perfectly good word — it was two fragments joined, not a cut — and "Got10" was the engine's numeral formatting, now known to be Chrome's (Safari writes it correctly). So this fixes one of the three and the tests say which

- [x] FC-190 Read aloud recites the working
  - Notes: player, 2026-09-17, on the answer to "how many biochambers would I need for 60 bioflux per minute?" — "the read answers aloud audio response is quite intense! It definitely doesn't sound great with it rattling off the chart and stuff verbally. I'm wondering if for charts or very technical jargon we should have some type of 'check out my chart for more details' audio cue instead?" `speakable()` already dropped chart blocks, but the numbers in the *prose* ("each makes 7.5 bioflux/min from 15 jelly + 15 mash, so 8 × 7.5 = 60/min") were read out in full. Their choice of four options: speak the headline, then a pointer
  - Acceptance: the sentence that answers is always spoken, numbers and all; the working — tables, bullets of figures, arithmetic chains, chart blocks, any sentence with more than one number — is left on screen; one short pointer at the end, naming the chart when there was one; an ordinary answer is read exactly as before with nothing added; the written answer is untouched and no model round is involved; unit tests over the player's own case
  - Done: the filter lives in `SentenceQueue`, so it works while the answer is still streaming: the first thing an answer says is always spoken (it's what they asked for), and the working is skipped as it goes by. If anything was skipped the voice ends with "The chart's in the app." or "The numbers are in the app.". Costs nothing in the prompt — it's all in the console. The player's bioflux answer now reads as "You'd need 8 biochambers." plus the pointer, with the 120/min lines and the chart block silent

## Notes

### FC-176: what the spike found

**Two facts reframed the item.** The player's spotty session was already on Chrome's *online* service (the
on-device model never finished downloading), so switching engines can't be the fix. And only one of the three
misses is acoustic: `wire → wine` is a near-homophone, but `"I've got 10" → "Got10"` is a dropped word plus a
glued numeral and `"red dots up there" → "red darts of there"` is a function-word substitution. Those are
weak-language-prior and no-inverse-text-normalization failures — which says to shop for a strong text prior,
not just a low word error rate.

**Candidates.** whisper.cpp `whisper-server` with large-v3-turbo (MIT, ~0.6–1.6 GB, clip-based, `prompt`
biasing); mlx-whisper (same family, `initial_prompt`, more anti-hallucination knobs); parakeet-mlx with
`parakeet-tdt-0.6b-v3` (best local WER at 6.34% on the Open ASR Leaderboard versus ~7.4% for Whisper
large-v3, and genuinely streaming — but hotword biasing is listed as *Todo*, so it has none); ElevenLabs
Scribe v2 (keyterm prompting, vendor-claimed ≤5% WER, but the voice leaves the Mac). **Biasability is the
discriminator, and it beats raw WER here**, because the player's misses are domain words.

**Memory is not a constraint.** 128 GiB physical, oMLX resident at ~69.5 GB, largest candidate ~1.6 GB.
Keep the model loaded; the cost that matters is load time, not footprint.

**Latency is the open number.** Verifiable from Whisper's own source: `N_SAMPLES = 480000` and `pad_or_trim`
mean a 4 s clip still pays a full 30 s encoder window, so for 3–6 s utterances almost everything is fixed
cost. Estimates only: 0.3–1.0 s for turbo-class on this machine, 0.1–0.3 s for Parakeet, against today's
~1.5 s to first words. No trustworthy short-clip measurement on M5-class silicon exists; producing one is
the point of the first slice.

**Shape if we build it.** Capture 16 kHz mono WAV in the page through an `AudioWorklet` (`MediaRecorder`
only gives Opus), post it to a `/stt` route mirroring `/tts`, proxy to a resident `whisper-server` with the
vocabulary as `prompt` and `--vad` on. ffmpeg stays off the hot path. Interim text is the one real loss:
keep Chrome driving the live `heard` display and let the local transcriber produce the authoritative text.

**Recommendation: the cheap Chrome check first, and it is not "keep the browser engine".** Step 0 is
FC-177 (done this sprint): bias the recognizer with the vocabulary we already ship. If that fixes the
acoustic misses, a local transcriber may not be worth its latency — but it cannot fix `"Got10"`, which needs
a model that normalizes numerals. Step 1, if we go on: capture the player's audio alongside the chosen
transcript into `data/captures/` **first** (local-only; it's their voice), then `brew install whisper.cpp`
(the player's install decision, ~0.6–1.6 GB) and the `/stt` route. Measure accuracy against what they
actually said versus Chrome on the same audio, added delay p50/p95, resident memory beside oMLX with TTFT
unchanged, and hallucination rate on short and near-silent clips. **Stop and keep the browser engine if**
it invents text (Whisper's documented failure mode on short noisy audio, and worse than a mis-hear because
it doesn't look wrong), delay exceeds ~1 s p95, FC-177 already fixes the acoustic misses, or the captured
set shows no clear win. Scribe is the fallback once `/stt` exists, behind the same opt-in as the ElevenLabs
voices.

**One consequence to decide after the player's next session:** if biasing works, re-ranking four
already-wrong guesses (FC-175) is dead code and should be removed rather than left beside it. Keeping both
until there's evidence, since neither has been heard by a real voice yet — but the evidence against rescoring
is now concrete rather than hypothetical, and it's pinned in a test: **this save's words are ordinary English
words too**, so "I built ten of them" is rescored to "I belt ten of them" and "a bit further" to "a belt
further" ("belt", "rail", "tank", "lab" and "wall" are all in the 555). Biasing the engine makes such
alternatives *more* likely to be offered, so the two mechanisms don't simply add up. There's no cheap
principled fix — no dictionary on the page to say "built" is a word and "belt" is the odd one — which is why
the choice is "biasing instead of rescoring", not "both".

Opened at the player's request (2026-09-17) after an early-game session where three of 24 spoken turns came through wrong: "I'm running wire" → "running wine", "I've got 10 red bottles" → "Got10 red bottles", "a big red dots on the map up there" → "a big red darts on the map of there". FC-176 was delegated as a research pass; FC-173 (hands-free cutting sentences off) sits next to these in the backlog and wasn't pulled in.

## Review

Ten items, all shipped: the engine choice (FC-174), N-best rescoring against the save's words (FC-175), the local
speech-to-text spike (FC-176), contextual biasing from the save's own phrases (FC-177), and then six things the
player's real session exposed — vanishing words (FC-183), a tool call written as text eating a whole question
(FC-184), no way to attribute a good transcript (FC-185), a picker promising accuracy it couldn't back (FC-186),
hands-free cutting sentences off (FC-173), and read-aloud reciting the working (FC-190).

**Measured:** vocabulary 555 words / 5.5 KB and 100 phrases / 1.8 KB, sent on connect *and* when the save arrives,
none of it in the prompt; `eval-grounding` 10/10 with first token median 1.13 s after the turn-guidance changes;
211 unit tests.

**What the player's own voice showed, which changed two of our beliefs.** Their Safari session got four of five
test sentences right, including the two Chrome's online service had mangled ("I've got 10", "up there"). So the
accuracy claim in FC-174's picker was wrong and is gone (FC-186), and the premise behind FC-176 — that the online
service is the better engine — doesn't survive contact either. The one remaining miss is the near-homophone class
("wire" heard as "where"), which is exactly what biasing targets.

**Resolved 2026-09-18** — see PLAN §5 "S31's experiment, run": biasing is on-device only (the service refuses the
list), rescoring never changed an answer for the better on either engine and is removed (FC-210), and boost 8 on the
name made the on-device engine hallucinate it; the whole list runs at 1 now (FC-209).

**Acceptance was partly pending, and deliberately not claimed at the time.** Three things need the player's voice in Chrome:
whether the engine applies `SpeechRecognition.phrases` at all, whether it does so outside `processLocally` (SODA is
still stuck "downloading" here), and whether FC-175's rescoring helps or hurts. That last one has evidence *against*
it now, pinned in a test: this save's words are ordinary English words, so "I built ten of them" is rescored to "I
belt ten of them". If biasing works, rescoring comes out rather than sitting beside it.

**Moved on:** FC-187 (a follow-up question drifting onto the wrong subject) and FC-188/FC-189 (keep the audio, then
measure three transcribers) are in the backlog. FC-189 only earns its keep once the Chrome session says whether
biasing already fixed the acoustic misses.
