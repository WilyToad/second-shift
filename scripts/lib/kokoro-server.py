# FC-253: Kokoro-82M as a localhost sidecar, the way whisper-server sits beside the Bun server (FC-230).
#
# One resident model, one endpoint in the same shape as the OpenAI speech API the rest of the stack already speaks:
#   POST /v1/audio/speech  {"input": "...", "voice": "af_heart", "speed": 1.0}  ->  audio/wav
#   GET  /health                                                                  ->  {"ready": true}
#   GET  /voices                                                                  ->  {"default": "...", "voices": [...]}
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

# Point phonemizer at the espeak-ng that espeakng-loader bundles — both the library and its data. The data path
# matters as much as the library: without it, espeak-ng falls back to the path baked in on the package's own build
# machine (/Users/runner/work/…) and exits on start. The first version set `ESPEAK_DATA_PATH`, which phonemizer
# doesn't read; it only worked in the venv it was written in, and failed from a clean install (FC-254). The
# explicit setters don't depend on getting a variable name right.
from phonemizer.backend.espeak.wrapper import EspeakWrapper  # noqa: E402


def _short_data_path() -> str:
    """
    espeak-ng keeps its data path in a fixed-size buffer and silently drops one that's too long, falling back to the
    path baked in on the package's own build machine (/Users/runner/work/…) — then exits on start, naming a directory
    nobody has. Measured: data paths of 103 and 108 characters worked, 176 failed. A repo cloned somewhere deep would
    hit it.

    A symlink doesn't help — phonemizer resolves the path, following the link straight back to the long one — so a
    long path gets a real copy (19 MB, once, keyed by the package version so an upgrade isn't left stale). A path that
    is already short is used as it is, so a normal install changes nothing.
    """
    real = espeakng_loader.get_data_path()
    # 120 is a safe margin, not the measured limit: 108 characters worked and 176 failed, so the real boundary is
    # somewhere between (espeak-ng's buffer, less the filenames it appends).
    if len(real) <= 120:
        return real
    import shutil
    from importlib.metadata import version

    short = os.path.join(os.path.expanduser("~/.cache/second-shift"), f"espeak-ng-data-{version('espeakng-loader')}")
    try:
        if not os.path.isfile(os.path.join(short, "phontab")):
            shutil.copytree(real, short, dirs_exist_ok=True)
        return short
    except OSError:
        return real  # can't copy: the real path, which fails loudly rather than quietly


DATA_PATH = _short_data_path()
EspeakWrapper.set_library(espeakng_loader.get_library_path())
EspeakWrapper.set_data_path(DATA_PATH)
os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", espeakng_loader.get_library_path())
os.environ.setdefault("PHONEMIZER_ESPEAK_DATA_PATH", DATA_PATH)

# Offline-first. The model and voices are downloaded once; after that nothing here should touch the network at
# startup — the player tests the whole stack with the wifi off, and Hugging Face's update check alone added 6 s to
# startup when it could reach the network. HF_HUB_OFFLINE only once the snapshot is on disk, so a first run still
# downloads.
from huggingface_hub import scan_cache_dir  # noqa: E402

try:
    if any(r.repo_id == "prince-canuma/Kokoro-82M" for r in scan_cache_dir().repos):
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
except Exception:
    pass

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
# The English voices this install has — American and British, both sexes (a_ and b_ prefixes; f_ and m_). Read
# from the model's own voices folder, so the list is what's on disk rather than what a README says.
def _voices() -> list:
    from huggingface_hub import snapshot_download

    folder = os.path.join(snapshot_download("prince-canuma/Kokoro-82M", allow_patterns=["voices/*"]), "voices")
    # Each voice is on disk in two formats (.pt and .safetensors): one name, once.
    names = sorted({os.path.splitext(f)[0] for f in os.listdir(folder)}) if os.path.isdir(folder) else []
    return [n for n in names if n[:3] in ("af_", "am_", "bf_", "bm_")]


VOICES = _voices()
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
        elif self.path == "/voices":
            self._send(200, json.dumps({"default": DEFAULT_VOICE, "voices": VOICES}).encode(), "application/json")
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
