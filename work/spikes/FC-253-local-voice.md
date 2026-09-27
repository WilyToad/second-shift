# FC-253 — A local voice good enough to replace ElevenLabs

**Question.** Read-aloud has three voices: the browser's, macOS `say`, and ElevenLabs. ElevenLabs is the only good
one, and the only one that sends the answer text off the Mac. Can a local model match it?

**Candidate.** Kokoro-82M: Apache-2.0 on both weights and code, and a model card that states its training data's
provenance (public-domain audio, audio under Apache/MIT, synthetic audio from closed providers; no synthetic data
from open-source TTS, no custom voice clones). 82M parameters, 28 English voices (American and British, both sexes).

## Does it run here — yes

An open report said the MLX port emits NaN or silence on Apple Silicon (mlx-audio 0.4.4, mlx 0.31.2). On the
versions installed now — **mlx-audio 0.5.6, mlx 0.32.2**, Python 3.14 — it doesn't: NaN 0, peak 0.36, rms 0.048,
real speech. The bug is fixed upstream.

Getting there took four dependency fixes, all inside the venv (`.venv-tts/`, gitignored), none on the system:

- `misaki[en]` pins an old spaCy with no Python 3.14 wheel and tries to build it; spaCy 3.8.16 *does* ship a cp314
  arm64 wheel, installed with `--only-binary`.
- `num2words`, which misaki imports and doesn't declare.
- `phonemizer` + `espeakng-loader`: espeak-ng is Kokoro's fallback for words its English dictionary doesn't have —
  which is most of this game's modded vocabulary (yumako, maraxsis, holmium). phonemizer looks for a system install,
  so it is pointed at the library espeakng-loader bundles, through `PHONEMIZER_ESPEAK_LIBRARY` and
  `ESPEAK_DATA_PATH`.
- mlx-audio's own server needs speech-to-text dependencies (`webrtcvad`) that don't build on 3.14 and that
  text-to-speech never uses, so `scripts/lib/kokoro-server.py` is a standard-library server of our own.

## How long the player waits — measured

`scripts/bench-voices.ts`, 12 real answer sentences from `data/eval` (three per length band, run through the
product's own `speakable()`), three runs each. Measured **request → playable audio**, whole sentence, because that is
what `ElevenPlayer` waits for; Kokoro can stream chunk by chunk, but nothing in the player does yet, so crediting it
would compare against a product that doesn't exist.

| | p50 | p95 | 4–8 words | 9–14 | 15–22 | 23–34 |
|---|---|---|---|---|---|---|
| **Kokoro** (localhost sidecar) | **152 ms** | 277 ms | 77 | 125 | 189 | 219 |
| macOS `say` | 674 ms | 709 ms | 622 | 648 | 680 | 700 |

Kokoro is about 4.4× faster to playable audio and scales with the sentence; `say` pays ~620 ms of fixed overhead
whatever the length. The browser voice can't be measured from a script (`SpeechSynthesis` lives in the page), so it
isn't a column. ElevenLabs is pending — see below.

**Startup:** the sidecar is ready in 1.2–1.3 s, with the first graph compile (0.8–4.9 s measured) paid at startup
instead of on the player's first sentence.

## What it costs the rest of the stack — measured

- **Resident footprint: 535 MB** (`footprint -p`), a quarter of whisper-server's 1.9 GB.
- **oMLX first token, Kokoro idle: 254 ms median; while Kokoro reads aloud continuously: 220 ms.** No penalty —
  within noise, if anything the GPU staying clocked up. Reading one answer aloud does not slow the next one.

## Two bugs the spike found in its own server

- **ECONNRESET under sustained load.** Python's HTTP handler defaults to HTTP/1.0 and closes each connection; Bun's
  `fetch` reuses sockets, so the next sentence went down a closed one. The player's queue fires a request per
  sentence, so this would have hit real play. Fixed with `protocol_version = "HTTP/1.1"`.
- **Two requests at once on one model.** The same queue overlaps requests; one MLX model driven from two threads
  isn't safe. Synthesis is serialised behind a lock, and `/health` still answers while one runs.

## Licences — the part the player asked about

| package | licence | role |
|---|---|---|
| Kokoro-82M (weights and code) | Apache-2.0 | the model |
| misaki | Apache-2.0 | text to phonemes |
| mlx-audio | MIT | the runtime |
| spaCy | MIT | tokenising |
| **phonemizer** | **GPL-3.0** | the espeak bridge |
| **espeak-ng** (bundled by espeakng-loader) | **GPL-3.0** | the out-of-dictionary fallback |

The model itself is clean. The GPL enters through the fallback that this game's vocabulary needs. What that means
for us: Second Shift is MIT and does not ship any of these — the player installs them into their own venv, and the
Bun server talks to the sidecar over HTTP in a separate process, the same footing as whisper.cpp. GPL obligations
attach to redistributing the GPL code, which we don't do. It would matter only if the project ever bundled a
ready-made voice package, and then the espeak-ng fallback is the one piece to replace or ship under its own licence.

## Still to decide

- **Quality.** The player listens and picks; this isn't a number.
- **ElevenLabs latency**, for the table. It spends the player's credits (one call per sentence per run), so it runs
  only on their word.
