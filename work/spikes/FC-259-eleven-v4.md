# FC-259 — Eleven v4 and audio tags for Ballast's voice

**Question (player, 2026-09-29):** Eleven v4 is out and takes audio tags. "I'd LOVE to be able to weave in cues…
I think that would lean me away from Kokoro. But I'd like to hear it before judging."

## What v4 is (docs, 2026-09-29)

`eleven_v4` (top quality, 10,000 characters a request) and `eleven_v4_turbo` (~100 ms model latency, realtime), both
90+ languages. Audio tags in square brackets — the v4 prompting guide lists `[sighs]`, `[sarcastic]`, `[curious]`,
`[chuckles]`, `[whispers]`, `[muttering]`, `[clears throat]`, `[short pause]`, `[long pause]`, `[exhales sharply]`,
among others — placed just before or after the words they colour, and "not perfect yet". Only Stability and Similarity
remain; Style, Speed and SSML are gone.

## Measured

The player's key is limited to speech (no `user_read`, no `models_read`), so the account's character count and the
model list couldn't be read; cost comes from each response's `character-cost` header.

- **Our route works unchanged.** Both models answer `POST /v1/text-to-speech/{voice}/stream` (what `server/src/tts.ts`
  sends) with MP3; neither rejects `previous_text` (whether it's honoured wasn't tested).
- **Tags are performed, not read.** Transcribed locally with whisper large-v3-turbo, no tagged clip says "sighs" or
  "whispers"; the tagged clips run longer where the sigh and pauses went (the labs line: 5.1 s plain, 7.0 s tagged).

**Request → audio**, 12 real answer sentences (FC-253's set), one pass each, connection warm, voice Adam
(the ElevenLabs voice in FC-253's blind test). Kokoro `am_michael` on the local sidecar in the same run.

| | first byte p50 / p95 | whole clip p50 / p95 | `character-cost` for 1,219 chars |
|---|---|---|---|
| Flash v2.5 (today's default) | 214 / 231 ms | 380 / 597 ms | 269 |
| **v4 Turbo** | 291 / 593 ms | **1,528 / 2,336 ms** | 73 |
| v4 | 964 / 1,309 ms | 2,538 / 5,534 ms | 149 |
| Kokoro (local) | — | 206 / 352 ms | free |

v4 Turbo's first audio arrives almost as fast as Flash's, but the whole clip takes ~1.5 s because it's generated
at about real-time pace. `ElevenPlayer` waits for the whole clip before playing, so today a v4 Turbo answer would
start ~1.5 s after the text; playing the stream as it arrives would bring that to ~0.3 s. The `character-cost`
numbers don't line up with character counts (v4 Turbo reports less than Flash), so they're recorded as-is and the
real price is for the player's billing page.

A first timing pass (two runs of each model) was lost when the script crashed on the Kokoro sidecar not running,
after the ElevenLabs calls had been spent; the rerun is one pass.

## Listening test

Four Ballast lines, each as A Kokoro `am_michael`, B v4 Turbo plain, C v4 Turbo with cues, D v4 with cues, played
to the player in that order (not blind; they asked to hear it). Cues used: `[sighs]` + `[short pause]` on the idle
labs, `[exhales sharply]` + `[urgently]` on an attack, `[chuckles]` before the orbit line, `[whispers]` +
`[short pause]` on hatching eggs.

**Verdict (player, 2026-09-29): adopt v4 with cues.** "The eleven labs v4 with queues were MUCH more immersive than
Kokoro. Let's land it, but keep kokoro as an option." And: "I'm not sure I noticed a difference between turbo or
full." So **`eleven_v4_turbo`** — no audible difference, and 1.0 s faster to a whole clip. Built as FC-260: the model
writes cues only when an ElevenLabs voice will read the answer, they're hidden on screen and stripped for Kokoro and
the browser, and ElevenLabs audio plays as it streams in to win back v4 Turbo's second.
