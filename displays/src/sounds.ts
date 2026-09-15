// Sound effects in the console (FC-150): short cues for listening, alerts, research and cards. Uses the sounds
// generated with ElevenLabs (bun run sounds) when the server has them, otherwise simple built-in tones.
import { signal } from "@preact/signals";

export type Sound = "listen" | "sent" | "alert-critical" | "alert-warning" | "research" | "approval" | "done";

export const soundsOn = signal(loadOn());
/** Sounds the server has generated files for. */
export const generated = signal<Set<Sound>>(new Set());

function loadOn(): boolean {
  try {
    return globalThis.localStorage?.getItem("second-shift.sounds") !== "false";
  } catch {
    return true;
  }
}

export function setSoundsOn(on: boolean): void {
  soundsOn.value = on;
  try {
    globalThis.localStorage?.setItem("second-shift.sounds", String(on));
  } catch {
    // per-browser convenience
  }
}

export async function loadSounds(get: typeof fetch = fetch): Promise<void> {
  try {
    const body = (await (await get("/sounds")).json()) as { sounds: Sound[] };
    generated.value = new Set(body.sounds);
  } catch {
    generated.value = new Set();
  }
}

/** Minimum gap between two plays of the same sound: an attack wave shouldn't become a drum roll. */
const MIN_GAP_MS: Record<Sound, number> = { listen: 300, sent: 300, "alert-critical": 4000, "alert-warning": 6000, research: 1500, approval: 800, done: 800 };
const VOLUME = 0.45;
const lastPlayed = new Map<Sound, number>();
const cache = new Map<Sound, HTMLAudioElement>();

type Player = { file(name: Sound): void; tone(name: Sound): void };

/** Plays a sound unless sounds are off or it just played. Returns whether it played (for tests). */
export function playSound(name: Sound, now = Date.now(), player: Player = defaultPlayer): boolean {
  if (!soundsOn.value) return false;
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS[name]) return false;
  lastPlayed.set(name, now);
  if (generated.value.has(name)) player.file(name);
  else player.tone(name);
  return true;
}

export function resetSoundThrottle(): void {
  lastPlayed.clear();
}

// Built-in tones: [frequency Hz, start s, length s] notes on a soft sine or triangle.
const TONES: Record<Sound, { wave: OscillatorType; notes: [number, number, number][] }> = {
  listen: { wave: "sine", notes: [[660, 0, 0.09], [990, 0.1, 0.12]] },
  sent: { wave: "sine", notes: [[880, 0, 0.08], [587, 0.09, 0.1]] },
  "alert-critical": { wave: "triangle", notes: [[740, 0, 0.14], [740, 0.22, 0.14]] },
  "alert-warning": { wave: "triangle", notes: [[330, 0, 0.3]] },
  research: { wave: "sine", notes: [[523, 0, 0.12], [659, 0.13, 0.12], [784, 0.26, 0.2]] },
  approval: { wave: "sine", notes: [[1200, 0, 0.05], [1200, 0.1, 0.05]] },
  done: { wave: "triangle", notes: [[196, 0, 0.08], [784, 0.07, 0.16]] },
};

let context: AudioContext | null = null;

const defaultPlayer: Player = {
  file(name) {
    let audio = cache.get(name);
    if (!audio) {
      audio = new Audio(`/sounds/${name}.mp3`);
      audio.volume = VOLUME;
      cache.set(name, audio);
    }
    audio.currentTime = 0;
    audio.play().catch(() => defaultPlayer.tone(name)); // e.g. before the page has had a click
  },
  tone(name) {
    try {
      context ??= new AudioContext();
      const { wave, notes } = TONES[name];
      const start = context.currentTime + 0.01;
      for (const [freq, at, length] of notes) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = wave;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, start + at);
        gain.gain.linearRampToValueAtTime(VOLUME * 0.35, start + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
        osc.connect(gain).connect(context.destination);
        osc.start(start + at);
        osc.stop(start + at + length + 0.02);
      }
    } catch {
      // No audio output: sounds are optional.
    }
  },
};
