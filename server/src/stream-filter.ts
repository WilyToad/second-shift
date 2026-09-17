// Removes blocks from a streamed answer that the player must never see: a rate_chart block on a turn that doesn't
// allow charts (FC-111, the model is told "no chart block" but sometimes writes one anyway and the page would draw
// it), and a tool call the model wrote as text (FC-184, which reached one player as their entire answer).
const FENCE = "```";
type Block = { open: string; close: string };
const BLOCKS: Block[] = [
  { open: "```rate_chart", close: FENCE },
  { open: "<tool_call>", close: "</tool_call>" },
];

export class ChartBlockFilter {
  private pending = "";
  private inBlock: Block | null = null;

  /** How much of the tail could still grow into an opening marker, and so has to wait for the next token. */
  private held(): number {
    let keep = 0;
    for (const block of BLOCKS) {
      for (let k = Math.min(block.open.length - 1, this.pending.length); k > keep; k--) {
        if (this.pending.slice(-k) === block.open.slice(0, k)) { keep = k; break; }
      }
    }
    return keep;
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
      for (const block of BLOCKS) {
        const i = this.pending.indexOf(block.open);
        if (i >= 0 && (at < 0 || i < at)) { at = i; hit = block; }
      }
      if (hit) {
        out += this.pending.slice(0, at);
        this.pending = this.pending.slice(at + hit.open.length);
        this.inBlock = hit;
        continue;
      }
      const keep = this.held();
      out += this.pending.slice(0, this.pending.length - keep);
      this.pending = this.pending.slice(this.pending.length - keep);
      return out;
    }
  }

  /** What's left when the answer ends; an unfinished block is dropped. A bare marker prefix can no longer grow
   * into one, so it's ordinary text and passes through (an answer really can end on a backtick). */
  end(): string {
    const rest = this.inBlock ? "" : this.pending;
    this.pending = "";
    this.inBlock = null;
    return rest;
  }
}

export function stripChartBlocks(text: string): string {
  const filter = new ChartBlockFilter();
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
