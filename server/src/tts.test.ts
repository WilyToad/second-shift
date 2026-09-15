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

test("FC-148: speech streams from ElevenLabs' flash model with the key in a header, never in the URL", async () => {
  const { fn, calls } = fakeFetch((url) => url.includes("/v2/voices")
    ? Response.json({ voices: [{ voice_id: "v1", name: "Aria", category: "premade" }] })
    : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
  const tts = new ElevenLabs({ key: "sk_secret", fetch: fn });
  expect(await tts.listVoices()).toEqual([{ id: "v1", name: "Aria", category: "premade" }]);
  const res = await tts.speak("  Gleba makes 1,493 per minute of jelly.  ", undefined, "Earlier sentence.");
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  const speech = calls.at(-1)!;
  expect(speech.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v1/stream?output_format=mp3_44100_128");
  expect(speech.url).not.toContain("sk_secret");
  expect((speech.init!.headers as Record<string, string>)["xi-api-key"]).toBe("sk_secret");
  expect(JSON.parse(String(speech.init!.body))).toEqual({ text: "Gleba makes 1,493 per minute of jelly.", model_id: "eleven_flash_v2_5", previous_text: "Earlier sentence." });
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
