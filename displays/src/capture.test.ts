import { expect, test } from "bun:test";
import { resample, TARGET_RATE, wav } from "./capture";

test("FC-188: audio is written as the 16 kHz mono PCM every candidate transcriber reads", () => {
  // A second of 48 kHz comes out as a second of 16 kHz.
  const input = new Float32Array(48000).map((_, i) => Math.sin((i / 48000) * 2 * Math.PI * 440));
  const down = resample(input, 48000);
  expect(down.length).toBe(16000);
  expect(Math.max(...down)).toBeLessThanOrEqual(1);
  expect(resample(input, 16000, 16000)).toBe(input); // already there: untouched

  const bytes = wav(new Float32Array([0, 1, -1, 0.5]));
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
  const view = new DataView(bytes.buffer);
  expect(view.getUint16(20, true)).toBe(1); // PCM
  expect(view.getUint16(22, true)).toBe(1); // mono
  expect(view.getUint32(24, true)).toBe(TARGET_RATE);
  expect(view.getUint16(34, true)).toBe(16); // bits per sample
  expect(view.getUint32(40, true)).toBe(8); // four samples, two bytes each
  // Full scale and clipping both land where they should.
  expect(view.getInt16(44 + 2, true)).toBe(32767);
  expect(view.getInt16(44 + 4, true)).toBe(-32767);
  expect(bytes.length).toBe(44 + 8);
});
