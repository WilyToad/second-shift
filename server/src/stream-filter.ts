// Removes blocks from a streamed answer that the player must never see: a rate_chart block on a turn that doesn't
// allow charts (FC-111, the model is told "no chart block" but sometimes writes one anyway and the page would draw
// it), and a tool call the model wrote as text (FC-184, which reached one player as their entire answer).
const FENCE = "```";
/** A line holding nothing but HTML tags, complete ("</br>", "<br/>") or still arriving ("</b"). */
const BARE_TAG_LINE = /^[ \t]*(?:<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>\n]*)?\/?>[ \t]*)+\n/gm;
const BARE_TAG_SO_FAR = /^[ \t]*(?:<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>\n]*)?\/?>[ \t]*)*<\/?[a-zA-Z0-9]*(?:\s[^<>\n]*)?\/?>?[ \t]*$/;
type Block = { open: string; close: string };
const CHART: Block = { open: "```rate_chart", close: FENCE };
const TOOL_CALL: Block = { open: "<tool_call>", close: "</tool_call>" };

export class HiddenBlockFilter {
  private pending = "";
  private inBlock: Block | null = null;
  private readonly blocks: Block[];

  /**
   * A tool-call block is always hidden. A chart block is hidden unless the turn allows charts — before this took an
   * option, a chart-allowed turn ran no filter at all, so a tool call written as text streamed straight to the
   * page on exactly those turns (FC-202, found by the 2026-09-18 audit).
   */
  constructor(opts: { charts?: boolean } = {}) {
    this.blocks = opts.charts ? [TOOL_CALL] : [CHART, TOOL_CALL];
  }

  /** How much of the tail could still grow into an opening marker, and so has to wait for the next token. */
  private held(): number {
    let keep = 0;
    for (const block of this.blocks) {
      for (let k = Math.min(block.open.length - 1, this.pending.length); k > keep; k--) {
        if (this.pending.slice(-k) === block.open.slice(0, k)) { keep = k; break; }
      }
    }
    // A line that so far is only a bare HTML tag (or the start of one) waits, so "</br>" can be dropped whole
    // rather than shown (FC-226). Anything else on the line frees it: "x < y" is text, and so is `<br>` in code.
    const line = this.pending.slice(this.pending.lastIndexOf("\n") + 1);
    if (BARE_TAG_SO_FAR.test(line) && line.length > keep) keep = line.length;
    return keep;
  }

  /** Drops bare-tag lines from text that is about to be shown. */
  private static clean(text: string): string {
    return text.replace(BARE_TAG_LINE, "");
  }

  /** Text that is safe to show now. Anything that might still turn into a chart block is held back. */
  push(text: string): string {
    let out = "";
    this.pending += text;
    for (;;) {
      if (this.inBlock) {
        const close = this.inBlock.close;
        const end = this.pending.indexOf(close);
        if (end < 0) {
          this.pending = this.pending.slice(-(close.length - 1)); // a closing marker may be split across tokens
          return out;
        }
        this.pending = this.pending.slice(end + close.length);
        this.inBlock = null;
        continue;
      }
      let at = -1;
      let hit: Block | null = null;
      for (const block of this.blocks) {
        const i = this.pending.indexOf(block.open);
        if (i >= 0 && (at < 0 || i < at)) { at = i; hit = block; }
      }
      if (hit) {
        out += HiddenBlockFilter.clean(this.pending.slice(0, at));
        this.pending = this.pending.slice(at + hit.open.length);
        this.inBlock = hit;
        continue;
      }
      const keep = this.held();
      out += HiddenBlockFilter.clean(this.pending.slice(0, this.pending.length - keep));
      this.pending = this.pending.slice(this.pending.length - keep);
      return out;
    }
  }

  /** What's left when the answer ends; an unfinished block is dropped. A bare marker prefix can no longer grow
   * into one, so it's ordinary text and passes through (an answer really can end on a backtick). */
  end(): string {
    // A bare tag with no newline after it — "</br>" trailing the answer — goes too.
    const rest = this.inBlock ? "" : HiddenBlockFilter.clean(this.pending + "\n").replace(/\n$/, "");
    this.pending = "";
    this.inBlock = null;
    return rest;
  }
}

