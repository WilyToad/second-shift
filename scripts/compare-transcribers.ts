// FC-189: the same clips through several transcribers, scored against what the player actually said.
//
// The decision this is for — a local model, or keep the browser engine — rests on FC-176's stop conditions, and the
// only evidence that counts is the player's own voice over game audio. So this reads `data/captures/voice/`
// (FC-188: a 16 kHz WAV, the browser's transcript, and the player's correction where they gave one) and reports,
// per clip and in aggregate: exact match, word error rate, and each failure class seen so far.
//
// Deliberately a measurement, not a feature: no /stt route, nothing wired into a turn. Local backends run only if
// they're installed — installing them is the player's decision — and the browser's transcript is always scored, so
// the harness proves itself on clips before any model is downloaded.
// Usage: bun scripts/compare-transcribers.ts [--dir data/captures/voice] [--vocab] [--json]
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type Clip = { id: string; wav: string; heard: string; said?: string; seconds: number; where?: string };
export type Score = { exact: boolean; wer: number; errors: number; words: number; classes: string[] };

/** Words as a transcriber would be judged on them: lower case, no punctuation, numerals as written. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

/** Levenshtein over words: substitutions + insertions + deletions, divided by the reference length. */
export function wer(reference: string, hypothesis: string): { wer: number; errors: number; words: number } {
  const r = words(reference), h = words(hypothesis);
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  const errors = d[r.length]![h.length]!;
  return { wer: r.length ? errors / r.length : hypothesis ? 1 : 0, errors, words: r.length };
}

/**
 * The failure classes seen in the player's sessions, named so a transcriber can be judged on the ones that matter
 * here rather than on a single number: a near-homophone ("wire" → "wine"/"where"), a numeral glued or dropped
 * ("I've got 10" → "Got10"), a function word swapped ("up there" → "of there"), a syllable dropped ("hitting" →
 * "hitty"), a name mangled ("spidertron" → "spider time").
 */
export function failureClasses(reference: string, hypothesis: string): string[] {
  const r = words(reference), h = words(hypothesis);
  if (r.join(" ") === h.join(" ")) return [];
  const out = new Set<string>();
  const FUNCTION = new Set(["to", "of", "up", "at", "in", "on", "for", "the", "a", "an", "and", "or", "there", "here", "is", "are"]);
  const rSet = new Set(r), hSet = new Set(h);
  for (const w of r) if (!hSet.has(w)) {
    if (/^\d/.test(w)) out.add("numeral");
    else if (FUNCTION.has(w)) out.add("function-word");
    else {
      const extra = h.filter((x) => !rSet.has(x));
      const clipped = extra.find((x) => x.length >= 3 && x.length < w.length && w.startsWith(x.slice(0, 3)));
      // "dots" against "darts" is two edits on a four-letter word: near enough to be the same sound.
      const near = extra.find((x) => editDistance(w, x) <= (w.length >= 4 ? Math.max(2, Math.ceil(w.length / 3)) : 1));
      if (clipped) out.add("dropped-syllable");
      else if (near) out.add("homophone");
      else if (extra.some((x) => x.startsWith(w.slice(0, 2)) || w.startsWith(x.slice(0, 2)))) out.add("split-word");
      else out.add("missing-word");
    }
  }
  for (const w of h) if (!rSet.has(w) && /^\d/.test(w) && !/^\d+$/.test(w)) out.add("numeral");
  return [...out];
}

/** Character edit distance, for "dots" against "darts": near enough to be the same sound. */
function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length]!;
}

export function score(reference: string, hypothesis: string): Score {
  const w = wer(reference, hypothesis);
  return { exact: words(reference).join(" ") === words(hypothesis).join(" "), ...w, classes: failureClasses(reference, hypothesis) };
}

/** The clips on disk, with whatever ground truth exists. A clip without a correction is *presumed* right. */
export async function loadClips(dir: string): Promise<Clip[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  const clips: Clip[] = [];
  for (const name of names) {
    const meta = (await Bun.file(join(dir, name)).json().catch(() => null)) as { heard?: string; said?: string; seconds?: number; detail?: { where?: string } } | null;
    if (!meta?.heard) continue;
    clips.push({ id: name.replace(/\.json$/, ""), wav: join(dir, name.replace(/\.json$/, ".wav")), heard: meta.heard, said: meta.said, seconds: meta.seconds ?? 0, where: meta.detail?.where });
  }
  return clips;
}

/** A transcriber the harness can run. Local ones are present only if the player installed them. */
export type Backend = { name: string; available: () => Promise<string | null>; transcribe: (wav: string, prompt?: string) => Promise<{ text: string; ms: number }> };

const which = async (bin: string) => (await Bun.$`which ${bin}`.quiet().nothrow()).exitCode === 0;

