import { beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window({ url: "http://127.0.0.1:5170/" });
  Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, KeyboardEvent: window.KeyboardEvent, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
});

/** A scripted SpeechRecognition: the test drives its events. */
function fakeRecognition(availability?: "available" | "unavailable" | "downloadable") {
  const made: any[] = [];
  class FakeRecognition {
    lang = ""; continuous = true; interimResults = false; maxAlternatives = 0; processLocally?: boolean;
    phrases: any[] = []; // Chromium 153 has this; a browser without it is covered by its own test
    onresult: any = null; onerror: any = null; onend: any = null; onstart: any = null;
    started = false; stopped = false; aborted = false;
    constructor() { made.push(this); }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; this.onerror?.({ error: "aborted" }); this.onend?.(); }
    results: any[] = [];
    /** Replaces the results (an interim update) unless `append`, which is what a real engine does after a final. */
    say(parts: { text: string; final: boolean }[], opts: { append?: boolean } = {}) {
      const fresh = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
      this.results = opts.append ? [...this.results, ...fresh] : fresh;
      this.onresult?.({ resultIndex: 0, results: this.results });
    }
    static available = availability ? async () => availability : undefined;
  }
  return { ctor: FakeRecognition as any, made };
}

/** A scripted speechSynthesis that records what it would say. */
function fakeSynthesis() {
  const spoken: string[] = [];
  let cancels = 0;
  Object.assign(globalThis, {
    speechSynthesis: {
      speak: (u: { text: string }) => spoken.push(u.text),
      cancel: () => { cancels++; },
      getVoices: () => [
        { name: "Cloud English", lang: "en-US", localService: false, default: true },
        { name: "Samantha", lang: "en-US", localService: true, default: false },
      ],
    },
    SpeechSynthesisUtterance: class { voice: unknown; lang = ""; rate = 1; constructor(public text: string) {} },
  });
  return { spoken, cancels: () => cancels };
}

beforeEach(async () => {
  const voice = await import("./voice");
  voice.stopTalking({ send: false });
  voice.setSilenceSeconds(0.02);
  voice.voiceError.value = null;
  voice.listenState.value = "idle";
  voice.readAloud.value = false;
});

