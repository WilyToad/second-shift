// Delivery cues for a voice that acts them (FC-260): Eleven v4 reads `[sighs]` as a sigh, not as the word. The model
// may write only these, and only when an ElevenLabs voice will read the answer; everything else — the screen, the
// stored history, the correction checks, Kokoro, the browser's voice — gets the text without them.
//
// One list for both jobs, so what the model is allowed to write is exactly what disappears. A cue it invents that isn't
// here stays visible: a prompt problem worth seeing, not one to swallow. Rich text such as `[gps=…]` or `[item=…]` is
// never touched. The player asked for "a broad range of tags" (2026-09-29), so this is ElevenLabs' own list from its
// best-practices page, voice and sound effects both, less the ones it calls experimental and inconsistent across voices
// (`[sings]`, `[woo]`, `[strong X accent]`, `[fart]`) and `[crying]`, which isn't Ballast. `[dryly]` and `[urgently]`
// aren't on ElevenLabs' list; v4 performed them in FC-259's clips.
export const CUE_GROUPS = {
  /** How a line is said. */
  delivery: ["dryly", "sarcastic", "curious", "thoughtful", "mischievously", "excited", "happy", "sad", "angry", "annoyed", "appalled", "surprised", "urgently", "muttering", "whispers"],
  /** Sounds he makes. */
  voice: ["sighs", "exhales", "exhales sharply", "inhales deeply", "chuckles", "laughs", "laughs harder", "starts laughing", "wheezing", "snorts", "clears throat", "gulps", "swallows"],
  pauses: ["short pause", "long pause"],
  /** Sound effects, not his voice: an attack, a turret firing, a milestone. */
  effects: ["explosion", "gunshot", "applause", "clapping"],
} as const;

export const CUES: readonly string[] = Object.values(CUE_GROUPS).flat();

const CUE = new RegExp(`\\[(?:${[...CUES].sort((a, b) => b.length - a.length).join("|")})\\]`, "gi");

/** The text without its cues, and without the gap a cue leaves: "[sighs] Idle." → "Idle.", "idle, [short pause] queued" → "idle, queued". */
export function withoutCues(text: string): string {
  if (!text.includes("[")) return text;
  return text
    .replace(new RegExp(`(?:[ \\t]*${CUE.source})+[ \\t]*`, "gi"), (m, offset: number, whole: string) => {
      // Keep one space between the words either side; none at the start of a line or before punctuation.
      const before = whole[offset - 1];
      const after = whole[offset + m.length];
      return before === undefined || before === "\n" || after === undefined || after === "\n" || /[.,!?;:…]/.test(after) ? "" : " ";
    });
}

/**
 * The same for text still arriving: a cue cut in half at the end of what has come so far ("… idle [sig") is held
 * back too, so the screen doesn't flash it.
 */
export function withoutCuesStreaming(text: string): string {
  const open = text.lastIndexOf("[");
  const held = open >= 0 && !text.includes("]", open) && /^\[[a-z ]{0,16}$/i.test(text.slice(open)) ? text.slice(0, open) : text;
  return withoutCues(held);
}

/** The guidance line for a turn an ElevenLabs voice will read. */
export function cueNote(): string {
  const list = (cues: readonly string[]) => cues.map((c) => `[${c}]`).join(" ");
  return `this answer will be read aloud by a voice that acts cues in square brackets, so you may use up to three, only from these — how a line is said: ${list(CUE_GROUPS.delivery)}; sounds you make: ${list(CUE_GROUPS.voice)}; pauses: ${list(CUE_GROUPS.pauses)}; sound effects, at most one and only when the moment is really that (an attack, a milestone): ${list(CUE_GROUPS.effects)}. Put each just before the words it colours, vary them from answer to answer rather than reaching for the same one, only where you'd really sound that way, none inside numbers, lists or tables, and none at all if nothing fits. A cue adds no words, so don't write more to make room for one`;
}