export const BACKENDS: Backend[] = [
  {
    name: "whisper.cpp large-v3-turbo",
    available: async () => (await which("whisper-cli")) ? null : "whisper-cli not installed (brew install whisper.cpp, plus the ggml-large-v3-turbo model)",
    transcribe: async (wav, prompt) => {
      const model = process.env.WHISPER_MODEL ?? `${process.env.HOME}/.cache/whisper/ggml-large-v3-turbo.bin`;
      const started = performance.now();
      const out = await Bun.$`whisper-cli -m ${model} -f ${wav} -nt -np ${prompt ? ["--prompt", prompt] : []}`.quiet().nothrow();
      return { text: out.stdout.toString().trim(), ms: performance.now() - started };
    },
  },
  {
    name: "mlx-whisper turbo",
    available: async () => ((await Bun.$`python3 -c "import mlx_whisper"`.quiet().nothrow()).exitCode === 0 ? null : "mlx_whisper not importable (pip install mlx-whisper)"),
    transcribe: async (wav, prompt) => {
      const started = performance.now();
      const py = `import mlx_whisper, json, sys; r = mlx_whisper.transcribe(sys.argv[1], path_or_hf_repo="mlx-community/whisper-turbo", initial_prompt=${JSON.stringify(prompt ?? "")} or None, condition_on_previous_text=False); print(r["text"].strip())`;
      const out = await Bun.$`python3 -c ${py} ${wav}`.quiet().nothrow();
      return { text: out.stdout.toString().trim(), ms: performance.now() - started };
    },
  },
  {
    name: "parakeet-tdt-0.6b-v3",
    available: async () => ((await Bun.$`python3 -c "import parakeet_mlx"`.quiet().nothrow()).exitCode === 0 ? null : "parakeet_mlx not importable (pip install parakeet-mlx); no hotword biasing"),
    transcribe: async (wav) => {
      const started = performance.now();
      const py = `from parakeet_mlx import from_pretrained; import sys; m = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3"); print(m.transcribe(sys.argv[1]).text.strip())`;
      const out = await Bun.$`python3 -c ${py} ${wav}`.quiet().nothrow();
      return { text: out.stdout.toString().trim(), ms: performance.now() - started };
    },
  },
];

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1]! : "data/captures/voice";
  const clips = await loadClips(dir);
  const truthful = clips.filter((c) => c.said);
  console.log(`${clips.length} clips in ${dir}, ${truthful.length} with the player's own wording (the rest presumed right)\n`);
  if (!clips.length) process.exit(0);

  // The browser's transcript first: it's what shipped, and it scores without installing anything.
  const report = (name: string, rows: { clip: Clip; hyp: string; ms?: number }[]) => {
    const scored = rows.map((r) => ({ ...r, s: score(r.clip.said ?? r.clip.heard, r.hyp) }));
    const judged = scored.filter((r) => r.clip.said); // only clips with ground truth say anything about accuracy
    const exact = judged.filter((r) => r.s.exact).length;
    const totalErr = judged.reduce((n, r) => n + r.s.errors, 0), totalWords = judged.reduce((n, r) => n + r.s.words, 0);
    const classes: Record<string, number> = {};
    for (const r of judged) for (const c of r.s.classes) classes[c] = (classes[c] ?? 0) + 1;
    const ms = rows.filter((r) => r.ms !== undefined).map((r) => r.ms!).sort((a, b) => a - b);
    console.log(`== ${name} ==`);
    for (const r of judged) console.log(`  ${r.s.exact ? "ok  " : "MISS"} ${r.clip.id}  said "${r.clip.said}"  heard "${r.hyp}"${r.s.classes.length ? `  [${r.s.classes.join(", ")}]` : ""}`);
    console.log(`  ${judged.length} judged: ${exact} exact, WER ${totalWords ? ((totalErr / totalWords) * 100).toFixed(1) : "n/a"}% (${totalErr}/${totalWords} words)${Object.keys(classes).length ? ` · ${Object.entries(classes).map(([c, n]) => `${c} ${n}`).join(", ")}` : ""}${ms.length ? ` · delay p50 ${Math.round(ms[Math.floor(ms.length / 2)]!)} ms, p95 ${Math.round(ms[Math.floor(ms.length * 0.95)]!)} ms` : ""}\n`);
  };
  report("browser engine (as recorded)", clips.map((c) => ({ clip: c, hyp: c.heard })));

  const prompt = args.includes("--vocab") ? (await Bun.file("data/captures/prototypes.json").json().then((p: { items: Record<string, unknown> }) => Object.keys(p.items).slice(0, 150).map((n) => n.replace(/-/g, " ")).join(", ")).catch(() => undefined)) : undefined;
  for (const b of BACKENDS) {
    const missing = await b.available();
    if (missing) { console.log(`== ${b.name} == skipped: ${missing}\n`); continue; }
    const rows: { clip: Clip; hyp: string; ms: number }[] = [];
    for (const c of clips) { const r = await b.transcribe(c.wav, prompt); rows.push({ clip: c, hyp: r.text, ms: r.ms }); }
    report(`${b.name}${prompt ? " + vocabulary prompt" : ""}`, rows);
  }
}
