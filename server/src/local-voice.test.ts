import { expect, test } from "bun:test";
import { BALLAST_VOICE, LocalVoice, PREFIX, voiceLabel } from "./local-voice";

const here = new URL("./local-voice.ts", import.meta.url).pathname; // a file that certainly exists

test("FC-254: absent without complaint when the venv isn't installed — says why, starts nothing", async () => {
  const said: string[] = [];
  const v = new LocalVoice((l) => said.push(l), { python: "/nowhere/python", sidecar: here });
  expect(v.missing()).toContain("isn't installed");
  expect(v.status()).toMatchObject({ available: false, ready: false, voice: BALLAST_VOICE });
  await v.start();
  expect(said).toEqual([expect.stringContaining("Local voice off")]);
  expect(await v.voices()).toBeNull();
  // Asked to speak anyway, it refuses cleanly and the console's player falls back to the browser's voice.
  expect((await v.speak("hello", "kokoro:am_michael")).status).toBe(503);
});

test("FC-254: a sidecar already answering on the port is adopted, not doubled", async () => {
  const calls: string[] = [];
  const v = new LocalVoice(() => {}, {
    python: here,
    sidecar: here,
    fetch: (async (url: string) => {
      calls.push(new URL(url).pathname);
      if (url.endsWith("/health")) return Response.json({ ready: true });
      if (url.endsWith("/voices")) return Response.json({ default: BALLAST_VOICE, voices: ["af_heart", BALLAST_VOICE] });
      return new Response("?", { status: 404 });
    }) as never,
  });
  await v.start();
  expect(v.status().ready).toBe(true);
  expect(await v.voices()).toEqual({ default: BALLAST_VOICE, voices: ["af_heart", BALLAST_VOICE] });
  // The list is read once and kept.
  await v.voices();
  expect(calls.filter((c) => c === "/voices")).toHaveLength(1);
  v.stop();
});

test("FC-254: speaking sends the voice's own name and passes the audio through untouched", async () => {
  let sent: { input?: string; voice?: string } = {};
  const v = new LocalVoice(() => {}, {
    python: here,
    sidecar: here,
    fetch: (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return Response.json({ ready: true });
      sent = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "Content-Type": "audio/wav" } });
    }) as never,
  });
  await v.start();
  const r = await v.speak("Your labs are idle.", `${PREFIX}am_michael`);
  // The prefix is how /tts tells a local voice from an ElevenLabs id; the sidecar only wants the name.
  expect(sent).toEqual({ input: "Your labs are idle.", voice: "am_michael" });
  expect(r.headers.get("Content-Type")).toBe("audio/wav");
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([82, 73, 70, 70]);
  // No voice asked for: Ballast's.
  await v.speak("Hello.", undefined);
  expect(sent.voice).toBe(BALLAST_VOICE);
  v.stop();
});

test("FC-254: a sidecar that stops answering mid-session is a 503, never a crash", async () => {
  let up = true;
  const v = new LocalVoice(() => {}, {
    python: here,
    sidecar: here,
    fetch: (async (url: string) => {
      if (url.endsWith("/health")) return Response.json({ ready: true });
      if (!up) throw new Error("connection refused");
      return new Response(new Uint8Array([1]));
    }) as never,
  });
  await v.start();
  up = false;
  const r = await v.speak("Hello.", "kokoro:am_michael");
  expect(r.status).toBe(503);
  expect(await r.text()).toContain("didn't answer");
  v.stop();
});

test("FC-254: voices are named the way a person would pick them, and Ballast's is marked", () => {
  expect(voiceLabel("am_michael")).toBe("Ballast (Michael)");
  expect(voiceLabel("af_heart")).toBe("Heart (American)");
  expect(voiceLabel("bm_george")).toBe("George (British)");
  expect(voiceLabel("bf_emma")).toBe("Emma (British)");
});
