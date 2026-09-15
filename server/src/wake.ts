// FC-158: oMLX goes idle about 3 s after its last request, and the next question then waits ~1.5 s (2.7 s with the game
// running) before prefill starts (scripts/probes/wake.ts). A 1-token request on a one-word prompt wakes it and doesn't
// touch the conversation's cached blocks, so the console asks for one every ~1.2 s while the player talks or types.

export const MIN_WAKE_GAP_MS = 1_000;

export class ModelWaker {
  private lastAt = -Infinity;
  private pending = false;

  constructor(
    private readonly ping: () => Promise<unknown>,
    /** True while a turn is running: the model is awake anyway, and a ping would only queue behind it. */
    private readonly busy: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  /** Sends a wake-up unless one is in flight, one went out just now, or a turn is running. Returns whether it sent. */
  wake(): boolean {
    if (this.pending || this.busy() || this.now() - this.lastAt < MIN_WAKE_GAP_MS) return false;
    this.lastAt = this.now();
    this.pending = true;
    this.ping()
      .catch(() => {}) // the model may be loading or down; the question itself reports that
      .finally(() => { this.pending = false; });
    return true;
  }
}
