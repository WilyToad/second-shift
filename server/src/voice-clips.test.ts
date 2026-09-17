import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintId, VoiceClips } from "./voice-clips";

const dir = await mkdtemp(join(tmpdir(), "clips-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("FC-188: a clip is kept with its record, and the player's own words can be added later", async () => {
  const clips = new VoiceClips(dir);
  const id = await clips.save(new Uint8Array([82, 73, 70, 70]), { heard: "okay I'm running where", seconds: 2.4, sampleRate: 16000, detail: { offered: ["okay I'm running where"], phrases: 100 } });
  expect(id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
  expect(await readFile(join(dir, `${id}.wav`))).toEqual(Buffer.from([82, 73, 70, 70]));
  expect(await clips.count()).toEqual({ clips: 1, withTruth: 0 });

  expect(await clips.setTruth(id, "okay I'm running wire")).toBe(true);
  const meta = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
  expect(meta.said).toBe("okay I'm running wire");
  expect(meta.heard).toBe("okay I'm running where"); // what the engine gave is kept beside it
  expect(meta.detail.phrases).toBe(100);
  expect(await clips.count()).toEqual({ clips: 1, withTruth: 1 });
});

test("FC-188: an id the server didn't mint can't name a file", async () => {
  const clips = new VoiceClips(dir);
  for (const bad of ["../../../etc/passwd", "20260917-120000-abc/../x", "nope", ""]) {
    expect(await clips.setTruth(bad, "x")).toBe(false);
  }
  // A well-formed id for a clip that doesn't exist is refused too.
  expect(await clips.setTruth(mintId(), "x")).toBe(false);
});
