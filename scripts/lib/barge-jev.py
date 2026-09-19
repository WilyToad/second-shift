# FC-233 spike: score the barge-in question with jevmlx (Jev-style option scoring on a small local model).
# Reads JSONL cases {id, spoken, heard} on stdin, writes JSONL {id, who, p_player, p_echo, ms} on stdout, and a
# final line {"footprint_mb": N, "model": ..., "load_ms": N}. Usage: barge-jev.py --model test|fast|<hub id>
import json, os, re, subprocess, sys, time
from enum import Enum
from pydantic import BaseModel
from jevmlx import decide, decide_many

class Who(str, Enum):
    player = "player"
    echo = "echo"

class Barge(BaseModel):
    who: Who

def context(spoken: str, heard: str) -> str:
    return (
        "A Factorio companion is reading its answer aloud through the player's speakers while the microphone keeps "
        "listening. What the microphone heard is either the companion's own voice coming back (echo: the same words, "
        "or a piece of them, sometimes garbled) or the player cutting in (player: their own question, an order, or a "
        f"word like stop or wait).\nCompanion was saying: \"{spoken}\"\nMicrophone heard: \"{heard}\"\n"
        "Who is it?"
    )

def footprint_mb() -> float:
    """The process's physical footprint from `footprint -p` (RSS is meaningless for MLX's shared GPU memory, FC-192)."""
    try:
        out = subprocess.run(["footprint", "-p", str(os.getpid())], capture_output=True, text=True, timeout=10).stdout
        m = re.search(r"Footprint:\s*([\d.]+)\s*(KB|MB|GB)", out)
        if m:
            return round(float(m.group(1)) * {"KB": 1 / 1024, "MB": 1, "GB": 1024}[m.group(2)], 1)
    except Exception:
        pass
    return -1

model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "test"
batch = int(sys.argv[sys.argv.index("--batch") + 1]) if "--batch" in sys.argv else 1
scoring = sys.argv[sys.argv.index("--scoring") + 1] if "--scoring" in sys.argv else "slots"
opts = {"scoring": scoring, "prior_correction": "--prior" in sys.argv}
cases = [json.loads(l) for l in sys.stdin if l.strip()]
t = time.time()
decide(Barge, context("Warming up.", "warming up"), model=model, **opts)
load_ms = round((time.time() - t) * 1000)
for i in range(0, len(cases), batch):
    chunk = cases[i:i + batch]
    t = time.time()
    if batch == 1:
        results = [decide(Barge, context(c["spoken"], c["heard"]), model=model, **opts) for c in chunk]
    else:
        results = decide_many(Barge, [context(c["spoken"], c["heard"]) for c in chunk], model=model, **opts)
    ms = (time.time() - t) * 1000 / len(chunk)
    for c, r in zip(chunk, results):
        f = r.fields["who"]
        alts = {str(getattr(a, "value", a)): getattr(a, "probability", None) for a in (f.alternatives or [])}
        p = {str(f.value.value if hasattr(f.value, "value") else f.value): f.probability}
        for k, v in alts.items():
            if v is not None:
                p.setdefault(k.replace("Who.", ""), v)
        print(json.dumps({"id": c["id"], "who": f.value.value if hasattr(f.value, "value") else str(f.value), "p_player": p.get("player"), "p_echo": p.get("echo"), "ms": round(ms, 1)}), flush=True)
print(json.dumps({"footprint_mb": footprint_mb(), "model": f"{model} ({scoring}{', prior-corrected' if opts['prior_correction'] else ''})", "load_ms": load_ms}), flush=True)
