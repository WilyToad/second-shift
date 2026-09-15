// Voice in the console (FC-062), on the Web Speech API: speak a question, hear the answer.
// https://webaudio.github.io/web-speech-api/ · Chrome ships it (webkit-prefixed); Brave exposes it but can't reach
// the speech service. Recognition runs on the device when the browser offers that (`processLocally`), otherwise the
// audio goes to the browser's speech service, and the console says which.
import { signal } from "@preact/signals";

type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative; length: number };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type Availability = "unavailable" | "downloadable" | "downloading" | "available";
export type RecognitionCtor = {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

export type ListenState = "idle" | "listening" | "error";
/** Where the voice is turned into text: known only once the browser has answered `available()`. */
export type Where = "on-device" | "speech-service" | "unknown";

export const listenState = signal<ListenState>("idle");
export const heard = signal("");
export const voiceError = signal<string | null>(null);
export const recognizedWhere = signal<Where>("unknown");
/** On-device recognition for the page language, as the browser reports it (null: not asked or not supported). */
export const deviceStatus = signal<Availability | null>(null);
export const readAloud = signal(loadSetting("second-shift.readAloud", false));
/** Counts push-to-talk presses from the game (FC-147); the composer toggles listening on each change. */
export const talkRequests = signal(0);
/** The current or last listening session was started from the game's hotkey. */
let fromGame = false;

function loadSetting(key: string, fallback: boolean): boolean {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v === null || v === undefined ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

export function saveSetting(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    // A per-browser convenience; the page works without it.
  }
}

export function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** What to tell the player for each recognition error (spec error codes). */
export function describeError(code: string): string | null {
  switch (code) {
    case "aborted": return null; // we stopped it
    case "no-speech": return "Didn't hear anything. Click the mic and speak.";
    case "not-allowed":
    case "service-not-allowed": return "The microphone is blocked for this page. Allow it from the icon in the address bar, then try again.";
    case "audio-capture": return "No microphone was found.";
    case "network": return "The browser's speech service couldn't be reached. Voice input needs Chrome (Brave can't reach the service) and a network connection.";
    case "language-not-supported": return "Speech recognition doesn't support this language.";
    default: return `Voice input stopped (${code}).`;
  }
}

let active: { rec: Recognition; aborted: boolean } | null = null;
let onDevice: boolean | null = null;

/**
 * Asks the browser once, at page load, whether recognition can run on this device, so a click can start listening
 * straight away: waiting for `available()` inside the click could cost the user gesture the browser wants.
 */
export async function probeRecognition(ctor = recognitionCtor(), lang = globalThis.navigator?.language || "en-US"): Promise<void> {
  if (!ctor) return;
  if (!ctor.available) { onDevice = false; recognizedWhere.value = "speech-service"; return; }
  try {
    deviceStatus.value = await ctor.available({ langs: [lang], processLocally: true });
  } catch {
    deviceStatus.value = "unavailable";
  }
  onDevice = deviceStatus.value === "available";
  recognizedWhere.value = onDevice ? "on-device" : "speech-service";
  if (deviceStatus.value === "downloading") watchDownload(ctor, lang);
}

let watching: ReturnType<typeof setInterval> | null = null;

/**
 * The API gives no download progress, and `install()` can stay pending for minutes, so while Chrome says
 * "downloading" the page asks again every few seconds and switches to on-device the moment it's ready.
 */
function watchDownload(ctor: RecognitionCtor, lang: string, everyMs = 5000): void {
  if (watching || !ctor.available) return;
  watching = setInterval(async () => {
    try {
      deviceStatus.value = await ctor.available!({ langs: [lang], processLocally: true });
    } catch {
      return;
    }
    if (deviceStatus.value !== "downloading") {
      clearInterval(watching!);
      watching = null;
      onDevice = deviceStatus.value === "available";
      recognizedWhere.value = onDevice ? "on-device" : "speech-service";
    }
  }, everyMs);
}

/**
 * Downloads the browser's on-device recognition for the page language (Chrome: a one-time language pack), after
 * which voice stays on this machine. Must run from a click.
 */
export async function installOnDevice(ctor = recognitionCtor(), lang = globalThis.navigator?.language || "en-US"): Promise<boolean> {
  if (!ctor?.install) return false;
  deviceStatus.value = "downloading";
  watchDownload(ctor, lang);
  let ok = false;
  try {
    ok = await ctor.install({ langs: [lang], processLocally: true });
  } catch {
    ok = false;
  }
  await probeRecognition(ctor, lang);
  if (!ok && (deviceStatus.value as Availability | null) !== "available") voiceError.value = "The on-device speech download didn't finish. Voice still works through the browser's speech service.";
  return (deviceStatus.value as Availability | null) === "available";
}

/**
 * Listens for one question. Words appear in `heard` as they're recognized; `onFinal` gets the finished question.
 * Prefers recognition on the device when the browser says it's available.
 */
export function startListening(onFinal: (text: string) => void, ctor = recognitionCtor(), lang = globalThis.navigator?.language || "en-US", opts: { fromGame?: boolean } = {}): void {
  if (!ctor) return;
  fromGame = Boolean(opts.fromGame);
  stopSpeaking(); // talking over an answer stops it
  stopListening();
  const rec = new ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  if (onDevice) rec.processLocally = true;
  if (onDevice === null) recognizedWhere.value = ctor.available ? "unknown" : "speech-service";
  let finalText = "";
  const session = { rec, aborted: false };
  const current = () => active === session;
  rec.onstart = () => { if (current()) { listenState.value = "listening"; voiceError.value = null; heard.value = ""; } };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (current()) heard.value = (finalText + interim).trim();
  };
  rec.onerror = (e) => {
    // Started from the game without a click in this tab, Chrome may refuse: say what fixes it (FC-147).
    const message = fromGame && e.error === "not-allowed" ? "Chrome wouldn't start listening from the game's hotkey. Click Talk once in this tab (and allow the microphone), then the hotkey works." : describeError(e.error);
    if (message && current()) { voiceError.value = message; listenState.value = "error"; }
  };
  rec.onend = () => {
    // A session replaced or cancelled by the player never sends what it heard.
    if (session.aborted || !current()) return;
    active = null;
    if (listenState.value === "listening") listenState.value = "idle";
    const text = finalText.trim();
    heard.value = "";
    if (text) onFinal(text);
  };
  active = session;
  voiceError.value = null;
  heard.value = "";
  listenState.value = "listening";
  try {
    rec.start();
  } catch (e) {
    active = null;
    voiceError.value = `Voice input couldn't start: ${(e as Error).message}`;
    listenState.value = "error";
  }
}