export function stripChartBlocks(text: string): string {
  const filter = new HiddenBlockFilter();
  return (filter.push(text) + filter.end()).replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Cuts an answer that starts over (FC-130): the model sometimes writes its whole answer twice. Text after a
 * whitespace boundary that matches the answer's beginning is held back; once `minChars` of it match, the rest is a
 * repeat and is dropped. Text that stops matching is released, so a legitimate restated phrase only waits briefly.
 */
export class RepeatFilter {
  private emitted = "";
  private held = "";
  repeated = false;

  constructor(private readonly minChars = 60) {}

  /** Text that is safe to show now. */
  push(text: string): string {
    if (this.repeated || !text) return "";
    this.held += text;
    const head = this.emitted.trimStart().slice(0, this.minChars);
    let candidate = -1;
    if (head.length === this.minChars) {
      for (let i = 0; i < this.held.length; i++) {
        const before = i === 0 ? this.emitted.at(-1) : this.held[i - 1];
        if (!before || !/\s/.test(before) || /\s/.test(this.held[i]!)) continue;
        if (head.startsWith(this.held.slice(i, i + head.length))) { candidate = i; break; }
      }
    }
    if (candidate < 0) {
      const out = this.held;
      this.emitted += out;
      this.held = "";
      return out;
    }
    const out = this.held.slice(0, candidate);
    this.emitted += out;
    this.held = this.held.slice(candidate);
    if (this.held.length >= head.length) {
      this.repeated = true;
      this.held = "";
    }
    return out;
  }

  /** What's left when the answer ends: held text that never became a full repeat. */
  end(): string {
    const rest = this.held;
    this.emitted += rest;
    this.held = "";
    return rest;
  }

  /** Everything shown so far: the answer, one copy. */
  text(): string {
    return this.emitted.trimEnd();
  }
}

/**
 * Cuts the tail of an answer at a paragraph that shouldn't be there (FC-219): with a list up and a question that
 * isn't about it, the model kept ending answers with the list's progress — "What's on your plate: 200 belts…" —
 * whatever the notes said, because the previous turn's answer had it. The first paragraph always streams; each
 * later one is held until its first sentence (or `peek` characters) is in, judged against the patterns, and either
 * released or dropped with everything after it.
 */
export class TailCutFilter {
  private emitted = "";
  private held = "";
  private paragraphs = 0;
  private judging = false;
  cut = false;

  constructor(private readonly patterns: RegExp[], private readonly peek = 120) {}

  private offends(text: string): boolean {
    return this.patterns.some((p) => p.test(text));
  }

  /** Text that is safe to show now. */
  push(text: string): string {
    if (this.cut || !text) return "";
    this.held += text;
    let out = "";
    for (;;) {
      if (!this.judging) {
        const gap = this.held.search(/\n\s*\n/);
        if (gap < 0) { out += this.held; this.held = ""; break; }
        const boundary = gap + this.held.slice(gap).match(/\n\s*\n/)![0].length;
        out += this.held.slice(0, boundary);
        this.held = this.held.slice(boundary);
        this.paragraphs++;
        this.judging = true;
      }
      // A paragraph under judgement: wait for its first sentence or enough of it to know.
      const sentenceEnd = this.held.search(/[.!?:](\s|$)/);
      if (sentenceEnd < 0 && this.held.length < this.peek) break;
      const seen = sentenceEnd >= 0 ? this.held.slice(0, sentenceEnd + 1) : this.held;
      if (this.offends(seen)) { this.cut = true; this.held = ""; break; }
      this.judging = false; // released: the rest of this paragraph streams as it comes
    }
    this.emitted += out;
    return out;
  }

  /** What's left when the answer ends: a held paragraph start that never offended. */
  end(): string {
    if (this.cut) return "";
    const rest = this.offends(this.held) ? "" : this.held;
    if (!rest && this.held) this.cut = true;
    this.emitted += rest;
    this.held = "";
    return rest;
  }

  /** Everything shown so far. */
  text(): string {
    return this.emitted.trimEnd();
  }
}

/** A paragraph that reports the player's list when the question wasn't about it (FC-219). */
export const LIST_REPORT = [
  /\b\d+ of \d+ (ticked|done|checked)\b/i,
  /\b(packing )?list\b.*\b(ticked|done|short|unaccounted|missing|left)\b/i,
  /what'?s (on your plate|left on the list|still short)/i,
  /\b(still|remain|remaining) (short|unaccounted|missing|outstanding)\b/i,
  /\bunaccounted\b/i,
];
