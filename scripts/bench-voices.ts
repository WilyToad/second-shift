// FC-253: how long each voice makes the player wait, on the same real answer sentences.
//
// Measured the way read-aloud actually works: `ElevenPlayer` asks for one whole sentence and plays it when the
// audio is back, so the number is **request → playable audio**, blob to blob, for every engine. (Kokoro could stream
// chunk by chunk and start sooner; nothing in the player does that yet, so crediting it would compare against a
// product that doesn't exist.)
//
// The browser's own voice can't be measured from here — `SpeechSynthesis` lives in the page — so it isn't a column.
//
// Every clip is written to disk, so the listening test doesn't depend on any server still being up.
//
// Usage: bun scripts/bench-voices.ts --sentences <file.json> --out <dir> [--eleven] [--runs N]
//   Kokoro: the sidecar on :8891 (`.venv-tts/bin/python scripts/lib/kokoro-server.py`)
//   say:    macOS, always there
//   --eleven: ElevenLabs through the running server's /tts. **Spends the player's credits** — one call per sentence
//             per run — so it is off unless asked for.
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : fallback; };
const sentencesFile = opt("--sentences", "");
const out = opt("--out", "");
const runs = Number(opt("--runs", "3"));
const eleven = args.includes("--eleven");
if (!sentencesFile || !out) { console.error("usage: bun scripts/bench-voices.ts --sentences <file.json> --out <dir> [--eleven] [--runs N]"); process.exit(1); }
mkdirSync(out, { recursive: true });

type Sentence = { band: string; words: number; text: string };
const sentences = (await Bun.file(sentencesFile).json()) as Sentence[];

type Engine = { name: string; speak: (text: string, file: string) => Promise<number> };
const timed = async (f: () => Promise<void>) => { const t = performance.now(); await f(); return performance.now() - t; };

const engines: Engine[] = [
  {
    name: "kokoro",
    speak: (text, file) => timed(async () => {
      const res = await fetch("http://127.0.0.1:8891/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: text, voice: "am_michael" }) });
      if (!res.ok) throw new Error(`kokoro ${res.status}: ${await res.text()}`);
      await Bun.write(file, await res.arrayBuffer());
    }),
  },
  {
    // The same voice through the product's own route (FC-254): Bun server → sidecar. The difference from the row
    // above is what the route costs.
    name: "kokoro/tts",
    speak: (text, file) => timed(async () => {
      const res = await fetch("http://127.0.0.1:5170/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: "kokoro:am_michael" }) });
      if (!res.ok) throw new Error(`kokoro/tts ${res.status}: ${await res.text()}`);
      await Bun.write(file, await res.arrayBuffer());
    }),
  },
  {
    name: "say",
    // `say -o` writes the whole sentence before it returns: the same "playable when this finishes" as the others.
    // The text goes in on stdin: a real answer line begins "- Jelly: …", and `say` reads a leading hyphen as an option.
    speak: (text, file) => timed(async () => {
      const p = Bun.spawn(["say", "-o", file, "--file-format=WAVE", "--data-format=LEI16@22050", "-f", "-"], { stdin: new TextEncoder().encode(text) });
      if ((await p.exited) !== 0) throw new Error(`say failed on: ${text.slice(0, 60)}`);
    }),
  },
];
if (eleven) {
  engines.push({
    name: "eleven",
    speak: (text, file) => timed(async () => {
      const res = await fetch("http://127.0.0.1:5170/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(`eleven ${res.status}: ${await res.text()}`);
      await Bun.write(file, await res.arrayBuffer());
    }),
  });
}

const results: Record<string, { band: string; words: number; ms: number[] }[]> = {};
for (const engine of engines) {
  results[engine.name] = [];
  for (const [i, s] of sentences.entries()) {
    const ms: number[] = [];
    for (let r = 0; r < runs; r++) {
      const ext = engine.name === "eleven" ? "mp3" : "wav";
      ms.push(await engine.speak(s.text, `${out}/${engine.name.replace("/", "-")}-${String(i + 1).padStart(2, "0")}.${ext}`));
    }
    results[engine.name]!.push({ band: s.band, words: s.words, ms });
  }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
console.log(`FC-253 — ${sentences.length} real answer sentences, ${runs} runs each, request → playable audio\n`);
console.log(`${"engine".padEnd(8)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)}   by length (p50): ${[...new Set(sentences.map((s) => s.band))].map((b) => `${b}w`).join(" / ")}`);
for (const [name, rows] of Object.entries(results)) {
  const all = rows.flatMap((r) => r.ms);
  const byBand = [...new Set(rows.map((r) => r.band))].map((b) => pct(rows.filter((r) => r.band === b).flatMap((r) => r.ms), 0.5).toFixed(0));
  console.log(`${name.padEnd(8)} ${pct(all, 0.5).toFixed(0).padStart(5)}ms ${pct(all, 0.95).toFixed(0).padStart(5)}ms ${Math.max(...all).toFixed(0).padStart(5)}ms   ${byBand.join(" / ")} ms`);
}
await Bun.write(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), runs, sentences, results }, null, 2));
console.log(`\nclips and results.json in ${out}`);
process.exit(0);