test("FC-149: Talk keeps listening: each pause sends a question, the mic waits for the answer, then listens again until Talk is clicked", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const { onMessage } = await import("./store");
  const { ctor, made } = fakeRecognition("unavailable");
  const voice = await import("./voice");
  await voice.probeRecognition(ctor, "en-US");
  const asked: string[] = [];
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={(t) => asked.push(t)} recognition={ctor} />, root);
  await new Promise((r) => setTimeout(r, 5));

  (root.querySelector("#mic") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  const first = made.at(-1);
  expect(first.started).toBe(true);
  expect(first.continuous).toBe(true);
  expect(first.interimResults).toBe(true);
  expect(first.processLocally).toBeUndefined(); // not available on this "device"
  expect(root.querySelector("#mic")?.getAttribute("aria-pressed")).toBe("true");
  expect(root.textContent).toContain("Voice is sent to your browser's speech service");

  first.say([{ text: "how many rails", final: false }]);
  await new Promise((r) => setTimeout(r, 5));
  expect((root.querySelector("#ask") as HTMLTextAreaElement).value).toBe("how many rails");
  first.say([{ text: "how many rails are near me", final: true }]);
  await new Promise((r) => setTimeout(r, 60)); // the pause
  expect(asked).toEqual(["how many rails are near me"]);
  expect(first.aborted).toBe(true); // the mic stops while the answer comes
  expect(voice.listenState.value).toBe("waiting");

  // The answer arrives and finishes (not read aloud): the mic listens again with a fresh recognition.
  onMessage({ type: "user", text: "how many rails are near me" });
  onMessage({ type: "token", text: "6 rails." });
  expect(made.length).toBe(1); // still just the first one
  onMessage({ type: "done", totalMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  expect(made.length).toBe(2);
  expect(voice.listenState.value).toBe("listening");
  const second = made.at(-1);
  second.say([{ text: "mark them", final: true }]);
  await new Promise((r) => setTimeout(r, 60));
  expect(asked).toEqual(["how many rails are near me", "mark them"]);
  onMessage({ type: "user", text: "mark them" });
  onMessage({ type: "done", totalMs: 1 });
  await new Promise((r) => setTimeout(r, 5));

  // Chrome ending recognition on its own restarts it while the session is on.
  const third = made.at(-1);
  third.onend();
  await new Promise((r) => setTimeout(r, 5));
  expect(made.length).toBe(4);

  // Clicking Talk again ends the session; words not yet sent go out first.
  made.at(-1).say([{ text: "thanks", final: false }]);
  (root.querySelector("#mic") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  expect(asked.at(-1)).toBe("thanks");
  expect(voice.talking.value).toBe(false);
  expect(root.querySelector("#mic")?.getAttribute("aria-pressed")).toBe("false");
  render(null, root);
});

test("FC-149: while an answer is read aloud the mic stays off, so it never hears the companion", async () => {
  const synth = fakeSynthesis();
  const { ctor, made } = fakeRecognition("unavailable");
  const voice = await import("./voice");
  const { onMessage } = await import("./store");
  voice.readAloud.value = true;
  voice.startTalking(() => {}, ctor, "en-US");
  made.at(-1).say([{ text: "what is coal for", final: true }]);
  await new Promise((r) => setTimeout(r, 60));
  onMessage({ type: "user", text: "what is coal for" });
  onMessage({ type: "token", text: "Coal fuels furnaces. " });
  onMessage({ type: "done", totalMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  expect(synth.spoken.length).toBeGreaterThan(0);
  expect(made.length).toBe(1); // still speaking: no new recognition
  // The fake synth never ends utterances by itself: stopping speech (or it finishing) resumes listening.
  voice.stopSpeaking();
  await new Promise((r) => setTimeout(r, 5));
  expect(made.length).toBe(2);
  voice.stopTalking({ send: false });
  voice.readAloud.value = false;
});

test("FC-062: recognition runs on the device when the browser offers it and the player asked for it", async () => {
  const { ctor, made } = fakeRecognition("available");
  const voice = await import("./voice");
  voice.setPreferOnDevice(true); // the player's choice since FC-174; installing the model sets it too
  await voice.probeRecognition(ctor, "en-US");
  voice.startTalking(() => {}, ctor, "en-US");
  expect(made.at(-1).processLocally).toBe(true);
  expect(voice.recognizedWhere.value).toBe("on-device");
  const { whereLabel } = await import("./chat");
  expect(whereLabel("on-device")).toBe("Voice is recognized on this device.");
  voice.stopTalking({ send: false });
  voice.setPreferOnDevice(false);
});

test("FC-062: Escape-style cancelling never sends; errors end the session and tell the player what to do", async () => {
  const { ctor, made } = fakeRecognition();
  const voice = await import("./voice");
  const asked: string[] = [];
  voice.startTalking((t) => asked.push(t), ctor, "en-US");
  made.at(-1).say([{ text: "delete everything", final: false }]);
  voice.stopTalking({ send: false });
  await new Promise((r) => setTimeout(r, 60));
  expect(asked).toEqual([]);

  voice.startTalking(() => {}, ctor, "en-US");
  made.at(-1).onerror({ error: "no-speech" }); // quiet: keep going
  expect(voice.talking.value).toBe(true);
  made.at(-1).onerror({ error: "network" });
  expect(voice.talking.value).toBe(false);
  expect(voice.listenState.value).toBe("error");
  expect(voice.voiceError.value).toContain("Brave can't"); // browser-neutral since FC-186
  expect(voice.describeError("not-allowed")).toContain("microphone is blocked");
  expect(voice.describeError("aborted")).toBeNull();
});

test("FC-062: without the API there's no mic button", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={() => {}} recognition={null} />, root);
  await new Promise((r) => setTimeout(r, 5));
  expect(root.querySelector("#mic")).toBeNull();
  expect(root.querySelector("#read-aloud")).not.toBeNull();
  render(null, root);
});

test("FC-062: answers are read aloud sentence by sentence as they stream, without charts or markdown, with a local voice", async () => {
  const synth = fakeSynthesis();
  const voice = await import("./voice");
  const { onMessage } = await import("./store");
  voice.readAloud.value = true;
  onMessage({ type: "user", text: "How much jelly is Gleba making?" });
  onMessage({ type: "token", text: "Gleba makes **1,493/min** of " });
  expect(synth.spoken).toEqual([]); // no whole sentence yet
  onMessage({ type: "token", text: "jelly. Chart:\n```rate_chart\nitem=jelly surface=gleba window=30m\n``` It's " });
  onMessage({ type: "token", text: "steady." });
  onMessage({ type: "done", totalMs: 1 });
  // The third line is FC-190: the chart block is skipped, so the voice points at the screen instead of reciting it.
  expect(synth.spoken).toEqual(["Gleba makes 1,493 per minute of jelly.", "Chart: It's steady.", voice.POINTER.chart]);
  expect(voice.pickVoice([{ name: "Cloud", lang: "en-US", localService: false, default: true }, { name: "Samantha", lang: "en-US", localService: true, default: false }], "en-US")?.name).toBe("Samantha");

  // Off: nothing is spoken; a new question or talking stops speech.
  voice.readAloud.value = false;
  synth.spoken.length = 0;
  onMessage({ type: "user", text: "next" });
  onMessage({ type: "token", text: "Not spoken. " });
  onMessage({ type: "done", totalMs: 1 });
  expect(synth.spoken).toEqual([]);
  expect(synth.cancels()).toBeGreaterThan(0);
});

test("FC-062: speakable text drops markdown, chart blocks and item-name hyphens", async () => {
  const { speakable, SentenceQueue } = await import("./voice");
  expect(speakable("Build **2× assembling-machine-3** for `iron-gear-wheel` at 120/min.")).toBe("Build 2× assembling machine 3 for iron gear wheel at 120 per minute.");
  const q = new SentenceQueue();
  expect(q.push("Coal is 3.5 tiles away. Iron")).toEqual(["Coal is 3.5 tiles away."]);
  expect(q.push(" is east.\n\nNext")).toEqual(["Iron is east."]);
  expect(q.end()).toEqual(["Next"]);
});

test("FC-062: where on-device recognition can be downloaded, the console offers it and uses it afterwards", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const voice = await import("./voice");
  let status: "downloadable" | "available" = "downloadable";
  const installs: unknown[] = [];
  const { ctor, made } = fakeRecognition();
  ctor.available = async () => status;
  ctor.install = async (options: unknown) => { installs.push(options); await new Promise((r) => setTimeout(r, 40)); status = "available"; return true; };
  await voice.probeRecognition(ctor, "en-US");
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={() => {}} recognition={ctor} />, root);
  await new Promise((r) => setTimeout(r, 5));
  expect(root.textContent).toContain("Voice goes to your browser's speech service.");
  (root.querySelector("#on-device") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 10));
  expect(root.querySelector("#on-device-downloading")?.textContent ?? "").toContain("chrome://components");
  await new Promise((r) => setTimeout(r, 60));
  expect(installs).toEqual([{ langs: ["en-US"], processLocally: true }]);
  expect(voice.recognizedWhere.value).toBe("on-device");
  expect(root.querySelector("#on-device")).toBeNull();
  voice.startTalking(() => {}, ctor, "en-US");
  expect(made.at(-1).processLocally).toBe(true);
  voice.stopTalking({ send: false });
  render(null, root);
});

