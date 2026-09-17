// Voice in the console (FC-062), on the Web Speech API: speak a question, hear the answer.
// https://webaudio.github.io/web-speech-api/ · Chrome ships it (webkit-prefixed); Brave exposes it but can't reach
// the speech service. Recognition runs on the device when the browser offers that (`processLocally`), otherwise the
// audio goes to the browser's speech service, and the console says which.
import { signal } from "@preact/signals";
import { playSound } from "./sounds";

type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative; length: number; [index: number]: Alternative };
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

/**
 * Words from the player's own save, sent by the server once a page connects (FC-175). The recognizer offers
 * several transcripts of what it heard; the one carrying this save's words is nearly always the right one
 * ("running wire" over "running wine"), and the engine's own first guess breaks ties.
 */
export const vocabulary = signal<Set<string>>(new Set());
/** How many transcripts to ask the recognizer for. More than a handful costs accuracy nothing and time nothing. */
export const ALTERNATIVES = 4;

/** Singular and plural count as the same word: the player says "belts", the save calls it "belt". */
const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

/**
 * Phrases the recognizer is told to expect (FC-177). Chromium 153 takes an array of `SpeechRecognitionPhrase`
 * with a boost of 0–10; biasing the engine beats re-ranking its guesses afterwards, and the two work together.
 * Checked in Chromium 153: assignment takes a plain array, and a boost outside the range throws.
 */
export const phrases = signal<string[]>([]);
/**
 * How hard to tilt the engine. Unmeasured: the spike suggested ~5 of 10, but that was for a handful of terms and
 * this list is 100, where a strong boost across all of them risks pulling ordinary words ("built") toward item
 * names ("belt"). Middle setting until the player's next session says which way to move it.
 */
const PHRASE_BOOST = 3;

export function setPhrases(list: string[]): void {
  phrases.value = list;
}

/**
 * What the engine offered for the last spoken question and what the console did with it (FC-185). Without this, a
 * good transcript can't be attributed: biasing preventing the error, rescoring correcting it, and the engine simply
 * getting it right all look identical afterwards. Sent with the question for the log, never into the prompt.
 */
export type HeardDetail = { first: string; picked: string; alternatives: number; offered: string[]; phrases: number; where: string; carried: boolean };
let detail: HeardDetail | null = null;
export const heardDetail = (): HeardDetail | null => detail;

/** Applies the phrases to one recognition, where the browser has the API. Never throws. */
export function biasRecognition(rec: Recognition, list = phrases.value): number {
  const Phrase = (globalThis as { SpeechRecognitionPhrase?: new (phrase: string, boost: number) => unknown }).SpeechRecognitionPhrase;
  if (!Phrase || !list.length || !("phrases" in rec)) return 0;
  try {
    (rec as { phrases?: unknown }).phrases = list.map((phrase) => new Phrase(phrase, PHRASE_BOOST));
    return list.length;
  } catch {
    return 0; // an older browser, or a list it won't take: the alternatives scoring still helps
  }
}

export function setVocabulary(words: string[]): void {
  vocabulary.value = new Set(words.map((w) => stem(w.toLowerCase())).filter((w) => w.length > 2));
}

