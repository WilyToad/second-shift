// The console's own echo check (FC-267): plays one line in the chosen voice and listens to it twice at once — through
// the shared echo-cancelled microphone stream every listener uses, and through a raw one — then reports how loud he
// was on each and what the recognizer made of the cancelled stream. Before FC-267 the recognizer opened the mic itself
// and heard "Wall's off the list" through a headset; this shows, on the player's own setup, whether that's gone.
import { signal } from "@preact/signals";
import { micStream } from "./capture";
import { isSpeaking, recognitionCtor, speak, usesDeviceRecognition } from "./voice";

export type EchoResult = { raw: number; cancelled: number; heard: string; trackAccepted: boolean };
export const echoCheck = signal<{ state: "idle" | "running" | "done" | "error"; result?: EchoResult; message?: string }>({ state: "idle" });

const LINE = "Echo check. If you can read this back, the microphone heard me. One, two, three, four, five.";

/** Loudness in dBFS, from a run of RMS samples (the loudest tenth, so pauses between words don't hide him). */
function dbfs(levels: number[]): number {
  const top = [...levels].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(levels.length / 10)));
  const rms = top.reduce((a, b) => a + b, 0) / top.length;
  return rms > 0 ? Math.round(20 * Math.log10(rms)) : -120;
}

export async function runEchoCheck(): Promise<void> {
  if (echoCheck.value.state === "running") return;
  echoCheck.value = { state: "running" };
  const Ctx = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
  const media = (globalThis as { navigator?: { mediaDevices?: { getUserMedia(c: unknown): Promise<MediaStream> } } }).navigator?.mediaDevices;
  const cancelled = await micStream();
  if (!Ctx || !media || !cancelled) { echoCheck.value = { state: "error", message: "The microphone couldn't be opened." }; return; }
  let raw: MediaStream | null = null;
  const ctx = new Ctx();
  try {
    raw = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    await ctx.resume().catch(() => {});
    const meter = (stream: MediaStream) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(a);
      const buf = new Float32Array(a.fftSize);
      return () => { a.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; return Math.sqrt(s / buf.length); };
    };
    const rawLevel = meter(raw);
    const cancelledLevel = meter(cancelled);

    // What the recognizer hears on the cancelled stream while he talks: ideally nothing.
    const Rec = recognitionCtor();
    let heard = "";
    let trackAccepted = false;
    const rec = Rec ? new Rec() : null;
    if (rec) {
      rec.lang = globalThis.navigator?.language || "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      if (usesDeviceRecognition()) rec.processLocally = true;
      rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) heard += `${e.results[i]![0].transcript} `; };
      rec.onerror = () => {};
      try { rec.start(cancelled.getAudioTracks()[0]); trackAccepted = true; } catch { /* reported below */ }
    }

    const raws: number[] = [];
    const cancels: number[] = [];
    speak(LINE);
    const started = performance.now();
    // Wait for him to start (a server voice takes a moment), then sample until he stops, at most 15 s.
    while (!isSpeaking() && performance.now() - started < 5000) await new Promise((r) => setTimeout(r, 50));
    while (isSpeaking() && performance.now() - started < 15000) {
      raws.push(rawLevel());
      cancels.push(cancelledLevel());
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 800)); // the recognizer's last words
    try { rec?.stop(); } catch { /* already stopped */ }
    await new Promise((r) => setTimeout(r, 400));
    if (!raws.length) { echoCheck.value = { state: "error", message: "He didn't speak — is Read answers aloud on, with a voice that works?" }; return; }
    echoCheck.value = { state: "done", result: { raw: dbfs(raws), cancelled: dbfs(cancels), heard: heard.trim(), trackAccepted } };
  } catch (e) {
    echoCheck.value = { state: "error", message: `The check couldn't run: ${(e as Error).message}` };
  } finally {
    raw?.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
  }
}

/** The result in words: how much of him the cancelled stream removed, and what the recognizer heard. */
export function describeEcho(r: EchoResult): string {
  const removed = r.raw - r.cancelled;
  const heard = r.heard ? `the recognizer heard "${r.heard}"` : "the recognizer heard nothing";
  const track = r.trackAccepted ? "" : " — this browser wouldn't take the cancelled stream, so the recognizer still opens the mic itself";
  return `Raw mic heard him at ${r.raw} dB; after echo cancellation ${r.cancelled} dB (${removed} dB removed), and ${heard}${track}.`;
}