test("FC-147: the game's push-to-talk key turns the talk session on and off", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const { onMessage } = await import("./store");
  const voice = await import("./voice");
  const { ctor, made } = fakeRecognition("unavailable");
  const asked: string[] = [];
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={(t) => asked.push(t)} recognition={ctor} />, root);
  await new Promise((r) => setTimeout(r, 5));
  const before = made.length;

  onMessage({ type: "talk" });
  await new Promise((r) => setTimeout(r, 10));
  expect(made.length).toBe(before + 1);
  expect(voice.talking.value).toBe(true);
  made.at(-1).say([{ text: "where is the nearest coal", final: true }]);
  await new Promise((r) => setTimeout(r, 60));
  expect(asked).toEqual(["where is the nearest coal"]);
  onMessage({ type: "talk" }); // second press: session off
  await new Promise((r) => setTimeout(r, 10));
  expect(voice.talking.value).toBe(false);

  // Chrome refusing to start from the hotkey says how to fix it.
  onMessage({ type: "talk" });
  await new Promise((r) => setTimeout(r, 10));
  made.at(-1).onerror({ error: "not-allowed" });
  expect(voice.voiceError.value).toContain("Click Talk once in this tab");
  render(null, root);
});

test("FC-148: ElevenLabs sentences are fetched as they arrive and played in order; stopping cancels everything", async () => {
  const { ElevenPlayer } = await import("./voice");
  Object.assign(globalThis.URL, { createObjectURL: (b: { text: string }) => `blob:${b.text}`, revokeObjectURL: () => {} });
  const posts: any[] = [];
  const release: Record<string, () => void> = {};
  const post = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    posts.push(body);
    await new Promise<void>((r) => (release[body.text] = r));
    return { ok: true, blob: async () => ({ text: body.text }) } as unknown as Response;
  }) as typeof fetch;
  const played: string[] = [];
  const audios: any[] = [];
  const marks: (string | null)[] = [];
  const player = new ElevenPlayer({
    post,
    makeAudio: (src) => { const a = { src, onended: null as any, onerror: null as any, paused: false, play: async () => { played.push(src); }, pause() { this.paused = true; } }; audios.push(a); return a; },
    fallback: () => {},
    voice: () => "v1",
    onError: () => {},
    onPlay: (text) => marks.push(text),
    onIdle: () => marks.push(null),
  });
  player.enqueue("First.");
  player.enqueue("Second.");
  expect(posts.map((p) => [p.text, p.voice, p.previous])).toEqual([["First.", "v1", ""], ["Second.", "v1", "First."]]);
  release["Second."]!(); // the second finishes downloading first; it still waits its turn
  await new Promise((r) => setTimeout(r, 5));
  expect(played).toEqual([]);
  release["First."]!();
  await new Promise((r) => setTimeout(r, 5));
  expect(played).toEqual(["blob:First."]);
  audios[0].onended();
  await new Promise((r) => setTimeout(r, 5));
  expect(played).toEqual(["blob:First.", "blob:Second."]);
  // FC-231: the mark follows each sentence as it starts (it used to stay on the first for the whole answer).
  expect(marks).toEqual(["First.", "Second."]);

  player.enqueue("Third.");
  player.cancel();
  release["Third."]?.();
  await new Promise((r) => setTimeout(r, 5));
  expect(played.length).toBe(2);
  expect(audios[1].paused).toBe(true);
  // FC-231: and clears when the queue runs dry.
  player.enqueue("Fourth.");
  release["Fourth."]!();
  await new Promise((r) => setTimeout(r, 5));
  audios[2].onended();
  await new Promise((r) => setTimeout(r, 5));
  expect(marks.slice(2)).toEqual(["Fourth.", null]);
});

