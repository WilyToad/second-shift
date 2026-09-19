// Keeping the player's own voice, so a transcriber can be argued about with evidence (FC-188).
//
// The recognizer never hands back the audio it heard, so this taps the microphone in parallel through an
// `AudioWorklet` — `MediaRecorder` only gives Opus, and every candidate transcriber wants 16 kHz mono PCM. Two
// consumers of one microphone is allowed in Chrome; where it isn't, capturing fails with a message and voice carries
// on untouched.
//
// Off by default, and the console says plainly that the audio is being written to disk. It goes to the local server
// only, into gitignored `data/`, and the clip is written *after* the question has gone out so it can't add delay.
import { signal } from "@preact/signals";

/** 16 kHz mono is what whisper.cpp, Parakeet and Moonshine all take. */
export const TARGET_RATE = 16000;
const MAX_CLIP_S = 30;
const RING_S = 60;
/** Speech starts before the recognizer reports anything, so the clip reaches back before the first result. */
const ONSET_S = 1.5;

export const capturing = signal(load());
export const captureError = signal<string | null>(null);
/** The last clip written, so the player can say what they actually said while they still remember. */
export const lastClip = signal<{ id: string; heard: string } | null>(null);
export const clipCount = signal<{ clips: number; withTruth: number } | null>(null);

function load(): boolean {
  try {
    return globalThis.localStorage?.getItem("second-shift.capture") === "true";
  } catch {
    return false;
  }
}

/**
 * Down to 16 kHz by averaging each window of input samples. A box filter is a crude anti-alias, and good enough for
 * clips a transcriber will resample again anyway — said out loud here so nobody mistakes it for signal processing.
 */
export function resample(samples: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from === to || !samples.length) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j]!;
    out[i] = sum / (end - start);
  }
  return out;
}

/** A 16-bit PCM WAV, header and all, because that's what every candidate reads without conversion. */
export function wav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("second-shift-tap", Tap);
`;

type Mic = { ctx: { close(): Promise<void>; sampleRate: number }; stop: () => void };
let mic: Mic | null = null;
let ring: Float32Array | null = null;
let written = 0;
let rate = 48000;
let startedAt: number | null = null;

function append(chunk: Float32Array): void {
  if (!ring) return;
  for (let i = 0; i < chunk.length; i++) ring[(written + i) % ring.length] = chunk[i]!;
  written += chunk.length;
}

/** Everything heard since the mark, oldest first, capped so a long ramble can't write a huge file. */
function since(mark: number): Float32Array {
  if (!ring) return new Float32Array(0);
  const from = Math.max(mark, written - ring.length, written - rate * MAX_CLIP_S, 0);
  const out = new Float32Array(Math.max(0, written - from));
  for (let i = 0; i < out.length; i++) out[i] = ring[(from + i) % ring.length]!;
  return out;
}

/** Opens the microphone tap. Returns an error message if this browser won't allow a second consumer. */
export async function startCapture(): Promise<string | null> {
  if (mic) return null;
  const media = (globalThis as { navigator?: { mediaDevices?: { getUserMedia(c: unknown): Promise<MediaStream> } } }).navigator?.mediaDevices;
  const Ctx = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
  if (!media || !Ctx) return "This browser can't record audio, so clips can't be kept.";
  try {
    const stream = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new Ctx();
    rate = ctx.sampleRate;
    ring = new Float32Array(Math.ceil(rate * RING_S));
    written = 0;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(ctx, "second-shift-tap");
    tap.port.onmessage = (e: MessageEvent) => append(e.data as Float32Array);
    // A worklet nobody pulls from may never run, so it ends at the speakers through a silent gain.
    const silence = ctx.createGain();
    silence.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(tap).connect(silence).connect(ctx.destination);
    mic = { ctx, stop: () => stream.getTracks().forEach((t) => t.stop()) };
    return null;
  } catch (e) {
    return `Couldn't keep audio: ${(e as Error).message}`;
  }
}

export async function stopCapture(): Promise<void> {
  const open = mic;
  mic = null;
  ring = null;
  startedAt = null;
  if (!open) return;
  open.stop();
  await open.ctx.close().catch(() => {});
}

export async function setCapturing(on: boolean): Promise<void> {
  captureError.value = null;
  if (on) {
    const error = await startCapture();
    if (error) { captureError.value = error; capturing.value = false; return; }
  } else {
    await stopCapture();
  }
  capturing.value = on;
  try {
    globalThis.localStorage?.setItem("second-shift.capture", String(on));
  } catch {
    // a per-browser convenience
  }
}

/**
 * Opens the tap if the setting is on and it isn't open yet (FC-207). The setting survives a reload but the tap
 * didn't: it was only opened when the checkbox *changed*, so after a reload the console said "your voice is being
 * written" while nothing was — the player's first session kept zero clips. Called when talking starts, which is a
 * user gesture, so the browser's microphone prompt is allowed.
 */
export async function ensureCapture(): Promise<void> {
  if (!capturing.value || mic) return;
  const error = await startCapture();
  if (error) { captureError.value = error; capturing.value = false; }
}

/** The player has started saying something: the clip begins a little before this, to catch the first word. */
export function markUtterance(): void {
  if (!mic || startedAt !== null) return;
  startedAt = Math.max(0, written - Math.floor(rate * ONSET_S));
}

/**
 * Writes the clip for the question that just went out. Called after the send, never before it, and it swallows its
 * own failures: losing a diagnostic clip must never cost the player their question.
 */
export async function keepClip(heard: string, detail: unknown): Promise<void> {
  const mark = startedAt;
  startedAt = null;
  if (!mic || mark === null || !capturing.value) return;
  try {
    const samples = resample(since(mark), rate);
    if (samples.length < TARGET_RATE / 4) return; // under a quarter second: nothing worth keeping
    const body = new FormData();
    body.append("audio", new Blob([wav(samples) as unknown as BlobPart], { type: "audio/wav" }), "clip.wav");
    body.append("meta", JSON.stringify({ heard, detail, seconds: Number((samples.length / TARGET_RATE).toFixed(2)), sampleRate: TARGET_RATE }));
    const res = await fetch("/capture/voice", { method: "POST", body });
    const saved = (await res.json()) as { id?: string; clips?: number; withTruth?: number };
    if (saved.id) lastClip.value = { id: saved.id, heard };
    if (typeof saved.clips === "number") clipCount.value = { clips: saved.clips, withTruth: saved.withTruth ?? 0 };
  } catch (e) {
    captureError.value = `Couldn't keep that clip: ${(e as Error).message}`;
  }
}

/** What the player actually said, against the clip they just heard go wrong. */
export async function sayTruth(said: string): Promise<boolean> {
  const clip = lastClip.value;
  if (!clip || !said.trim()) return false;
  try {
    const res = await fetch("/capture/truth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: clip.id, said }) });
    const out = (await res.json()) as { ok?: boolean; clips?: number; withTruth?: number };
    if (typeof out.clips === "number") clipCount.value = { clips: out.clips, withTruth: out.withTruth ?? 0 };
    if (out.ok) lastClip.value = null;
    return Boolean(out.ok);
  } catch {
    return false;
  }
}
