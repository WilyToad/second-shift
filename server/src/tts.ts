// ElevenLabs voices for "Read answers aloud" (FC-148). The console asks this server for speech; the server holds the
// API key (ELEVENLABS_API_KEY, e.g. in a gitignored .env that Bun loads) and streams the audio back, so the key never
// reaches the page. Opt-in: answer text goes to ElevenLabs, and the console says so.
// API: POST /v1/text-to-speech/{voice_id}/stream (xi-api-key), GET /v2/voices.

const API = "https://api.elevenlabs.io";
/** Their lowest-latency model (~75 ms, 32 languages). */
const DEFAULT_MODEL = "eleven_flash_v2_5";
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

export class ElevenLabs {
  private voices: TtsVoice[] | null = null;

  constructor(private readonly opts: { key: string; model?: string; defaultVoice?: string; fetch?: Fetch }) {}

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
    const voice = voiceId || this.opts.defaultVoice || (await this.listVoices())[0]?.id;
    if (!voice) return new Response("No ElevenLabs voices on this account", { status: 404 });
    const res = await this.fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.opts.key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: clean, model_id: this.opts.model ?? DEFAULT_MODEL, ...(previous ? { previous_text: previous.slice(-MAX_CHARS) } : {}) }),
      signal,
    });
    if (!res.ok || !res.body) return new Response(await failure(res), { status: res.status === 401 ? 401 : 502 });
    return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
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