test("FC-148: a failed ElevenLabs sentence is read with the Mac voice and the console says why", async () => {
  const { ElevenPlayer } = await import("./voice");
  const fellBack: string[] = [];
  const errors: string[] = [];
  const player = new ElevenPlayer({
    post: (async () => ({ ok: false, text: async () => "ElevenLabs 401: Invalid API key" })) as unknown as typeof fetch,
    makeAudio: () => { throw new Error("no audio expected"); },
    fallback: (t) => fellBack.push(t),
    voice: () => "v1",
    onError: (m) => errors.push(m),
  });
  player.enqueue("Hello there.");
  await new Promise((r) => setTimeout(r, 5));
  expect(fellBack).toEqual(["Hello there."]);
  expect(errors).toEqual(["ElevenLabs 401: Invalid API key"]);
});

test("FC-148: the voice picker lists ElevenLabs voices only when the server has a key, and remembers the choice", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const voice = await import("./voice");
  voice.readAloud.value = true;
  await voice.loadElevenVoices((async () => Response.json({ available: false, voices: [] })) as unknown as typeof fetch);
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={() => {}} recognition={null} />, root);
  await new Promise((r) => setTimeout(r, 5));
  expect(root.querySelector("#voice")).toBeNull();

  await voice.loadElevenVoices((async () => Response.json({ available: true, voices: [{ id: "v1", name: "Aria" }, { id: "v2", name: "Roger" }] })) as unknown as typeof fetch);
  await new Promise((r) => setTimeout(r, 5));
  const select = root.querySelector("#voice") as HTMLSelectElement;
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["This Mac's voice", "Aria", "Roger"]);
  voice.chooseVoice("eleven:v2");
  expect(voice.voiceChoice.value).toBe("eleven:v2");
  // A remembered voice the key no longer has falls back to the Mac voice.
  await voice.loadElevenVoices((async () => Response.json({ available: true, voices: [{ id: "v1", name: "Aria" }] })) as unknown as typeof fetch);
  expect(voice.voiceChoice.value).toBe("browser");
  expect(voice.pickVoice([{ name: "Samantha", lang: "en-US", localService: true, default: true }, { name: "Ava (Premium)", lang: "en-US", localService: true, default: false }], "en-US")?.name).toBe("Ava (Premium)");
  voice.readAloud.value = false;
  render(null, root);
});

test("FC-149: the pause length is a setting, remembered per browser", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
  const voice = await import("./voice");
  const { ctor } = fakeRecognition("unavailable");
  voice.setSilenceSeconds(2);
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(<Composer onAsk={() => {}} recognition={ctor} />, root);
  await new Promise((r) => setTimeout(r, 5));
  const select = root.querySelector("#silence") as HTMLSelectElement;
  expect(select.value).toBe("2");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toContain("send after 3 s");
  select.value = "3";
  select.dispatchEvent(new (window as any).Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 5));
  expect(voice.silenceSeconds.value).toBe(3);
  expect(globalThis.localStorage?.getItem("second-shift.silenceSeconds") ?? "3").toBe("3");
  render(null, root);
});



