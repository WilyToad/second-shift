# FC-253: Kokoro-82M as a localhost sidecar, the way whisper-server sits beside the Bun server (FC-230).
#
# One resident model, one endpoint in the same shape as the OpenAI speech API the rest of the stack already speaks:
#   POST /v1/audio/speech  {"input": "...", "voice": "af_heart", "speed": 1.0}  ->  audio/wav
#   GET  /health                                                                  ->  {"ready": true}
#
# Deliberately small and standard-library only: mlx-audio's own server pulls in speech-to-text dependencies
# (webrtcvad) that don't build on Python 3.14 and that text-to-speech never touches.
#
# espeak-ng is Kokoro's fallback for words its English dictionary doesn't have — which is most of this game's modded
# vocabulary (yumako, maraxsis, holmium). phonemizer looks for a system install; it is pointed at the copy that
# espeakng-loader bundles, so nothing is installed outside the venv. Note both are GPL-3.0 (PLAN §5, FC-253).
#
# Usage: .venv-tts/bin/python scripts/lib/kokoro-server.py [--port 8891] [--voice af_heart]
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import logging

import espeakng_loader

logging.getLogger("phonemizer").setLevel(logging.ERROR)

os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", espeakng_loader.get_library_path())
os.environ.setdefault("ESPEAK_DATA_PATH", espeakng_loader.get_data_path())

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from mlx_audio.tts.utils import load_model  # noqa: E402

PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8891
DEFAULT_VOICE = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else "af_heart"
RATE = 24_000
MAX_CHARS = 600  # the same cap the ElevenLabs client uses, so the two are fed identically

started = time.time()
MODEL = load_model("prince-canuma/Kokoro-82M")
# The first generation compiles the graph (~0.8-4.9 s measured); pay it here, not on the player's first sentence.
for _ in MODEL.generate(text="Ready.", voice=DEFAULT_VOICE, speed=1.0, lang_code="a"):
    pass
print(f"kokoro-server: ready on :{PORT} in {time.time() - started:.1f} s (voice {DEFAULT_VOICE})", flush=True)


# The player's queue fires a request per sentence as each is written, so requests overlap. One model on one GPU is
# not safe to run from two threads at once: they take turns, and /health still answers while one runs.
LOCK = threading.Lock()


def synthesize(text: str, voice: str, speed: float) -> bytes:
    with LOCK:
        chunks = [np.array(r.audio) for r in MODEL.generate(text=text[:MAX_CHARS], voice=voice, speed=speed, lang_code="a")]
    audio = np.nan_to_num(np.concatenate(chunks)) if chunks else np.zeros(0, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.1, so a connection stays open between sentences. The default HTTP/1.0 closes after every response, and
    # a client that reuses sockets — Bun's fetch does — then sends the next sentence down a closed one and gets
    # ECONNRESET. Measured: it happened on the first sustained run (FC-253).
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):  # one line per request is the caller's business, not ours
        pass

    def _send(self, code: int, body: bytes, kind: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b'{"ready": true}', "application/json")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self._send(404, b"not found", "text/plain")
            return
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            text = str(req.get("input", "")).strip()
            if not text:
                self._send(400, b"no input", "text/plain")
                return
            wav = synthesize(text, str(req.get("voice") or DEFAULT_VOICE), float(req.get("speed") or 1.0))
            self._send(200, wav, "audio/wav")
        except Exception as e:  # a bad sentence must never take the sidecar down
            self._send(500, str(e).encode()[:300], "text/plain")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
