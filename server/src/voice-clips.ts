// Clips of the player's own voice, kept so accuracy can be argued from their audio instead of a leaderboard
// (FC-188). Local only: `data/` is gitignored, the server binds 127.0.0.1, and nothing here sends anything out.
//
// The id is minted here, never taken from the page, so no request can name a path of its own choosing.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ClipMeta = {
  /** What the console sent as the question: the transcript that won. */
  heard: string;
  /** What the player says they actually said, once they've corrected it (FC-189 scores against this). */
  said?: string;
  /** The FC-185 record: the engine's guesses, how many phrases were applied, where it ran. */
  detail?: unknown;
  at: string;
  seconds: number;
  sampleRate: number;
};

const ID = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function mintId(now = new Date(), random = Math.random): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${random().toString(36).slice(2, 6).padStart(4, "0")}`;
}

export class VoiceClips {
  constructor(private readonly dir: string) {}

  /** Writes one clip and its sidecar, and returns the id the console uses to correct it later. */
  async save(wav: ArrayBuffer | Uint8Array, meta: Omit<ClipMeta, "at">): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const id = mintId();
    await writeFile(join(this.dir, `${id}.wav`), new Uint8Array(wav instanceof Uint8Array ? wav : new Uint8Array(wav)));
    await writeFile(join(this.dir, `${id}.json`), JSON.stringify({ ...meta, at: new Date().toISOString() }, null, 2));
    return id;
  }

  /** What the player actually said. Without this there's nothing to score a transcriber against. */
  async setTruth(id: string, said: string): Promise<boolean> {
    if (!ID.test(id)) return false; // an id we didn't mint can't name a file
    const file = Bun.file(join(this.dir, `${id}.json`));
    if (!(await file.exists())) return false;
    const meta = (await file.json()) as ClipMeta;
    await writeFile(join(this.dir, `${id}.json`), JSON.stringify({ ...meta, said: said.trim().slice(0, 500) }, null, 2));
    return true;
  }

  /** How much has been kept, for the console to show and for FC-189 to read. */
  async count(): Promise<{ clips: number; withTruth: number }> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const sidecars = names.filter((n) => n.endsWith(".json"));
    let withTruth = 0;
    for (const name of sidecars) {
      const meta = (await Bun.file(join(this.dir, name)).json().catch(() => null)) as ClipMeta | null;
      if (meta?.said) withTruth++;
    }
    return { clips: sidecars.length, withTruth };
  }
}