test("FC-174: the player picks the engine, and installing the on-device model counts as picking it", async () => {
  const voice = await import("./voice");
  const { ctor } = fakeRecognition("available");
  voice.setPreferOnDevice(false);
  await voice.probeRecognition(ctor, "en-US");
  // On-device is ready, but the player asked for the service: that's what the label says.
  expect(voice.deviceStatus.value).toBe("available");
  expect(voice.recognizedWhere.value).toBe("speech-service");
  voice.setPreferOnDevice(true);
  expect(voice.recognizedWhere.value).toBe("on-device");
  // Without the model, the choice can't take effect.
  const { ctor: none } = fakeRecognition("downloadable");
  await voice.probeRecognition(none, "en-US");
  expect(voice.recognizedWhere.value).toBe("speech-service");
  voice.setPreferOnDevice(false);
});

test("FC-177: the recognizer is told which phrases to expect, and a browser without the API is unharmed", async () => {
  const voice = await import("./voice");
  // Chromium 153's shape: a constructor that checks the boost range, and a settable array on the recognition.
  class FakePhrase {
    constructor(public phrase: string, public boost: number) {
      if (boost < 0 || boost > 10) throw new SyntaxError("boost value must be inside the range [0, 10]");
    }
  }
  const rec: any = { phrases: [] };
  voice.setPhrases(["transport belt", "iron gear wheel"]);
  // No API in this browser: nothing set, nothing thrown.
  expect(voice.biasRecognition(rec)).toBe(0);
  Object.assign(globalThis, { SpeechRecognitionPhrase: FakePhrase });
  try {
    expect(voice.biasRecognition(rec)).toBe(2);
    expect(rec.phrases.map((p: FakePhrase) => [p.phrase, p.boost])).toEqual([["transport belt", 1], ["iron gear wheel", 1]]);
    // The wiring, not just the function: starting a talk session sets the phrases on the recognition it makes.
    voice.setPhrases(["transport belt", "iron gear wheel"]);
    const { ctor, made } = fakeRecognition("unavailable");
    voice.startTalking(() => {}, ctor);
    expect(made[0].phrases.map((p: FakePhrase) => p.phrase)).toEqual(["transport belt", "iron gear wheel"]);
    voice.stopTalking({ send: false });
    // A recognition without the property is left alone, and so is an empty phrase list.
    expect(voice.biasRecognition({} as any)).toBe(0);
    voice.setPhrases([]);
    expect(voice.biasRecognition(rec)).toBe(0);
  } finally {
    delete (globalThis as any).SpeechRecognitionPhrase;
    voice.setPhrases([]);
  }
});

test("FC-183: the words survive the engine ending a recognition inside the pause (Safari)", async () => {
  const voice = await import("./voice");
  const said: string[] = [];
  const { ctor, made } = fakeRecognition("unavailable");
  voice.setSilenceSeconds(0.08);
  voice.startTalking((text) => said.push(text), ctor);
  made[0].say([{ text: "okay I'm running wire", final: true }]);
  // Safari ends recognition after every utterance, well inside the player's pause. Chrome does it too, just rarely.
  made[0].onend();
  await new Promise((r) => setTimeout(r, 200));
  expect(said).toEqual(["okay I'm running wire"]);
  // A restart carried the words forward rather than clearing them off the screen.
  expect(made.length).toBe(2);
  voice.stopTalking({ send: false });
  voice.setSilenceSeconds(2);
});

test("FC-185: a spoken question carries what the engine offered and what was picked", async () => {
  const voice = await import("./voice");
  const said: string[] = [];
  const { ctor, made } = fakeRecognition("unavailable");
  voice.setSilenceSeconds(0.08);
  voice.startTalking((text) => said.push(text), ctor);
  // The engine's first guess is what's sent (FC-210); the record still lists what else it offered.
  made[0].onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "okay I'm running wire" }, { transcript: "okay I'm running wine" }], { isFinal: true, length: 2 })] } as any);
  await new Promise((r) => setTimeout(r, 200));
  const record = voice.heardDetail()!;
  expect(said).toEqual(["okay I'm running wire"]);
  expect(record.picked).toBe("okay I'm running wire");
  expect(record.first).toBe("okay I'm running wire");
  expect(record.alternatives).toBe(2);
  expect(record.phrases).toBe(0); // no biasing API on this browser
  expect(record.where).toBe(voice.recognizedWhere.value);
  voice.stopTalking({ send: false });
  voice.setSilenceSeconds(2);
});

test("FC-186: the console says where the voice goes, and never which browser hears best", async () => {
  const voice = await import("./voice");
  // The accuracy promise is gone (the player's own session had Safari beating Chrome's service), and the
  // browser-specific wording with it: the same console runs in Safari.
  expect(voice.describeError("network")).toContain("Brave can't");
  expect(voice.describeError("network")).not.toContain("needs Chrome");
});

