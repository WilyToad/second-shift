import { expect, test } from "bun:test";
import { generateSound, SOUND_NAMES, SOUNDS } from "./sfx";

test("FC-150: every sound is short and generated with the key in a header", async () => {
  for (const name of SOUND_NAMES) expect(SOUNDS[name].seconds).toBeGreaterThanOrEqual(0.5);
  for (const name of SOUND_NAMES) expect(SOUNDS[name].seconds).toBeLessThanOrEqual(1.5);
  const calls: { url: string; init?: RequestInit }[] = [];
  const bytes = await generateSound("sk_secret", "listen", async (url, init) => { calls.push({ url, init }); return new Response(new Uint8Array([9, 9])); });
  expect(bytes).toEqual(new Uint8Array([9, 9]));
  expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
  expect(calls[0]!.url).not.toContain("sk_secret");
  expect((calls[0]!.init!.headers as Record<string, string>)["xi-api-key"]).toBe("sk_secret");
  expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ text: SOUNDS.listen.prompt, duration_seconds: 0.6, prompt_influence: 0.6 });
  await expect(generateSound("bad", "done", async () => Response.json({ detail: { message: "Quota exceeded" } }, { status: 429 }))).rejects.toThrow("ElevenLabs 429: Quota exceeded");
});