const spoken = (text: string) => (text.toLowerCase().match(/[a-z']+/g) ?? []).map(stem);

/** The transcript that matches the save best: most words it knows, the engine's order deciding a tie. */
export function pickAlternative(result: { length: number; [index: number]: { transcript: string } }, words = vocabulary.value): string {
  const first = result[0]?.transcript ?? "";
  if (!words.size || result.length < 2) return first;
  let best = first, bestScore = -1;
  for (let i = 0; i < Math.min(result.length, ALTERNATIVES); i++) {
    const transcript = result[i]?.transcript;
    if (transcript === undefined) continue;
    const score = spoken(transcript).filter((w) => words.has(w)).length;
    if (score > bestScore) { best = transcript; bestScore = score; }
  }
  return best;
}

export type ListenState = "idle" | "listening" | "waiting" | "error";
/** Where the voice is turned into text: known only once the browser has answered `available()`. */
export type Where = "on-device" | "speech-service" | "unknown";

export const listenState = signal<ListenState>("idle");
export const heard = signal("");
export const voiceError = signal<string | null>(null);
export const recognizedWhere = signal<Where>("unknown");
/** On-device recognition for the page language, as the browser reports it (null: not asked or not supported). */
export const deviceStatus = signal<Availability | null>(null);
export const readAloud = signal(loadSetting("second-shift.readAloud", false));
/**
 * Which engine turns the voice into text (FC-174). The browser's own service sends the audio off the machine;
 * on-device keeps it here. The player picks, because it's their tradeoff — before this, installing the on-device
 * model silently made it permanent, and near-homophones ("wire" heard as "wine") had no way back.
 *
 * The picker used to promise the online service "hears more accurately" (FC-186). That claim is gone: on the
 * player's own five test sentences, Safari's engine beat Chrome's online service on both formatting failures
 * ("I've got 10" and "up there", which Chrome mangled) and matched it on the near-homophone. One voice and one
 * session is not a measurement, so the picker now says what's actually true — where the audio goes.
 */
export const preferOnDevice = signal(loadSetting("second-shift.onDevice", false));
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
    case "network": return "The browser's speech service couldn't be reached. It needs a network connection, and a browser that can reach it (Brave can't; Chrome and Safari can).";
    case "language-not-supported": return "Speech recognition doesn't support this language.";
    default: return `Voice input stopped (${code}).`;
  }
}

type Run = { rec: Recognition; aborted: boolean; pending: () => string; markSent: () => void; record: (sent: string) => HeardDetail };
let active: Run | null = null;
/**
 * Words heard by a recognition that has already ended, not yet sent (FC-183). The engine decides when a recognition
 * ends — Safari after every utterance, Chrome after a few minutes — and that can land inside the player's pause.
 * The pending text and the send timer therefore belong to the talk session, not to one recognition: before this, a
 * restart cleared the screen and the pending send found itself attached to a run that was no longer current, so the
 * sentence was dropped in silence.
 */
let carried = "";
/** Extra pauses already granted to an unfinished sentence (FC-173). */
let holds = 0;
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
  applyChoice();
  if (deviceStatus.value === "downloading") watchDownload(ctor, lang);
}

/** On-device is used only when it's ready *and* the player asked for it (FC-174). */
function applyChoice(): void {
  onDevice = deviceStatus.value === "available" && preferOnDevice.value;
  recognizedWhere.value = onDevice ? "on-device" : "speech-service";
}

/** The player's choice of engine; takes effect on the next utterance. */
export function setPreferOnDevice(on: boolean): void {
  preferOnDevice.value = on;
  saveSetting("second-shift.onDevice", on);
  applyChoice();
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
      applyChoice();
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
  // Downloading the model is an explicit act, so it counts as choosing it (FC-174).
  preferOnDevice.value = true;
  saveSetting("second-shift.onDevice", true);
  await probeRecognition(ctor, lang);
  if (!ok && (deviceStatus.value as Availability | null) !== "available") voiceError.value = "The on-device speech download didn't finish. Voice still works through the browser's speech service.";
  return (deviceStatus.value as Availability | null) === "available";
}

/** How long a pause ends a question, in seconds (player setting, FC-149). */
export const silenceSeconds = signal(loadNumber("second-shift.silenceSeconds", 2));
/** A talk session is on: from clicking Talk (or the game's key) until it's clicked again. */
export const talking = signal(false);

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setSilenceSeconds(seconds: number): void {
  silenceSeconds.value = seconds;
  try {
    globalThis.localStorage?.setItem("second-shift.silenceSeconds", String(seconds));
  } catch {
    // per-browser convenience
  }
}

