// Local transcription (FC-230): the player's voice turned into text on this Mac, by whisper.cpp's server kept
// resident beside oMLX. FC-189 measured it on the player's own clips — 19 of 24 exact, 120 ms a clip — and found
// its two costs: the model load (~15 s, so it stays up), and Whisper's habit of inventing "Thank you." on silence
// (so every clip goes through the VAD, and a short list of its known inventions is refused outright).
//
// Absent without complaint: if whisper.cpp or the model isn't installed, `available()` says why and the console
// keeps using the browser's transcript, exactly as before.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STT_PORT = Number(process.env.WHISPER_PORT) || 8890;
const MODEL_DIR = `${process.env.HOME}/.cache/whisper`;
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? `${MODEL_DIR}/ggml-large-v3-turbo.bin`;
export const VAD_MODEL = process.env.WHISPER_VAD_MODEL ?? `${MODEL_DIR}/ggml-silero-v5.1.2.bin`;
const START_TIMEOUT_MS = 90_000;
const RESTART_BACKOFF_MS = [2_000, 10_000, 30_000, 60_000];

/**
 * What Whisper says when it heard nothing: its training data's end-of-video lines. A clip that decodes to one of
 * these, and nothing else, was silence or noise (the "Ballastral" clip came back as "Thank you." in FC-189).
 */
const INVENTED = [/^thank(s| you)( for watching)?[.!]?$/i, /^thanks for (watching|listening)[.!]?$/i, /^(subtitles|captions) by .+$/i, /^you[.!]?$/i, /^\.+$/, /^bye[.!]?$/i, /^(please )?(like and )?subscribe.*$/i];

export function looksInvented(text: string): boolean {
  const t = text.trim();
  return !t || INVENTED.some((re) => re.test(t));
}

/** Root-mean-square of 16-bit PCM, 0–1: a clip below ~0.003 is the room, not the player. */
export function loudness(wav: Uint8Array): number {
  const data = wav.byteLength > 44 ? new Int16Array(wav.buffer, wav.byteOffset + 44, Math.floor((wav.byteLength - 44) / 2)) : new Int16Array(0);
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / data.length) / 32768;
}
export const QUIET = 0.003;

export type Transcript = { text: string; ms: number; engine: "whisper.cpp" } | { text: ""; ms: number; engine: "whisper.cpp"; gated: "quiet" | "no-speech" | "invented" };

/** How long whisper-server may sit idle before a warm-up clip goes through it (FC-232). */
export const KEEP_WARM_MS = 3 * 60_000;

/**
 * A short clip of the Mac's own voice, made once with `say`, for keeping the model paged in (FC-232). Nothing the
 * player said is reused for this. Null where `say` isn't available.
 */
