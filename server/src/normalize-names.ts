// Whisper spells the save's words the way English would: "Spider-Tron", "spider tron", "RoboPort" (FC-189, three of
// its five misses). It knows the language and not the game, and a prompt made it worse. So the names are put back
// afterwards, deterministically, from the same list the recognizer is sent (FC-177): a run of words that spells a
// known name once the spaces and hyphens are gone becomes that name. Nothing phonetic — "Spider-John" stays wrong,
// and says so by staying wrong.

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
    // Longest run first, so "space platform foundation" beats "space platform".
    for (let n = Math.min(4, Math.ceil((tokens.length - i) / 2)); n >= 1; n--) {
      const idx = Array.from({ length: n }, (_, k) => i + 2 * k);
      const run = idx.map((j) => wordsOnly[j] ?? "").join("");
      const core = run.replace(/[.,!?;:]+$/, "");
      const trailing = run.slice(core.length);
      const hit = known.get(squash(core));
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