type Session = { ctor: RecognitionCtor; lang: string; onUtterance: (text: string) => void; fromGame: boolean };
let session: Session | null = null;
/** A question was sent (or typed) and its answer is still arriving or being read aloud: the mic waits. */
let awaitingAnswer = false;
let answerDone = true;
let silence: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts a talk session (FC-149): listens continuously, sends each question after `silenceSeconds` of quiet, then
 * pauses while the answer arrives and is read aloud (so the mic doesn't hear the companion) and listens again. Words
 * appear in `heard` as they're recognized. Runs on the device when the browser offers that.
 */
export function startTalking(onUtterance: (text: string) => void, ctor = recognitionCtor(), lang = globalThis.navigator?.language || "en-US", opts: { fromGame?: boolean } = {}): void {
  if (!ctor) return;
  stopSpeaking(); // talking over an answer stops it
  endRecognition();
  fromGame = Boolean(opts.fromGame);
  session = { ctor, lang, onUtterance, fromGame };
  talking.value = true;
  awaitingAnswer = false;
  answerDone = true;
  voiceError.value = null;
  playSound("listen");
  listen();
}

function listen(): void {
  const s = session;
  if (!s || awaitingAnswer) return;
  const rec = new s.ctor();
  rec.lang = s.lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = ALTERNATIVES;
  if (onDevice) rec.processLocally = true;
  const applied = biasRecognition(rec);
  if (onDevice === null) recognizedWhere.value = s.ctor.available ? "unknown" : "speech-service";
  // Results from this recognition that were already sent as a question.
  let sentUpTo = 0;
  let latest: ArrayLike<Result> = [];
  const textFrom = (results: ArrayLike<Result>) => {
    let text = "";
    for (let i = sentUpTo; i < results.length; i++) text += pickAlternative(results[i]!);
    return text.trim();
  };
  let lastOffered: string[] = [];
  const run: Run = {
    rec, aborted: false,
    // Everything heard and not yet sent: what earlier recognitions left behind, then this one's own words.
    pending: () => [carried, textFrom(latest)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    markSent: () => { sentUpTo = latest.length; carried = ""; },
    record: (sent: string) => ({
      first: lastOffered[0] ?? sent, picked: sent, alternatives: lastOffered.length, offered: lastOffered,
      phrases: applied, where: recognizedWhere.value, carried: Boolean(carried),
    }),
  };
  const current = () => active === run;
  rec.onstart = () => { if (current()) listenState.value = "listening"; };
  rec.onresult = (e) => {
    if (!current()) return;
    latest = e.results;
    const last = e.results[e.results.length - 1];
    if (last) {
      const offered: string[] = [];
      for (let i = 0; i < last.length && i < ALTERNATIVES; i++) offered.push(last[i]!.transcript.trim());
      lastOffered = offered;
    }
    heard.value = run.pending();
    armSend();
  };
  rec.onerror = (e) => {
    if (!current()) return;
    // Quiet or our own abort just means "keep going"; anything else ends the session with a reason.
    if (e.error === "no-speech" || e.error === "aborted") return;
    const message = s.fromGame && e.error === "not-allowed"
      ? "The browser wouldn't start listening from the game's hotkey. Click Talk once in this tab (and allow the microphone), then the hotkey works."
      : describeError(e.error);
    if (message) voiceError.value = message;
    listenState.value = "error";
    stopTalking({ send: false, keepError: true });
  };
  rec.onend = () => {
    // The engine ends recognition on its own — Safari every utterance, Chrome every few minutes. Carry the words
    // forward and start again while the session is on; the pending send stays armed across the restart.
    if (run.aborted || !current()) return;
    carried = run.pending();
    active = null;
    if (session && !awaitingAnswer) listen();
  };
  active = run;
  heard.value = carried; // a restart mid-sentence keeps what the player already said on screen
  listenState.value = "listening";
  try {
    rec.start();
  } catch (e) {
    active = null;
    voiceError.value = `Voice input couldn't start: ${(e as Error).message}`;
    listenState.value = "error";
    stopTalking({ send: false, keepError: true });
  }
}

/**
 * Words that can't be the last word of a question (FC-173). Deliberately narrow: articles, possessives,
 * conjunctions and prepositions that always take something after them. Demonstratives and pronouns stay out —
 * "what is this", "look at this", "can you see it" and "tell me" are finished sentences, and delaying those would
 * make every normal question feel slow.
 */
const DANGLING = new Set([
  "a", "an", "the", "my", "your", "our", "their", "his", "her", "its",
  "and", "or", "but", "because", "than",
  "of", "to", "for", "with", "from", "into", "onto", "about",
]);
/** How many extra pauses a dangling ending may buy. At the default pause that's up to 6 s before it sends anyway. */
const MAX_HOLDS = 2;

/** Does this look like a sentence the player hadn't finished? */
export function endsDangling(text: string): boolean {
  const last = text.toLowerCase().replace(/[^a-z\s']/g, " ").trim().split(/\s+/).pop() ?? "";
  return DANGLING.has(last);
}

/**
 * Arms the send for one pause's worth of quiet. The timer reads whichever recognition is current when it fires, so
 * the engine restarting in the meantime doesn't lose the sentence (FC-183).
 */
function armSend(): void {
  if (silence) clearTimeout(silence);
  silence = setTimeout(() => {
    silence = null;
    const run = active;
    if (!session || !run) return;
    const text = run.pending();
    if (!text) return;
    // A sentence that stops on "…the best way to get my" was cut off by the pause, not finished (FC-173): give the
    // player another pause to carry on, but only a couple, so a real trailing word can't hold the question forever.
    if (holds < MAX_HOLDS && endsDangling(text)) {
      holds++;
      armSend();
      return;
    }
    holds = 0;
    detail = run.record(text);
    run.markSent();
    send(text);
  }, silenceSeconds.value * 1000);
}

/** Sends a spoken question and pauses the mic until the answer is done. */
function send(text: string): void {
  const s = session;
  if (!s) return;
  heard.value = "";
  pauseForAnswer();
  playSound("sent");
  s.onUtterance(text);
}

function pauseForAnswer(): void {
  awaitingAnswer = true;
  answerDone = false;
  endRecognition();
  if (session) listenState.value = "waiting";
}

function endRecognition(): void {
  if (silence) { clearTimeout(silence); silence = null; }
  carried = "";
  holds = 0;
  const run = active;
  active = null;
  if (run) { run.aborted = true; run.rec.abort(); }
}

/** Listens again once the answer has finished arriving and nothing is being read aloud. */
function maybeResume(): void {
  if (!session || !awaitingAnswer || !answerDone || isSpeaking()) return;
  awaitingAnswer = false;
  playSound("listen"); // the mic is open again
  listen();
}

/**
 * Ends the talk session. With `send`, words heard since the last question go out first (clicking Talk again right
 * after speaking shouldn't lose them); Escape cancels without sending.
 */
export function stopTalking({ send: sendPending = true, keepError = false }: { send?: boolean; keepError?: boolean } = {}): void {
  const s = session;
  const pending = heard.value.trim();
  session = null;
  talking.value = false;
  awaitingAnswer = false;
  endRecognition();
  heard.value = "";
  if (!keepError) listenState.value = "idle";
  if (sendPending && pending && s) s.onUtterance(pending);
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
type UtteranceCtor = new (text: string) => { voice: unknown; lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };

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
  private busyFlag = false;
  private stop = new AbortController();
  private previous = "";

  constructor(
    private readonly deps: {
      post?: typeof fetch;
      makeAudio?: (src: string) => AudioLike;
      fallback: (text: string) => void;
      voice: () => string;
      onError: (message: string) => void;
      onIdle?: () => void;
    },
  ) {}

  /** Audio queued or playing. */
  busy(): boolean {
    return this.playingNow || this.items.length > 0;
  }

  private get playingNow(): boolean {
    return this.busyFlag;
  }

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
    if (this.busyFlag) return;
    const item = this.items.shift();
    if (!item) { this.deps.onIdle?.(); return; }
    this.busyFlag = true;
    const signal = this.stop.signal;
    const url = await item.audio;
    if (signal.aborted) return;
    if (!url) {
      this.deps.fallback(item.text);
      this.busyFlag = false;
      return this.next();
    }
    const audio = (this.deps.makeAudio ?? ((src) => new Audio(src) as unknown as AudioLike))(url);
    this.playing = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (this.playing !== audio) return;
      this.playing = null;
      this.busyFlag = false;
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
    this.busyFlag = false;
  }
}

const eleven = new ElevenPlayer({
  fallback: (text) => speakWithBrowser(text),
  voice: () => voiceChoice.value.replace(/^eleven:/, ""),
  onError: (message) => { voiceError.value = `ElevenLabs couldn't speak (${message}); using this Mac's voice instead.`; },
  onIdle: () => maybeResume(),
});

export function speak(sentence: string): void {
  if (voiceChoice.value.startsWith("eleven:")) eleven.enqueue(sentence);
  else speakWithBrowser(sentence);
}

let browserSpeaking = 0;

function isSpeaking(): boolean {
  return browserSpeaking > 0 || eleven.busy();
}

function speakWithBrowser(sentence: string): void {
  const s = synth();
  const Utterance = (globalThis as unknown as { SpeechSynthesisUtterance?: UtteranceCtor }).SpeechSynthesisUtterance;
  if (!s || !Utterance || !sentence) return;
  const u = new Utterance(sentence);
  browserSpeaking++;
  const finished = () => { browserSpeaking = Math.max(0, browserSpeaking - 1); maybeResume(); };
  u.onend = finished;
  u.onerror = finished;
  const lang = globalThis.navigator?.language || "en-US";
  const voice = pickVoice(s.getVoices(), lang);
  if (voice) u.voice = voice;
  u.lang = lang;
  u.rate = 1.05;
  s.speak(u);
}

export function stopSpeaking(): void {
  queue = null;
  browserSpeaking = 0;
  synth()?.cancel();
  eleven.cancel();
  maybeResume();
}

/** Feeds the answer stream to speech while "Read answers aloud" is on. */
export const answerSpeech = {
  onQuestion(): void {
    // Any question (spoken or typed) pauses a talk session's mic until its answer is done (FC-149).
    if (session) pauseForAnswer();
    stopSpeaking();
    if (readAloud.value) queue = new SentenceQueue();
  },
  onToken(text: string): void {
    if (!queue) return;
    for (const sentence of queue.push(text)) speak(sentence);
  },
  onDone(): void {
    if (queue) for (const sentence of queue.end()) speak(sentence);
    queue = null;
    answerDone = true;
    maybeResume();
  },
};