test("FC-173: a sentence that stops mid-thought gets another pause, a finished one doesn't wait", async () => {
  const voice = await import("./voice");
  // The player's own cut-off question, and the endings that must never be delayed.
  expect(voice.endsDangling("keep running out of fuel up here what's the best way to get my")).toBe(true);
  expect(voice.endsDangling("send 20 of")).toBe(true);
  expect(voice.endsDangling("I just spent how does this look")).toBe(false);
  expect(voice.endsDangling("what is this")).toBe(false);
  expect(voice.endsDangling("look at this")).toBe(false);
  expect(voice.endsDangling("can you see it")).toBe(false);
  expect(voice.endsDangling("got 10 red bottles to research automation")).toBe(false);

  const said: string[] = [];
  const { ctor, made } = fakeRecognition("unavailable");
  voice.setSilenceSeconds(0.06);
  voice.startTalking((text) => said.push(text), ctor);
  made[0].say([{ text: "what's the best way to get my", final: true }]);
  // Still held after the first pause: the player is mid-sentence.
  await new Promise((r) => setTimeout(r, 100));
  expect(said).toEqual([]);
  // They carry on, and the finished sentence goes out on the next pause.
  made[0].say([{ text: "what's the best way to get my coal up here", final: true }]);
  await new Promise((r) => setTimeout(r, 120));
  expect(said).toEqual(["what's the best way to get my coal up here"]);
  voice.stopTalking({ send: false });
  voice.setSilenceSeconds(2);
});

test("FC-173: a dangling ending can't hold the question forever", async () => {
  const voice = await import("./voice");
  const said: string[] = [];
  const { ctor, made } = fakeRecognition("unavailable");
  voice.setSilenceSeconds(0.06);
  voice.startTalking((text) => said.push(text), ctor);
  made[0].say([{ text: "the best way to get my", final: true }]);
  // Two extra pauses, then it sends what it has rather than sitting on it.
  await new Promise((r) => setTimeout(r, 400));
  expect(said).toEqual(["the best way to get my"]);
  voice.stopTalking({ send: false });
  voice.setSilenceSeconds(2);
});

test("FC-190: the voice says the answer and points at the screen for the working", async () => {
  const { SentenceQueue, POINTER } = await import("./voice");
  // The player's own case: "how many biochambers for 60 bioflux per minute?"
  const answer = "You'd need **8 biochambers**.\nEach makes 7.5 bioflux/min from 15 jelly + 15 yumako mash, so 8 × 7.5 = 60/min.\n\n- 120 jelly/min\n- 120 yumako mash/min\n\n```rate_chart\nitem=bioflux surface=gleba window=30m\n```\n";
  const q = new SentenceQueue();
  const spoken = [...answer.split(/(?<=\s)/).flatMap((part) => q.push(part)), ...q.end()];
  expect(spoken[0]).toBe("You'd need 8 biochambers.");
  // The pointer sits where the working was, and the chart later earns its own (FC-213).
  expect(spoken).toContain(POINTER.numbers);
  expect(spoken.at(-1)).toBe(POINTER.chart);
  // None of the working is read out.
  expect(spoken.join(" ")).not.toContain("yumako mash");
  expect(spoken.join(" ")).not.toContain("120");
});

test("FC-190: an ordinary answer is read in full, with nothing added", async () => {
  const { SentenceQueue, POINTER } = await import("./voice");
  const q = new SentenceQueue();
  const spoken = [...q.push("Coal is 3.5 tiles away. Nothing is attacking you. "), ...q.end()];
  expect(spoken).toEqual(["Coal is 3.5 tiles away.", "Nothing is attacking you."]);
  expect(spoken).not.toContain(POINTER.numbers);

  // A table is working, so it's pointed at rather than recited — and without a chart the pointer says so.
  const table = new SentenceQueue();
  const out = [...table.push("Here's the split.\n| item | rate |\n| --- | --- |\n| iron plate | 240/min |\n"), ...table.end()];
  expect(out[0]).toBe("Here's the split.");
  expect(out.at(-1)).toBe(POINTER.numbers);

  // FC-213: numbers in the middle, a question at the end — the pointer is heard in the middle, and the question last.
  const mid = new SentenceQueue();
  const heard = [...mid.push("Twenty furnaces. 20 furnaces at 12.5 plates/min each = 250 plates/min, needing ~50 ore/min.\nWant that one-row blueprint, or the outpost added to your packing list? "), ...mid.end()];
  expect(heard).toEqual(["Twenty furnaces.", POINTER.numbers, "Want that one row blueprint, or the outpost added to your packing list?"]); // speakable() drops hyphens
  expect(out.join(" ")).not.toContain("240");
});

