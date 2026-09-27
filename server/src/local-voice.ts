// Read-aloud in a local voice (FC-254): Kokoro-82M, resident beside the Bun server the way whisper-server is
// (FC-230). FC-253 measured it here — 152 ms p50 from request to playable audio, 535 MB, no cost to the model's
// first token — and the player preferred it blind over ElevenLabs, choosing `am_michael` as Ballast's voice.
//
// The sidecar is `scripts/lib/kokoro-server.py`, run from the gitignored `.venv-tts/`. Absent without complaint: if
// the venv isn't installed, `missing()` says why and read-aloud offers the browser voice and ElevenLabs as before.
//
// Voices are asked for as `kokoro:<name>` on the same `/tts` route ElevenLabs uses, so the console's player needs
// no second code path: it posts a sentence and plays what comes back.
import { existsSync } from "node:fs";

export const VOICE_PORT = Number(process.env.KOKORO_PORT) || 8891;
/** Ballast's voice, the player's choice (FC-253). Warmed at startup, so the first sentence doesn't load it. */
export const BALLAST_VOICE = "am_michael";
export const PYTHON = new URL("../../.venv-tts/bin/python", import.meta.url).pathname;
export const SIDECAR = new URL("../../scripts/lib/kokoro-server.py", import.meta.url).pathname;
/** The model load plus the first compile: measured 1.1 s cached, ~8 s on a first download (FC-253). */
const START_TIMEOUT_MS = 120_000;
const RESTART_BACKOFF_MS = [2_000, 10_000, 30_000, 60_000];
/** How a voice is named on the wire, so `/tts` can tell it from an ElevenLabs voice id. */
export const PREFIX = "kokoro:";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LocalVoices = { default: string; voices: string[] };

/** "am_michael" → "Michael", with where it's from; Ballast's own voice says so. */
export function voiceLabel(name: string): string {
  const [tag, ...rest] = name.split("_");
  const who = rest.join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (name === BALLAST_VOICE) return `Ballast (${who})`;
  const where = tag?.startsWith("b") ? "British" : "American";
  return `${who} (${where})`;
}

export class LocalVoice {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private failures = 0;
  private stopped = false;
  private list: LocalVoices | null = null;

  constructor(
    private readonly log: (line: string) => void = () => {},
    private readonly opts: { fetch?: Fetch; python?: string; sidecar?: string } = {},
  ) {}

  private get fetch(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  /** Why it can't run, or null when it can. Checked without starting anything. */
  missing(): string | null {
    if (!existsSync(this.opts.python ?? PYTHON)) return "the local voice isn't installed (see the README: python3 -m venv .venv-tts)";
    if (!existsSync(this.opts.sidecar ?? SIDECAR)) return `no sidecar at ${SIDECAR}`;
    return null;
  }

  status(): { available: boolean; ready: boolean; reason?: string; voice: string } {
    const reason = this.missing();
    return { available: !reason, ready: this.ready, ...(reason ? { reason } : {}), voice: BALLAST_VOICE };
  }

  /** Brings the sidecar up if it can, once; later calls wait on the same start. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.spawn();
    return this.starting;
  }

  private async answering(): Promise<boolean> {
    try {
      const r = await this.fetch(`http://127.0.0.1:${VOICE_PORT}/health`, { signal: AbortSignal.timeout(2_000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async spawn(): Promise<void> {
    const reason = this.missing();
    if (reason) { this.log(`Local voice off: ${reason}.`); return; }
    // One already answering on the port — left by a server that died without cleaning up (FC-238) — is used as is,
    // rather than starting a second that can't bind and restarts forever.
    if (await this.answering()) { this.ready = true; this.log(`Local voice ready: using the sidecar already on :${VOICE_PORT}.`); return; }
    this.proc = Bun.spawn([this.opts.python ?? PYTHON, this.opts.sidecar ?? SIDECAR, "--port", String(VOICE_PORT), "--voice", BALLAST_VOICE], { stdout: "ignore", stderr: "ignore" });
    const proc = this.proc;
    proc.exited.then((code) => {
      if (this.proc !== proc) return;
      this.ready = false;
      this.proc = null;
      this.starting = null;
      this.list = null;
      if (this.stopped) return;
      const wait = RESTART_BACKOFF_MS[Math.min(this.failures, RESTART_BACKOFF_MS.length - 1)]!;
      this.failures++;
      this.log(`Local voice exited (${code}); starting it again in ${wait / 1000} s.`);
      setTimeout(() => void this.start(), wait);
    });
    const started = performance.now();
    while (performance.now() - started < START_TIMEOUT_MS) {
      if (this.proc !== proc) return;
      if (await this.answering()) {
        this.ready = true;
        this.failures = 0;
        this.log(`Local voice ready: Kokoro on :${VOICE_PORT} in ${((performance.now() - started) / 1000).toFixed(1)} s (${BALLAST_VOICE}).`);
        return;
      }
      await Bun.sleep(500);
    }
    this.log(`Local voice didn't answer within ${START_TIMEOUT_MS / 1000} s; giving up on it until restart.`);
    proc.kill();
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
  }

  /** The voices this install has, read from the sidecar once it's up. Null when it isn't. */
  async voices(): Promise<LocalVoices | null> {
    if (!this.ready) return null;
    if (this.list) return this.list;
    try {
      const r = await this.fetch(`http://127.0.0.1:${VOICE_PORT}/voices`, { signal: AbortSignal.timeout(5_000) });
      if (!r.ok) return null;
      this.list = (await r.json()) as LocalVoices;
      return this.list;
    } catch {
      return null;
    }
  }

  /**
   * One sentence as audio. A voice named `kokoro:<name>` or just `<name>`. The response is passed through as it
   * came — WAV — so the console's player can play it the same way it plays ElevenLabs' MP3.
   */
  async speak(text: string, voice: string | undefined, signal?: AbortSignal): Promise<Response> {
    if (!this.ready) return new Response("the local voice isn't running", { status: 503 });
    const name = (voice ?? "").startsWith(PREFIX) ? voice!.slice(PREFIX.length) : voice || BALLAST_VOICE;
    try {
      const r = await this.fetch(`http://127.0.0.1:${VOICE_PORT}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, voice: name }),
        ...(signal ? { signal } : {}),
      });
      return new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") ?? "audio/wav" } });
    } catch (e) {
      return new Response(`the local voice didn't answer: ${(e as Error).message}`, { status: 503 });
    }
  }
}
