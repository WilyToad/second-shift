// Sound effects for the console (FC-150), generated once with the player's ElevenLabs key into data/sounds/ (gitignored:
// generated audio follows the account's ElevenLabs terms, so it isn't committed). Without them the console plays
// simple built-in tones.
// API: POST /v1/sound-generation (xi-api-key) with text, duration_seconds (0.5-30), prompt_influence (0-1).

export type SoundName = "listen" | "sent" | "alert-critical" | "alert-warning" | "research" | "approval" | "done";

/** One short sound per moment, in the brand's voice: a quiet industrial helmet HUD, never cartoonish. */
export const SOUNDS: Record<SoundName, { prompt: string; seconds: number }> = {
  listen: { prompt: "Short soft rising two-note chime from a sci-fi helmet HUD, clean digital tone, no reverb tail", seconds: 0.6 },
  sent: { prompt: "Short soft descending blip, sci-fi helmet interface acknowledging a voice command, clean and quiet", seconds: 0.5 },
  "alert-critical": { prompt: "Two quick urgent warning beeps from an industrial factory control panel, sci-fi klaxon, short and sharp", seconds: 1 },
  "alert-warning": { prompt: "Single low muted warning tone from an industrial control console, subtle, short", seconds: 0.7 },
  research: { prompt: "Bright short success chime, three ascending notes, sci-fi laboratory research complete, clean", seconds: 1.2 },
  approval: { prompt: "Soft double tick attention ping, sci-fi interface asking for confirmation, short and quiet", seconds: 0.6 },
  done: { prompt: "Short satisfying mechanical confirm clunk with a soft chime, industrial machine accepting an order", seconds: 0.7 },
};

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Generates one sound as MP3 bytes. Throws with ElevenLabs' reason on failure. */
export async function generateSound(key: string, name: SoundName, fetchFn: Fetch = fetch): Promise<Uint8Array> {
  const { prompt, seconds } = SOUNDS[name];
  const res = await fetchFn("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, prompt_influence: 0.6 }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: { message?: string } | string };
      detail = typeof body.detail === "string" ? body.detail : body.detail?.message ?? "";
    } catch {
      // not JSON
    }
    throw new Error(`ElevenLabs ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
