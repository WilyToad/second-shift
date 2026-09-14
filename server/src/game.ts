// Link to the running game: RCON connection with reconnect, typed mod actions, and a digest poller.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { actions, encodeCommand, parseReply, PrototypesSchema, type ActionArgs, type ActionData, type ActionName, type Digest, type GameEvent, type Prototypes } from "@companion/interfaces";
import { RconClient } from "./rcon";
import { readRconSettings, type RconSettings } from "./factorio";

export type Snapshot = { digest: Digest; receivedAt: number };
export type LoadedPrototypes = { modsKey: string; data: Prototypes; source: "game" | "cache" };
export type GameStatus = { connected: boolean; lastError?: string; latest?: Snapshot };

export class ModError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export class GameLink {
  private rcon: RconClient | null = null;
  private nextId = 1;
  private historyStore: Snapshot[] = [];
  private lastError: string | undefined;
  private stopped = false;
  private listeners = new Set<(s: GameStatus) => void>();
  private prototypeListeners = new Set<(p: LoadedPrototypes) => void>();
  private eventListeners = new Set<(e: GameEvent[], dropped: number) => void>();
  private eventSeq: number | null = null;
  private recentEvents: GameEvent[] = [];
  private refreshRequested = false;
  private loaded: LoadedPrototypes | null = null;

  constructor(private readonly opts: { pollMs: number; eventPollMs?: number; historySize: number; cacheDir: string; settings?: () => Promise<RconSettings | null> }) {}

  /** New urgent events as they arrive (alert feed). */
  onEvents(fn: (e: GameEvent[], dropped: number) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** The last events seen, for pages that connect later. */
  events(): GameEvent[] {
    return [...this.recentEvents];
  }

  /** Snapshot history, oldest first (for charts). */
  history(): Snapshot[] {
    return [...this.historyStore];
  }

  /** Recipe data from the last game session, so the server can ground answers before the game connects. */
  async loadCachedPrototypes(): Promise<LoadedPrototypes | null> {
    const file = Bun.file(join(this.opts.cacheDir, "prototypes.json"));
    if (!(await file.exists())) return null;
    try {
      const cached = (await file.json()) as { modsKey: string; data: unknown };
      this.setPrototypes({ modsKey: cached.modsKey, data: PrototypesSchema.parse(cached.data), source: "cache" });
    } catch (e) {
      console.warn("Ignoring unreadable prototype cache:", (e as Error).message);
    }
    return this.loaded;
  }

  prototypes(): LoadedPrototypes | null {
    return this.loaded;
  }

  onPrototypes(fn: (p: LoadedPrototypes) => void): () => void {
    this.prototypeListeners.add(fn);
    return () => this.prototypeListeners.delete(fn);
  }

  private setPrototypes(p: LoadedPrototypes): void {
    this.loaded = p;
    for (const fn of this.prototypeListeners) fn(p);
  }

  /** Refetches prototype data when the mod list or dump format changed, or when `force` is set
   * (a research completed, so recipe unlocks and productivity bonuses changed). */
  private async syncPrototypes(force = false): Promise<void> {
    const info = await this.call("info");
    // The mod list plus the dump format: either changing means the cached prototypes are stale.
    const modsKey = String(Bun.hash(JSON.stringify([info.dump_version, ...Object.entries(info.mods).sort()])));
    if (!force && this.loaded?.modsKey === modsKey) return;
    const started = performance.now();
    const data = await this.call("dump_prototypes");
    mkdirSync(this.opts.cacheDir, { recursive: true });
    await Bun.write(join(this.opts.cacheDir, "prototypes.json"), JSON.stringify({ modsKey, data }));
    console.log(`Loaded prototypes from the game (${Object.keys(data.recipes).length} recipes, ${(performance.now() - started).toFixed(0)} ms).`);
    this.setPrototypes({ modsKey, data, source: "game" });
  }

  /** Drops the connection; the loop reconnects (and re-checks the mod list). */
  disconnect(): void {
    this.rcon?.close();
    this.rcon = null;
    this.eventSeq = null;
  }

  /** Keeps trying to connect in the background; the server works without the game. */
  start(): void {
    void this.loop();
    void this.eventLoop();
  }

  /** Polls "events since N" on its own cadence so alerts arrive fast without a bigger digest poll. */
  private async eventLoop(): Promise<void> {
    while (!this.stopped) {
      if (this.rcon) {
        try {
          const r = await this.call("events", { since: this.eventSeq ?? 0 });
          // First poll after (re)connect: remember where we are without replaying old events.
          if (this.eventSeq === null || r.seq < this.eventSeq) this.eventSeq = r.seq;
          else if (r.events.length) {
            // The mod keeps 200 events; if more happened between polls the oldest are gone.
            const dropped = Math.max(0, r.oldest - (this.eventSeq + 1));
            this.eventSeq = r.seq;
            this.recentEvents = [...this.recentEvents, ...r.events].slice(-50);
            for (const fn of this.eventListeners) fn(r.events, dropped);
            if (r.events.some((e) => e.kind === "research_finished")) this.refreshRequested = true;
          }
        } catch {
          // The digest loop owns reconnects; just try again next tick.
        }
      }
      await Bun.sleep(this.opts.eventPollMs ?? 250);
    }
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
    return { connected: this.rcon !== null, lastError: this.lastError, latest: this.historyStore.at(-1) };
  }

  latest(): Snapshot | undefined {
    return this.historyStore.at(-1);
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
          const settings = await (this.opts.settings ?? readRconSettings)();
          if (!settings) throw new Error("RCON isn't enabled in config.ini");
          this.rcon = await RconClient.connect({ ...settings, timeoutMs: 10_000 });
          await this.syncPrototypes();
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
        if (this.refreshRequested) {
          this.refreshRequested = false;
          await this.syncPrototypes(true);
        }
        const digest = await this.call("digest");
        this.historyStore.push({ digest, receivedAt: Date.now() });
        if (this.historyStore.length > this.opts.historySize) this.historyStore.shift();
        this.emit();
      } catch (e) {
        this.lastError = (e as Error).message;
        if (!(e instanceof ModError)) { this.rcon?.close(); this.rcon = null; this.eventSeq = null; }
        this.emit();
      }
      await Bun.sleep(this.opts.pollMs);
    }
  }
}
