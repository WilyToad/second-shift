// Whisper spells the save's words the way English would: "Spider-Tron", "spider tron", "RoboPort" (FC-189, three of
// its five misses). It knows the language and not the game, and a prompt made it worse. So the names are put back
// afterwards, deterministically, from the same list the recognizer is sent (FC-177): a run of words that spells a
// known name once the spaces and hyphens are gone becomes that name. Nothing phonetic — "Spider-John" stays wrong,
// and says so by staying wrong.

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Character edit distance, small strings only. */
function distance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length]!;
}

/**
 * A run of words that is nearly a long known name is that name: "spider train" for spidertron (the first live
 * clip through /stt, 2026-09-19). Only names of ten squashed characters or more, and only within two edits, so
 * short words can't be rewritten into each other; the trade, named: "iron plant" would stay "iron plant".
 */
function nearest(run: string, known: Map<string, string>): string | undefined {
  if (run.length < 8) return undefined;
  let best: { name: string; d: number } | undefined;
  for (const [key, name] of known) {
    if (key.length < 10 || Math.abs(key.length - run.length) > 2) continue;
    const d = distance(run, key);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

/** `phrases` are the save's names as a person says them ("transport belt", "spidertron"); words are joined up to four at a time. */
export function normalizeNames(text: string, phrases: string[]): string {
  const known = new Map<string, string>();
  for (const p of phrases) known.set(squash(p), p);
  if (!known.size) return text;
  const tokens = text.split(/(\s+)/); // keep the whitespace
  const wordsOnly = tokens.map((t, i) => (i % 2 === 0 ? t : null));
  const out: (string | null)[] = tokens.slice();
  for (let i = 0; i < tokens.length; i += 2) {
    if (out[i] === null || !tokens[i]) continue;
    // Longest run first, so "space platform foundation" beats "space platform". Exact runs of every length are
    // tried before any near miss, so "spidertron to" is never read as a misspelling of spidertron.
    const longest = Math.min(4, Math.ceil((tokens.length - i) / 2));
    const runAt = (n: number) => {
      const idx = Array.from({ length: n }, (_, k) => i + 2 * k);
      const run = idx.map((j) => wordsOnly[j] ?? "").join("");
      const core = run.replace(/[.,!?;:]+$/, "");
      return { idx, core, trailing: run.slice(core.length) };
    };
    const attempts: { n: number; near: boolean }[] = [];
    for (let n = longest; n >= 1; n--) attempts.push({ n, near: false });
    for (let n = longest; n >= 2; n--) attempts.push({ n, near: true });
    for (const { n, near } of attempts) {
      const { idx, core, trailing } = runAt(n);
      // A near miss counts only when every word in the run is part of it: "An iron gear wheel" is the exact name
      // with a word in front, not a misspelling of it.
      const wordAt = (j: number) => (wordsOnly[j] ?? "").replace(/[.,!?;:]+$/, "");
      const edges = [idx.slice(1), idx.slice(0, -1)].map((part) => squash(part.map(wordAt).join("")));
      const hit = near ? (edges.some((e) => known.has(e)) ? undefined : nearest(squash(core), known)) : known.get(squash(core));
      // A single token only changes when it isn't already a plain known word: "Spider-Tron" → "spidertron",
      // but "Belt" stays as the person wrote it.
      if (hit && (n > 1 || /[-A-Z]/.test(core.slice(1)) || core.toLowerCase() !== hit)) {
        out[i] = hit + trailing;
        for (const j of idx.slice(1)) { out[j - 1] = null; out[j] = null; }
        i += 2 * (n - 1);
        break;
      }
    }
  }
  return out.filter((t) => t !== null).join("");
}
