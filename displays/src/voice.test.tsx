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
    onresult: any = null; onerror: any = null; onend: any = null; onstart: any = null;
    started = false; stopped = false; aborted = false;
    constructor() { made.push(this); }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; this.onerror?.({ error: "aborted" }); this.onend?.(); }
    say(parts: { text: string; final: boolean }[]) {
      const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }));
      this.onresult?.({ resultIndex: 0, results });
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
  expect(voice.voiceError.value).toContain("Brave can't reach the service");
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
  expect(synth.spoken).toEqual(["Gleba makes 1,493 per minute of jelly.", "Chart: It's steady."]);
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
  const player = new ElevenPlayer({
    post,
    makeAudio: (src) => { const a = { src, onended: null as any, onerror: null as any, paused: false, play: async () => { played.push(src); }, pause() { this.paused = true; } }; audios.push(a); return a; },
    fallback: () => {},
    voice: () => "v1",
    onError: () => {},
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

  player.enqueue("Third.");
  player.cancel();
  release["Third."]?.();
  await new Promise((r) => setTimeout(r, 5));
  expect(played.length).toBe(2);
  expect(audios[1].paused).toBe(true);
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

test("FC-175: the transcript that matches the save wins, and the engine's order breaks ties", async () => {
  const voice = await import("./voice");
  voice.setVocabulary(["wire", "copper", "cable", "belt", "inserter", "automation", "bottle"]);
  // The player's own examples: Chrome's first guess was the wrong one of a near-homophone pair.
  const result = (...transcripts: string[]) => Object.assign(transcripts.map((transcript) => ({ transcript })), { length: transcripts.length });
  expect(voice.pickAlternative(result("okay I'm running wine", "okay I'm running wire") as any)).toBe("okay I'm running wire");
  expect(voice.pickAlternative(result("got 10 red darts", "got 10 red bottles") as any)).toBe("got 10 red bottles");
  // Nothing from the save in any of them: the engine's first guess stands.
  expect(voice.pickAlternative(result("that must be monsters", "that must be munsters") as any)).toBe("that must be monsters");
  // One transcript only, or no vocabulary yet: unchanged.
  expect(voice.pickAlternative(result("just the one") as any)).toBe("just the one");
  voice.setVocabulary([]);
  expect(voice.pickAlternative(result("running wine", "running wire") as any)).toBe("running wine");
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