test("FC-218: a paragraph is judged sentence by sentence, so prose around the arithmetic is still heard", async () => {
  const { SentenceQueue, POINTER } = await import("./voice");
  // The player's own answer (2026-09-18): one line, three sentences, and only the middle one is working.
  const paragraph = "\"Stone surfaces\" I take as stone furnaces; \"belt arms\" as transport belts, rounded to 200. Twenty furnaces smelt 250 plates/min, so coal lands near 25–30/min — plan for a coal field, not a chest. I trimmed a ship on arithmetic that tidy.\n\nSay the word and I'll start the packing list. ";
  const q = new SentenceQueue();
  const heard = [...paragraph.split(/(?<=\s)/).flatMap((part) => q.push(part)), ...q.end()];
  // With FC-220 the whole paragraph is prose and is heard in full: no pointer at all.
  expect(heard.join(" ")).toContain("I take as stone furnaces");
  expect(heard.join(" ")).toContain("250 plates");
  expect(heard.join(" ")).toContain("I trimmed a ship on arithmetic that tidy.");
  expect(heard).not.toContain(POINTER.numbers);
  expect(heard.at(-1)).toBe("Say the word and I'll start the packing list.");
});

test("FC-190: what counts as working, and what doesn't", async () => {
  const { working } = await import("./voice");
  // Prose with numbers in it is heard (FC-220): only arithmetic, tables, bullets of figures and charts are working.
  expect(working("Each makes 7.5 bioflux/min from 15 jelly + 15 mash.")).toBe(false);
  expect(working("The list is 0 of 4 done: 1 of 20 furnace, 0 of 250 belt, 0 of 20 chest, 27 of 200 wood.")).toBe(false);
  expect(working("Twenty furnaces smelt 250 plates/min, so coal lands near 25–30/min.")).toBe(false);
  expect(working("- keep the labs fed, 3 of them")).toBe(false);
  expect(working("| iron plate | 240/min |")).toBe(true);
  expect(working("- 120 jelly/min")).toBe(true);
  expect(working("8 × 7.5 = 60")).toBe(true);
  // The answer, a caveat, and a single figure are all worth hearing.
  expect(working("You'd need 8 biochambers.")).toBe(false);
  expect(working("Research is already 50% done.")).toBe(false);
  expect(working("Nothing is attacking you.")).toBe(false);
  expect(working("- keep the labs fed")).toBe(false);
});

test("FC-206: an engine that refuses the phrase list drops it and keeps listening", async () => {
  const voice = await import("./voice");
  class FakePhrase { constructor(public phrase: string, public boost: number) {} }
  Object.assign(globalThis, { SpeechRecognitionPhrase: FakePhrase });
  try {
    voice.phrasesRejected.value = false;
    voice.setPhrases(["transport belt"]);
    const said: string[] = [];
    const { ctor, made } = fakeRecognition("unavailable");
    voice.startTalking((t) => said.push(t), ctor);
    expect(made[0].phrases.length).toBe(1);
    // Chrome's online service answers this the moment recognition starts with a list attached.
    made[0].onerror({ error: "phrases-not-supported" });
    // Still talking, on a fresh recognition, with no list this time.
    expect(voice.talking.value).toBe(true);
    expect(made.length).toBe(2);
    expect(made[1].phrases.length).toBe(0);
    expect(voice.phrasesRejected.value).toBe(true);
    expect(voice.voiceError.value).toBeNull();
    voice.stopTalking({ send: false });
  } finally {
    delete (globalThis as { SpeechRecognitionPhrase?: unknown }).SpeechRecognitionPhrase;
    voice.phrasesRejected.value = false;
    voice.setPhrases([]);
  }
});

test("FC-208: switching engines forgets the other engine's refusal of the phrase list", async () => {
  const voice = await import("./voice");
  voice.phrasesRejected.value = true; // the online service said no
  voice.setPreferOnDevice(true); // the player switches to the on-device model
  expect(voice.phrasesRejected.value).toBe(false);
  voice.setPreferOnDevice(false);
  expect(voice.phrasesRejected.value).toBe(false);
});

test("FC-209: a runaway repeat is collapsed, and the real sentence survives", async () => {
  const voice = await import("./voice");
  const runaway = "Ballast Ballast okay I'm running wireBallast Ballast Ballast Ballast Ballast Ballast Ballast Ballast";
  // The leading pair stays (two in a row can be speech); the glued word is split and the run of seven becomes one.
  expect(voice.collapseRepeats(runaway)).toBe("Ballast Ballast okay I'm running wire Ballast");
  // Two in a row is speech ("no no"), three is the engine.
  expect(voice.collapseRepeats("no no that one")).toBe("no no that one");
  expect(voice.collapseRepeats("send it there there there there")).toBe("send it there");
  expect(voice.collapseRepeats("okay I'm running wire")).toBe("okay I'm running wire");
});

