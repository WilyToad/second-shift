# FC-266 — How voice apps keep their own output out of the microphone

**Question (player, 2026-10-03):** the recognizer heard Ballast's own words through a headset, and again through the
laptop mic with headphones ("Walled off the" after "Wall's off the list"; "Loud and clear" after "Loud and clear").
"Surely every other multiplayer game out there handles mic echo somehow?… I feel like we are running around patching
workarounds."

## What we have, measured

The kept clip of "Walled off the" (`data/captures/voice/20261003-082436-f8sh.wav`, our raw tap) transcribes as "Balls
off the list" — the mic physically picked him up, faintly (RMS ~50 of 32,768). The recognizer that turned it into a
question was Chrome's own, on-device (`"where": "on-device"` in the clip's record). Two things in our code let it through:

- `SpeechRecognition.start()` is called with no track, so Chrome opens the microphone its own way.
- Our capture tap (`displays/src/capture.ts`, used for local Whisper and kept clips) opens it with
  `echoCancellation: false` — set in FC-188 to keep the player's raw voice as evidence for FC-189.

And FC-242 replaced an echo *text* filter (drop what sounds like what he just said) with "headset required" — which the
two captures above disprove.

## The standard method

Everyone who plays audio and listens at the same time — voice chat, games, video calls, smart speakers, voice agents —
uses **acoustic echo cancellation (AEC)**: the canceller is given the exact signal being sent to the speaker (the
*reference*), predicts how it comes back into the microphone, and subtracts it, leaving only the person's voice.
Smart speakers run it in front of the wake word and barge-in detection; Discord, games and calls run WebRTC's or the
OS's. Text filters, echo windows and half-duplex muting are the fallbacks when there's no reference, and each costs real
speech or barge-in. Headsets reduce echo but don't remove it — which is what we saw.

The one requirement is the reference: **the canceller can only remove audio it can see being played.**

- **In the browser**, `getUserMedia({ audio: { echoCancellation: true } })` runs WebRTC's AEC (Chrome moved it to the
  capture layer in M37, and to the audio service as "Chrome-wide echo cancellation"), with Chrome's own playback as the
  reference. Audio played through an `<audio>` element or a WebRTC track counts; audio Chrome can't see — the OS speech
  synthesizer, another app, a custom path outside Chrome's output — doesn't.
- A team whose AI avatar "kept replying to its own voice" wrote 1,657 lines of exactly our kind of band-aid — echo
  windows, ≥75% text overlap, duplicate discards, a hold-type barge-in that added 2 s — then deleted them all when they
  routed playback through a path Chrome's AEC could reference: "99 seconds of continuous avatar speech produced zero
  false user turn detections", barge-in in milliseconds.
- **Natively on macOS**, the equivalent is `VoiceProcessingIO` (`setVoiceProcessingEnabled(true)`), which also needs
  capture and playback on the same engine to have its reference.
- **`SpeechRecognition.start(audioTrack)`** takes a `MediaStreamTrack` since **Chrome 135** (April 2025); the console
  runs on a Chromium new enough to have recognition `phrases` (153), so it has it.

## What it means for us

Our playback is already on the right path: ElevenLabs and Kokoro play through an `<audio>` element (FC-260's
MediaSource stream included), so Chrome's AEC can see them. The **browser's own voice** (`speechSynthesis`) is spoken
by macOS, not by Chrome's audio output, so AEC can't cancel it — a headset stays the advice for that voice only.

**Recommended design (replaces the workarounds):**

1. **One microphone stream for everything**, opened once with `echoCancellation: true` (Chrome's defaults otherwise).
2. **The browser recognizer gets that track**: `recognition.start(track)`; if the browser throws, `start()` as today.
3. **Local Whisper and kept clips use the same stream** — the transcriber hears what the recognizer hears. Kept clips
   become post-AEC; FC-189's raw comparisons are done, and a raw clip is still one setting away if ever needed.
4. **No text filter, no echo window, no muting while he talks.** Barge-in stays "any voice over him is the player"
   (FC-242's rule), now true because his voice is removed from the signal.
5. **Headset: recommended, not required**; required only with the browser's own voice.

**Verify on the player's setup:** a self-test in the console — play a known ElevenLabs/Kokoro clip while recognizing
from the stream, AEC off then on, and show what was heard and the residual level; then the real thing, a long answer
read with Talk over him on, on the headset mic and on the laptop mic: false cut-ins 0, and a real "stop" still cuts in
within a second. If on-device recognition turns out not to accept a track, that's the first thing the self-test shows.

## Sources

- [Acoustic echo cancellation: how it really works (Fora Soft)](https://www.forasoft.com/learn/audio-for-video/articles-audio/acoustic-echo-cancellation-aec3)
- [Voice AI echo cancellation: causes, fixes, and best practices (Coval)](https://www.coval.ai/blog/voice-ai-echo-cancellation/)
- [When an AI avatar keeps replying to its own voice — 1,657 lines of band-aids, then throwing them all away](https://dev.to/orca_forge/when-an-ai-avatar-keeps-replying-to-its-own-voice-writing-1657-lines-of-band-aids-then-throwing-2m71)
- [AEC barge-in (VOCAL)](https://vocal.com/echo-cancellation/aec-barge-in/)
- [Heads up, audio processing has been moved to getUserMedia (discuss-webrtc)](https://groups.google.com/g/discuss-webrtc/c/m6Rory-FjAg)
- [Chrome-wide echo cancellation changes (feature-media-reviews)](https://groups.google.com/a/chromium.org/g/feature-media-reviews/c/4zL3X_JYH3Y)
- [MDN: SpeechRecognition.start()](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start)
- [Intent to Ship: Add MediaStreamTrack support to the Web Speech API](https://groups.google.com/a/chromium.org/g/blink-dev/c/4ibjEVQ-i0s/m/2OsaIhf3BAAJ) and [Chrome 135 release notes](https://developer.chrome.com/release-notes/135)
- [Apple: using VoiceProcessingIO for echo cancellation on macOS](https://developer.apple.com/forums/thread/66953)
