// Link to the running game: RCON connection with reconnect, typed mod actions, and a digest poller.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { actions, encodeCommand, parseReply, PrototypesSchema, type ActionArgs, type ActionData, type ActionName, type Digest, type Prototypes } from "@companion/interfaces";
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
  private history: Snapshot[] = [];
  private lastError: string | undefined;
  private stopped = false;
  private listeners = new Set<(s: GameStatus) => void>();
  private prototypeListeners = new Set<(p: LoadedPrototypes) => void>();
  private loaded: LoadedPrototypes | null = null;

  constructor(private readonly opts: { pollMs: number; historySize: number; cacheDir: string; settings?: () => Promise<RconSettings | null> }) {}

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

  /** Refetches prototype data only when the game's mod list differs from what's loaded. */
  private async syncPrototypes(): Promise<void> {
    const info = await this.call("info");
    const modsKey = String(Bun.hash(JSON.stringify(Object.entries(info.mods).sort())));
    if (this.loaded?.modsKey === modsKey) return;
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
  }

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