test("FC-217: the companion's own voice coming back is an echo; the player cutting in isn't", async () => {
  const { looksLikeEcho } = await import("./voice");
  const spoken = ["Zero rails within 32 tiles around you on Gleba.", "Nothing to survey yet."];
  expect(looksLikeEcho("zero rails within 32 tiles around you", spoken)).toBe(true);
  expect(looksLikeEcho("nothing to survey yet", spoken)).toBe(true);
  expect(looksLikeEcho("how many chests are near me", spoken)).toBe(false);
  // One word: noise or echo, unless it's a cut-in word.
  expect(looksLikeEcho("okay", spoken)).toBe(true);
  expect(looksLikeEcho("stop", spoken)).toBe(false);
  expect(looksLikeEcho("Ballast", spoken)).toBe(false);
  expect(looksLikeEcho("", spoken)).toBe(true);
});

test("FC-217: with barge-in on, speaking over the answer stops it and starts the next question; off, the mic waits", async () => {
  const synth = fakeSynthesis();
  const voice = await import("./voice");
  const said: string[] = [];
  const { ctor, made } = fakeRecognition("unavailable");
  voice.readAloud.value = true;
  voice.setBargeIn(true);
  voice.setSilenceSeconds(0.06);
  try {
    voice.startTalking((t) => said.push(t), ctor);
    made[0].say([{ text: "how many rails are near me", final: true }]);
    await new Promise((r) => setTimeout(r, 120));
    expect(said).toEqual(["how many rails are near me"]);
    // The answer is being read; the recognition is still the same one, not aborted.
    expect(made[0].aborted).toBe(false);
    voice.answerSpeech.onQuestion(); // the store does this when the question echoes back
    voice.answerSpeech.onToken("Zero rails within 32 tiles around you. ");
    expect(synth.spoken).toEqual(["Zero rails within 32 tiles around you."]);
    // His own voice comes back through the mic: dropped, nothing sent, nothing cancelled.
    const cancelsBefore = synth.cancels(); // onQuestion cancels any earlier speech; count from here
    made[0].say([{ text: "zero rails within 32 tiles around you", final: true }], { append: true });
    await new Promise((r) => setTimeout(r, 120));
    expect(said).toHaveLength(1);
    expect(synth.cancels()).toBe(cancelsBefore);
    // The player cuts in: the reading stops and their words go out after the pause.
    made[0].say([{ text: "how many chests are near me", final: true }], { append: true });
    expect(synth.cancels()).toBe(cancelsBefore + 1);
    await new Promise((r) => setTimeout(r, 120));
    expect(said).toEqual(["how many rails are near me", "how many chests are near me"]);
    voice.stopTalking({ send: false });

    // Off: the recognition is aborted when the question goes out, as before (FC-149).
    voice.setBargeIn(false);
    const second = fakeRecognition("unavailable");
    voice.startTalking(() => {}, second.ctor);
    second.made[0].say([{ text: "what is this", final: true }]);
    await new Promise((r) => setTimeout(r, 120));
    expect(second.made[0].aborted).toBe(true);
    voice.stopTalking({ send: false });
  } finally {
    voice.setBargeIn(false);
    voice.readAloud.value = false;
    voice.setSilenceSeconds(2);
  }
});

test("FC-216: the sentence and word being spoken are found in the answer's text", async () => {
  const { markSpoken } = await import("./voice");
  const text = "Zero rails within 32 tiles of you. No track exists yet — **railway** isn't researched.";
  // The spoken sentence is speakable text; the mark lands on the third word.
  const spoken = { sentence: "No track exists yet railway isn't researched.", char: 9 };
  const marked = markSpoken(text, spoken);
  expect(marked.map((m) => m.mark)).toContain("word");
  expect(marked.find((m) => m.mark === "word")?.text).toBe("exists");
  expect(marked.filter((m) => m.mark === null).map((m) => m.text).join("")).toBe("Zero rails within 32 tiles of you. ");
  // A whole-sentence mark (ElevenLabs), and a sentence that isn't in this text.
  expect(markSpoken(text, { sentence: "Zero rails within 32 tiles of you.", char: -1 }).find((m) => m.mark === "sentence")?.text).toBe("Zero rails within 32 tiles of you.");
  expect(markSpoken(text, { sentence: "Something from another answer.", char: 0 })).toEqual([{ text, mark: null }]);
  expect(markSpoken(text, null)).toEqual([{ text, mark: null }]);
});
