import { expect, test } from "bun:test";
import { ElevenLabs, elevenLabsKey } from "./tts";

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => { calls.push({ url, init }); return respond(url, init); };
  return { fn, calls };
}

test("FC-148: the key comes from the environment only; blank means off", () => {
  expect(elevenLabsKey({ ELEVENLABS_API_KEY: " sk_abc " })).toBe("sk_abc");
  expect(elevenLabsKey({ ELEVENLABS_API_KEY: "" })).toBeNull();
  expect(elevenLabsKey({})).toBeNull();
  expect(elevenLabsKey({ ELEVEN_LABS_KEY: "sk_alt" })).toBe("sk_alt");
});

test("FC-148, FC-260: speech streams from Eleven v4 Turbo, cues and all, with the key in a header, never in the URL", async () => {
  const { fn, calls } = fakeFetch((url) => url.includes("/v2/voices")
    ? Response.json({ voices: [{ voice_id: "v1", name: "Aria", category: "premade" }] })
    : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
  const tts = new ElevenLabs({ key: "sk_secret", fetch: fn });
  expect(await tts.listVoices()).toEqual([{ id: "v1", name: "Aria", category: "premade" }]);
  const res = await tts.speak("  [dryly] Gleba makes 1,493 per minute of jelly.  ", undefined, "Earlier sentence.");
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  const speech = calls.at(-1)!;
  // No voice named: Adam, the one the player heard (FC-259), not whichever the account lists first.
  expect(speech.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream?output_format=mp3_44100_128");
  expect(speech.url).not.toContain("sk_secret");
  expect((speech.init!.headers as Record<string, string>)["xi-api-key"]).toBe("sk_secret");
  expect(JSON.parse(String(speech.init!.body))).toEqual({ text: "[dryly] Gleba makes 1,493 per minute of jelly.", model_id: "eleven_v4_turbo", previous_text: "Earlier sentence." });
});

test("FC-148: a key limited to speech still gets the standard voices", async () => {
  const { fn } = fakeFetch(() => Response.json({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission voices_read to execute this operation." } }, { status: 401 }));
  const tts = new ElevenLabs({ key: "sk_speech_only", fetch: fn });
  const voices = await tts.listVoices();
  expect(voices.map((v) => v.name)).toContain("George");
  expect(voices.length).toBe(9);
});

test("FC-148: a refused key or a failure comes back with ElevenLabs' reason", async () => {
  const { fn } = fakeFetch(() => Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 }));
  const tts = new ElevenLabs({ key: "bad", defaultVoice: "v1", fetch: fn });
  const res = await tts.speak("Hello.", undefined);
  expect(res.status).toBe(401);
  expect(await res.text()).toBe("ElevenLabs 401: Invalid API key");
  await expect(tts.listVoices()).rejects.toThrow("ElevenLabs 401: Invalid API key");
});

test("FC-260: never more than four sentences in flight — the plan's limit is five — and they still start in order", async () => {
  let inFlight = 0;
  let most = 0;
  const started: string[] = [];
  const finish: (() => void)[] = [];
  const fn = async (_url: string, init?: RequestInit) => {
    started.push(JSON.parse(String(init!.body)).text);
    inFlight++;
    most = Math.max(most, inFlight);
    // A streamed sentence holds its request open until its audio is all through.
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); finish.push(() => { inFlight--; c.close(); }); } });
    return new Response(body, { headers: { "content-type": "audio/mpeg" } });
  };
  const tts = new ElevenLabs({ key: "k", fetch: fn });
  const answers = Array.from({ length: 8 }, (_, i) => tts.speak(`Sentence ${i + 1}.`, "v"));
  await Bun.sleep(5);
  expect(started).toEqual(["Sentence 1.", "Sentence 2.", "Sentence 3.", "Sentence 4."]);
  // Each sentence's audio read to the end frees its place for the next in line.
  const read = answers.map(async (r) => new Uint8Array(await (await r).arrayBuffer()));
  while (finish.length) { finish.shift()!(); await Bun.sleep(2); }
  expect((await Promise.all(read)).every((b) => b.length === 1)).toBe(true);
  expect(started).toEqual(Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1}.`));
  expect(most).toBe(4);
});

test("FC-260: a 429 is waited out and retried, not handed to the browser's voice", async () => {
  let calls = 0;
  const fn = async () => ++calls < 3
    ? Response.json({ detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests." } }, { status: 429 })
    : new Response(new Uint8Array([7]), { headers: { "content-type": "audio/mpeg" } });
  const tts = new ElevenLabs({ key: "k", fetch: fn, retryMs: [1, 1] });
  const res = await tts.speak("Idle.", "v");
  expect(res.status).toBe(200);
  expect(calls).toBe(3);
  // Past the retries it's still an error the console can show.
  calls = -10;
  const refused = await new ElevenLabs({ key: "k", fetch: fn, retryMs: [1] }).speak("Idle.", "v");
  expect(refused.status).toBe(502);
  expect(await refused.text()).toContain("Too many concurrent requests");
});