export function warmupClip(): Uint8Array | null {
  const dir = mkdtempSync(join(tmpdir(), "second-shift-warm-"));
  const path = join(dir, "warm.wav");
  try {
    const r = Bun.spawnSync(["say", "-o", path, "--file-format=WAVE", "--data-format=LEI16@16000", "keeping the transcriber warm"]);
    if (r.exitCode !== 0 || !existsSync(path)) return null;
    const bytes = new Uint8Array(readFileSync(path));
    return bytes.length > 44 ? bytes : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class WhisperService {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private ready = false;
  private lastCall = 0;
  private warm: Uint8Array | null = null;
  private warmTimer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;
  private failures = 0;
  private stopped = false;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  /** Why it can't run, or null when it can. Checked without starting anything. */
  static missing(): string | null {
    if (!Bun.which("whisper-server")) return "whisper-server isn't installed (brew install whisper.cpp)";
    if (!existsSync(WHISPER_MODEL)) return `no model at ${WHISPER_MODEL}`;
    return null;
  }

  status(): { available: boolean; ready: boolean; reason?: string; model: string; vad: boolean } {
    const reason = WhisperService.missing();
    return { available: !reason, ready: this.ready, ...(reason ? { reason } : {}), model: WHISPER_MODEL.split("/").pop() ?? "", vad: existsSync(VAD_MODEL) };
  }

  /** Brings the server up if it can, once; later calls wait on the same start. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.spawn().then(() => this.keepWarm());
    return this.starting;
  }

  /**
   * The first call after the model has sat idle runs the whole model back in: 356 ms after startup, 526 ms after
   * 17 minutes, 666 ms after 30 — against ~130 ms warm, and a 700 ms wait after which the browser's text goes
   * instead (FC-232). A short clip through it every few idle minutes keeps it at ~130 ms.
   */
  private keepWarm(): void {
    if (!this.ready || this.warmTimer) return;
    this.warm ??= warmupClip();
    if (!this.warm) { this.log("Local transcription: no warm-up clip (`say` unavailable); the first call after idling will be slow."); return; }
    const warm = this.warm;
    const tick = async () => {
      if (!this.ready || Date.now() - this.lastCall < KEEP_WARM_MS) return;
      const started = performance.now();
      await this.post(warm);
      const ms = performance.now() - started;
      this.lastCall = Date.now();
      if (ms > 300) this.log(`Local transcription warm-up took ${ms.toFixed(0)} ms.`);
    };
    this.warmTimer = setInterval(() => void tick(), KEEP_WARM_MS);
    this.warmTimer.unref?.();
    void tick();
    this.log(`Local transcription kept warm every ${KEEP_WARM_MS / 60_000} idle minutes.`);
  }

  private async post(wav: Uint8Array, prompt?: string): Promise<{ text?: string } | null> {
    const form = new FormData();
    form.append("file", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "clip.wav");
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (prompt) form.append("prompt", prompt);
    try {
      const res = await fetch(`http://127.0.0.1:${STT_PORT}/inference`, { method: "POST", body: form });
      if (!res.ok) return null;
      return (await res.json().catch(() => ({}))) as { text?: string };
    } catch {
      return null;
    }
  }

  private async spawn(): Promise<void> {
    const reason = WhisperService.missing();
    if (reason) { this.log(`Local transcription off: ${reason}.`); return; }
    const vad = existsSync(VAD_MODEL) ? ["--vad", "-vm", VAD_MODEL] : [];
    if (!vad.length) this.log(`Local transcription: no VAD model at ${VAD_MODEL}; silence is judged by loudness only.`);
    // One already answering on the port — left by a server that died without cleaning up (FC-238) — is used as is,
    // rather than starting a second that can't bind and restarts forever.
    try { const r = await fetch(`http://127.0.0.1:${STT_PORT}/`); if (r.status < 500) { this.ready = true; this.log(`Local transcription ready: using the whisper-server already on :${STT_PORT}.`); return; } } catch {}
    this.proc = Bun.spawn(["whisper-server", "-m", WHISPER_MODEL, "--host", "127.0.0.1", "--port", String(STT_PORT), "-l", "en", "-nth", "0.6", ...vad], { stdout: "ignore", stderr: "ignore" });
    const proc = this.proc;
    proc.exited.then((code) => {
      if (this.proc !== proc) return;
      this.ready = false;
      this.proc = null;
      this.starting = null;
      if (this.stopped) return;
      const wait = RESTART_BACKOFF_MS[Math.min(this.failures, RESTART_BACKOFF_MS.length - 1)]!;
      this.failures++;
      this.log(`whisper-server exited (${code}); starting it again in ${wait / 1000} s.`);
      setTimeout(() => void this.start(), wait);
    });
    const started = performance.now();
    while (performance.now() - started < START_TIMEOUT_MS) {
      if (this.proc !== proc) return;
      try { const r = await fetch(`http://127.0.0.1:${STT_PORT}/`); if (r.status < 500) { this.ready = true; this.failures = 0; this.log(`Local transcription ready: whisper-server on :${STT_PORT} in ${((performance.now() - started) / 1000).toFixed(1)} s (${vad.length ? "VAD on" : "no VAD"}).`); return; } } catch {}
      await Bun.sleep(500);
    }
    this.log("whisper-server didn't answer within 90 s; giving up on it until restart.");
    proc.kill();
  }

  stop(): void {
    this.stopped = true;
    if (this.warmTimer) { clearInterval(this.warmTimer); this.warmTimer = null; }
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
  }

  /** The clip's text, or the reason it was refused. Never throws; a server that's down returns null. */
  async transcribe(wav: Uint8Array, prompt?: string): Promise<Transcript | null> {
    if (!this.ready) return null;
    const started = performance.now();
    if (loudness(wav) < QUIET) return { text: "", ms: performance.now() - started, engine: "whisper.cpp", gated: "quiet" };
    this.lastCall = Date.now();
    const json = await this.post(wav, prompt);
    if (!json) return null;
    const text = (json.text ?? "").trim();
    const ms = performance.now() - started;
    if (!text) return { text: "", ms, engine: "whisper.cpp", gated: "no-speech" };
    if (looksInvented(text)) return { text: "", ms, engine: "whisper.cpp", gated: "invented" };
    return { text, ms, engine: "whisper.cpp" };
  }
}
