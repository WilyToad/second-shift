// ElevenLabs voices for "Read answers aloud" (FC-148). The console asks this server for speech; the server holds the
// API key (ELEVENLABS_API_KEY, e.g. in a gitignored .env that Bun loads) and streams the audio back, so the key never
// reaches the page. Opt-in: answer text goes to ElevenLabs, and the console says so.
// API: POST /v1/text-to-speech/{voice_id}/stream (xi-api-key), GET /v2/voices.

const API = "https://api.elevenlabs.io";
/**
 * Eleven v4 Turbo: it acts delivery cues like `[sighs]` (FC-259, FC-260). The player heard it against Kokoro and
 * full v4 — "MUCH more immersive than Kokoro", no audible difference from full v4 — and it's a second faster than v4 to
 * a whole clip. `ELEVENLABS_MODEL=eleven_flash_v2_5` is the old, faster (380 ms) and cue-less choice.
 */
export const DEFAULT_MODEL = "eleven_v4_turbo";
/** Adam: the ElevenLabs voice the player heard in both listening tests (FC-253, FC-259). */
export const DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";
const MAX_CHARS = 600;

export type TtsVoice = { id: string; name: string; category?: string };

/**
 * ElevenLabs' standard voices, for keys limited to speech (no `voices_read` permission): the voice list is refused but
 * these still speak. Each ID was checked against the API with a one-word request (2026-09-15).
 */
export const STANDARD_VOICES: TtsVoice[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger" },
].map((v) => ({ ...v, category: "premade" }));
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function elevenLabsKey(env: Record<string, string | undefined> = process.env): string | null {
  // ELEVENLABS_API_KEY is ElevenLabs' own name for it; ELEVEN_LABS_KEY is accepted too.
  const key = (env.ELEVENLABS_API_KEY ?? env.ELEVEN_LABS_KEY)?.trim();
  return key ? key : null;
}

/**
 * ElevenLabs requests in flight at once. The player's plan allows 5 and answered a sixth with a 429 ("Too many
 * concurrent requests") in their first session on v4 (FC-260): the console asks for every sentence as it arrives, and
 * a streamed sentence holds its request open while it plays. One spare for anything else using the key.
 */
export const MAX_CONCURRENT = 4;
/** Waits before retrying a 429 — the limit is transient, so a short wait beats dropping to the browser's voice. */
const RETRY_MS = [400, 1200];

/** Hands the body on unchanged, and calls `done` once when it ends, fails or is cancelled. */
function releasing(body: ReadableStream<Uint8Array>, done: () => void): ReadableStream<Uint8Array> {
  let released = false;
  const once = () => { if (!released) { released = true; done(); } };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) { once(); controller.close(); } else controller.enqueue(value);
      } catch (e) {
        once();
        controller.error(e);
      }
    },
    cancel(reason) {
      once();
      return reader.cancel(reason);
    },
  });
}

export class ElevenLabs {
  private voices: TtsVoice[] | null = null;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly opts: { key: string; model?: string; defaultVoice?: string; fetch?: Fetch; concurrency?: number; retryMs?: number[] }) {}

  /** A place among the requests in flight, first come first served, so sentences still start in order. */
  private async slot(signal?: AbortSignal): Promise<(() => void) | null> {
    if (this.active < (this.opts.concurrency ?? MAX_CONCURRENT)) {
      this.active++;
    } else {
      const got = await new Promise<boolean>((resolve) => {
        const turn = () => { signal?.removeEventListener("abort", gone); resolve(true); };
        const gone = () => { this.waiting = this.waiting.filter((w) => w !== turn); resolve(false); };
        this.waiting.push(turn);
        signal?.addEventListener("abort", gone, { once: true });
      });
      if (!got) return null;
    }
    // A place is handed straight to the next in line, so `active` only drops when nobody is waiting.
    return () => { const next = this.waiting.shift(); if (next) next(); else this.active--; };
  }

  /** The voice used when the console doesn't name one, and the one a browser that never chose starts on. */
  get defaultVoice(): string {
    return this.opts.defaultVoice || DEFAULT_VOICE;
  }

  private get fetch(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  /** The account's voices, fetched once. Throws with ElevenLabs' own message when the key is refused. */
  async listVoices(): Promise<TtsVoice[]> {
    if (this.voices) return this.voices;
    const res = await this.fetch(`${API}/v2/voices?page_size=100&sort=name&sort_direction=asc`, { headers: { "xi-api-key": this.opts.key } });
    if (!res.ok) {
      const message = await failure(res);
      // A key without voices_read can still speak: offer the standard voices instead of nothing.
      if (res.status === 401 && /voices_read/.test(message)) return (this.voices = STANDARD_VOICES);
      throw new Error(message);
    }
    const body = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
    this.voices = (body.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
    return this.voices;
  }

  /** Streams MP3 audio for one piece of an answer. `previous` keeps the delivery continuous across sentences. */
  async speak(text: string, voiceId: string | undefined, previous?: string, signal?: AbortSignal): Promise<Response> {
    const clean = text.trim().slice(0, MAX_CHARS);
    if (!clean) return new Response("Nothing to say", { status: 400 });
    const voice = voiceId || this.defaultVoice;
    const release = await this.slot(signal);
    if (!release) return new Response("Cancelled", { status: 499 });
    let res: Response;
    try {
      for (let attempt = 0; ; attempt++) {
        res = await this.fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": this.opts.key, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text: clean, model_id: this.opts.model ?? DEFAULT_MODEL, ...(previous ? { previous_text: previous.slice(-MAX_CHARS) } : {}) }),
          signal,
        });
        const wait = (this.opts.retryMs ?? RETRY_MS)[attempt];
        if (res.status !== 429 || wait === undefined || signal?.aborted) break;
        await res.body?.cancel();
        await Bun.sleep(wait);
      }
    } catch (e) {
      release();
      throw e;
    }
    if (!res.ok || !res.body) { release(); return new Response(await failure(res), { status: res.status === 401 ? 401 : 502 }); }
    // The place is held until the audio has all come through — that's when ElevenLabs counts the request as done.
    return new Response(releasing(res.body, release), { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  }
}

async function failure(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: { message?: string; status?: string } | string };
    detail = typeof body.detail === "string" ? body.detail : body.detail?.message ?? body.detail?.status ?? "";
  } catch {
    // not JSON
  }
  return `ElevenLabs ${res.status}${detail ? `: ${detail}` : ""}`;
}