/** Cancels listening without sending anything. */
export function stopListening(): void {
  const session = active;
  active = null;
  heard.value = "";
  if (session) { session.aborted = true; session.rec.abort(); }
  if (listenState.value === "listening") listenState.value = "idle";
}

/** Stops listening and sends what was heard so far. */
export function finishListening(): void {
  active?.rec.stop();
}

/** Answer text as it should sound: no chart blocks, markdown marks or item-name hyphens. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\[gps=[^\]]*\]/g, "")
    .replace(/\b([a-z]+)-(?=[a-z0-9])/g, "$1 ")
    .replace(/\/min\b/g, " per minute")
    .replace(/\/s\b/g, " per second")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits a streaming answer into whole sentences, so speech can start before the answer is finished. Text inside
 * an unfinished chart block is held back until the block closes.
 */
export class SentenceQueue {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const fences = this.buffer.split("```").length - 1;
      const safe = fences % 2 === 1 ? this.buffer.slice(0, this.buffer.lastIndexOf("```")) : this.buffer;
      const m = /[\s\S]*?(?:[.!?](?=\s)|\n\n)/.exec(safe);
      if (!m) break;
      const sentence = speakable(m[0]);
      this.buffer = this.buffer.slice(m[0].length);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  end(): string[] {
    const rest = speakable(this.buffer);
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

type Synth = { speak(u: unknown): void; cancel(): void; getVoices(): { name: string; lang: string; localService: boolean; default: boolean }[] };
type UtteranceCtor = new (text: string) => { voice: unknown; lang: string; rate: number };

function synth(): Synth | null {
  return (globalThis as unknown as { speechSynthesis?: Synth }).speechSynthesis ?? null;
}

/**
 * A voice for the page language, preferring ones that run on this machine, and macOS's Premium or Enhanced voices
 * (System Settings → Accessibility → Spoken Content) over the older compact ones.
 */
export function pickVoice<V extends { name?: string; lang: string; localService: boolean; default: boolean }>(voices: V[], lang: string): V | null {
  const base = lang.split("-")[0]!.toLowerCase();
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const quality = (v: V) => (/\(Premium\)/.test(v.name ?? "") ? -2 : /\(Enhanced\)/.test(v.name ?? "") ? -1.5 : 0);
  const rank = (v: V) => (v.localService ? 0 : 2) + (v.lang.toLowerCase() === lang.toLowerCase() ? 0 : 1) - (v.default ? 0.5 : 0) + quality(v);
  return [...same].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

let queue: SentenceQueue | null = null;

// ElevenLabs voices (FC-148): the choice is "browser" or "eleven:<voice id>", remembered per browser.
export type ElevenVoice = { id: string; name: string; category?: string };
export const voiceChoice = signal(loadText("second-shift.voice", "browser"));
export const elevenVoices = signal<ElevenVoice[]>([]);
export const elevenError = signal<string | null>(null);

function loadText(key: string, fallback: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function chooseVoice(choice: string): void {
  voiceChoice.value = choice;
  stopSpeaking();
  try {
    globalThis.localStorage?.setItem("second-shift.voice", choice);
  } catch {
    // per-browser convenience
  }
}

/** Asks the server which ElevenLabs voices the player's key can use (none without a key). */
export async function loadElevenVoices(get: typeof fetch = fetch): Promise<void> {
  try {
    const body = (await (await get("/tts/voices")).json()) as { available: boolean; voices: ElevenVoice[]; error?: string };
    elevenVoices.value = body.available ? body.voices : [];
    elevenError.value = body.error ?? null;
  } catch {
    elevenVoices.value = [];
  }
  if (voiceChoice.value.startsWith("eleven:") && !elevenVoices.value.some((v) => `eleven:${v.id}` === voiceChoice.value)) voiceChoice.value = "browser";
}

type AudioLike = { play(): Promise<void>; pause(): void; onended: (() => void) | null; onerror: (() => void) | null; src: string };

/** Plays ElevenLabs audio for each sentence in order; each is fetched as soon as it's queued, so playback flows. */
export class ElevenPlayer {
  private items: { text: string; audio: Promise<string | null> }[] = [];
  private playing: AudioLike | null = null;
  private busy = false;
  private stop = new AbortController();
  private previous = "";

  constructor(
    private readonly deps: {
      post?: typeof fetch;
      makeAudio?: (src: string) => AudioLike;
      fallback: (text: string) => void;
      voice: () => string;
      onError: (message: string) => void;
    },
  ) {}

  enqueue(text: string): void {
    const previous = this.previous;
    this.previous = text;
    const signal = this.stop.signal;
    const post = this.deps.post ?? fetch;
    const audio = post("/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: this.deps.voice(), previous }), signal })
      .then(async (res) => {
        if (!res.ok) { this.deps.onError(await res.text()); return null; }
        return URL.createObjectURL(await res.blob());
      })
      .catch((e) => { if (!signal.aborted) this.deps.onError((e as Error).message); return null; });
    this.items.push({ text, audio });
    void this.next();
  }

  private async next(): Promise<void> {
    if (this.busy) return;
    const item = this.items.shift();
    if (!item) return;
    this.busy = true;
    const signal = this.stop.signal;
    const url = await item.audio;
    if (signal.aborted) return;
    if (!url) {
      this.deps.fallback(item.text);
      this.busy = false;
      return this.next();
    }
    const audio = (this.deps.makeAudio ?? ((src) => new Audio(src) as unknown as AudioLike))(url);
    this.playing = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (this.playing !== audio) return;
      this.playing = null;
      this.busy = false;
      void this.next();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(() => { this.deps.fallback(item.text); done(); });
  }

  cancel(): void {
    this.stop.abort();
    this.stop = new AbortController();
    this.items = [];
    this.previous = "";
    this.playing?.pause();
    this.playing = null;
    this.busy = false;
  }
}

const eleven = new ElevenPlayer({
  fallback: (text) => speakWithBrowser(text),
  voice: () => voiceChoice.value.replace(/^eleven:/, ""),
  onError: (message) => { voiceError.value = `ElevenLabs couldn't speak (${message}); using this Mac's voice instead.`; },
});

export function speak(sentence: string): void {
  if (voiceChoice.value.startsWith("eleven:")) eleven.enqueue(sentence);
  else speakWithBrowser(sentence);
}

function speakWithBrowser(sentence: string): void {
  const s = synth();
  const Utterance = (globalThis as unknown as { SpeechSynthesisUtterance?: UtteranceCtor }).SpeechSynthesisUtterance;
  if (!s || !Utterance || !sentence) return;
  const u = new Utterance(sentence);
  const lang = globalThis.navigator?.language || "en-US";
  const voice = pickVoice(s.getVoices(), lang);
  if (voice) u.voice = voice;
  u.lang = lang;
  u.rate = 1.05;
  s.speak(u);
}

export function stopSpeaking(): void {
  queue = null;
  synth()?.cancel();
  eleven.cancel();
}

/** Feeds the answer stream to speech while "Read answers aloud" is on. */
export const answerSpeech = {
  onQuestion(): void {
    stopSpeaking();
    if (readAloud.value) queue = new SentenceQueue();
  },
  onToken(text: string): void {
    if (!queue) return;
    for (const sentence of queue.push(text)) speak(sentence);
  },
  onDone(): void {
    if (!queue) return;
    for (const sentence of queue.end()) speak(sentence);
    queue = null;
  },
};
