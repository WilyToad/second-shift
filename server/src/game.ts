// Link to the running game: RCON connection with reconnect, typed mod actions, and a digest poller.
import { actions, encodeCommand, parseReply, type ActionArgs, type ActionData, type ActionName, type Digest } from "@companion/interfaces";
import { RconClient } from "./rcon";
import { readRconSettings } from "./factorio";

export type Snapshot = { digest: Digest; receivedAt: number };
export type GameStatus = { connected: boolean; lastError?: string; latest?: Snapshot };

export class ModError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export class GameLink {
  private rcon: RconClient | null = null;
  private nextId = 1;
  private history: Snapshot[] = [];
  private lastError: string | undefined;
  private stopped = false;
  private listeners = new Set<(s: GameStatus) => void>();

  constructor(private readonly opts: { pollMs: number; historySize: number }) {}

  /** Keeps trying to connect in the background; the server works without the game. */
  start(): void {
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.rcon?.close();
  }

  onStatus(fn: (s: GameStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  status(): GameStatus {
    return { connected: this.rcon !== null, lastError: this.lastError, latest: this.history.at(-1) };
  }

  latest(): Snapshot | undefined {
    return this.history.at(-1);
  }

  async call<A extends ActionName>(action: A, args?: ActionArgs<A>): Promise<ActionData<A>> {
    if (!this.rcon) throw new ModError("not_connected", "The game isn't connected.");
    const spec = actions[action];
    const req = { id: this.nextId++, action, args: spec.args.parse(args ?? {}) as Record<string, unknown> };
    const { reply } = parseReply(await this.rcon.exec(encodeCommand(req)));
    if (!reply.ok) throw new ModError(reply.error?.code ?? "unknown", reply.error?.message ?? "Mod returned an error");
    return spec.data.parse(reply.data) as ActionData<A>;
  }

  private emit(): void {
    const s = this.status();
    for (const fn of this.listeners) fn(s);
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (!this.rcon) {
        try {
          const settings = await readRconSettings();
          if (!settings) throw new Error("RCON isn't enabled in config.ini");
          this.rcon = await RconClient.connect({ ...settings, timeoutMs: 10_000 });
          this.lastError = undefined;
          this.emit();
        } catch (e) {
          this.rcon = null;
          this.lastError = (e as Error).message;
          this.emit();
          await Bun.sleep(3000);
          continue;
        }
      }
      try {
        const digest = await this.call("digest");
        this.history.push({ digest, receivedAt: Date.now() });
        if (this.history.length > this.opts.historySize) this.history.shift();
        this.emit();
      } catch (e) {
        this.lastError = (e as Error).message;
        if (!(e instanceof ModError)) { this.rcon?.close(); this.rcon = null; }
        this.emit();
      }
      await Bun.sleep(this.opts.pollMs);
    }
  }
}
