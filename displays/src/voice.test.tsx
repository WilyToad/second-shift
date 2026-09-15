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
  voice.stopListening();
  voice.voiceError.value = null;
  voice.listenState.value = "idle";
  voice.readAloud.value = false;
});

test("FC-062: speaking a question shows the words as they come and sends the question when speech ends", async () => {
  const { render } = await import("preact");
  const { Composer } = await import("./chat");
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
  const rec = made.at(-1);
  expect(rec.started).toBe(true);
  expect(rec.interimResults).toBe(true);
  expect(rec.continuous).toBe(false);
  expect(rec.processLocally).toBeUndefined(); // not available on this "device"
  expect(root.querySelector("#mic")?.getAttribute("aria-pressed")).toBe("true");
  expect(root.textContent).toContain("Voice is sent to your browser's speech service");

  rec.say([{ text: "how many rails", final: false }]);
  await new Promise((r) => setTimeout(r, 5));
  expect((root.querySelector("#ask") as HTMLTextAreaElement).value).toBe("how many rails");

  rec.say([{ text: "how many rails are near me", final: true }]);
  rec.onend();
  await new Promise((r) => setTimeout(r, 5));
  expect(asked).toEqual(["how many rails are near me"]);
  expect(voice.listenState.value).toBe("idle");
  render(null, root);
});

test("FC-062: recognition runs on the device when the browser offers it, and the console says so", async () => {
  const { ctor, made } = fakeRecognition("available");
  const voice = await import("./voice");
  await voice.probeRecognition(ctor, "en-US");
  voice.startListening(() => {}, ctor, "en-US");
  expect(made.at(-1).processLocally).toBe(true);
  expect(voice.recognizedWhere.value).toBe("on-device");
  const { whereLabel } = await import("./chat");
  expect(whereLabel("on-device")).toBe("Voice is recognized on this device.");
  voice.stopListening();
});

test("FC-062: cancelling never sends; errors tell the player what to do", async () => {
  const { ctor, made } = fakeRecognition();
  const voice = await import("./voice");
  const asked: string[] = [];
  voice.startListening((t) => asked.push(t), ctor, "en-US");
  made.at(-1).say([{ text: "delete everything", final: true }]);
  voice.stopListening();
  expect(asked).toEqual([]);

  voice.startListening(() => {}, ctor, "en-US");
  made.at(-1).onerror({ error: "network" });
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
  voice.startListening(() => {}, ctor, "en-US");
  expect(made.at(-1).processLocally).toBe(true);
  voice.stopListening();
  render(null, root);
});

test("FC-147: the game's push-to-talk key starts listening in the console, and a second press sends", async () => {
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
  expect(voice.listenState.value).toBe("listening");
  made.at(-1).say([{ text: "where is the nearest coal", final: true }]);
  onMessage({ type: "talk" }); // second press: stop and send
  await new Promise((r) => setTimeout(r, 10));
  expect(asked).toEqual(["where is the nearest coal"]);

  // Chrome refusing to start from the hotkey says how to fix it.
  onMessage({ type: "talk" });
  await new Promise((r) => setTimeout(r, 10));
  made.at(-1).onerror({ error: "not-allowed" });
  expect(voice.voiceError.value).toContain("Click Talk once in this tab");
  render(null, root);
});
