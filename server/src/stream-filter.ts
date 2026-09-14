// Removes rate_chart blocks from a streamed answer when the turn doesn't allow charts (FC-111). The model is told
// "no chart block" but sometimes writes one anyway; the page would draw it, so code enforces the rule.
const OPEN = "```rate_chart";
const FENCE = "```";

export class ChartBlockFilter {
  private pending = "";
  private inBlock = false;

  /** Text that is safe to show now. Anything that might still turn into a chart block is held back. */
  push(text: string): string {
    let out = "";
    this.pending += text;
    while (this.pending) {
      if (this.inBlock) {
        const end = this.pending.indexOf(FENCE);
        if (end < 0) {
          this.pending = this.pending.slice(-(FENCE.length - 1)); // a closing fence may be split across tokens
          return out;
        }
        this.pending = this.pending.slice(end + FENCE.length);
        this.inBlock = false;
        continue;
      }
      const tick = this.pending.indexOf("`");
      if (tick < 0) {
        out += this.pending;
        this.pending = "";
        break;
      }
      out += this.pending.slice(0, tick);
      this.pending = this.pending.slice(tick);
      if (this.pending.startsWith(OPEN)) {
        this.pending = this.pending.slice(OPEN.length);
        this.inBlock = true;
        continue;
      }
      if (OPEN.startsWith(this.pending)) break; // could still become a chart block: wait for more
      out += this.pending[0];
      this.pending = this.pending.slice(1);
    }
    return out;
  }

  /** What's left when the answer ends; an unfinished chart block is dropped. */
  end(): string {
    const rest = this.inBlock ? "" : this.pending;
    this.pending = "";
    this.inBlock = false;
    return rest;
  }
}

export function stripChartBlocks(text: string): string {
  const filter = new ChartBlockFilter();
  return (filter.push(text) + filter.end()).replace(/\n{3,}/g, "\n\n").trimEnd();
}
