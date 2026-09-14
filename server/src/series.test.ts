import { expect, test } from "bun:test";
import { DigestSchema } from "@companion/interfaces";
import { buildSeries } from "./series";

const digest = (rate: number) => DigestSchema.parse({
  tick: 1, research: { progress: 0, queue: {} }, alerts: {},
  surfaces: [{ name: "gleba", produced: [{ name: "bioflux", per_minute: rate }], consumed: {}, science: [{ name: "agricultural-science-pack", per_minute: rate / 2, per_minute_10h: 10 }], age_ticks: 0 }],
});

test("series per surface and item, downsampled with the latest point kept", () => {
  const history = Array.from({ length: 500 }, (_, i) => ({ digest: digest(i), receivedAt: 1000 + i }));
  const s = buildSeries(history, 50);
  expect(s["gleba/produced/bioflux"]!.length).toBe(50);
  expect(s["gleba/produced/bioflux"]!.at(-1)).toEqual({ t: 1499, v: 499 });
  expect(s["gleba/science/agricultural-science-pack"]!.at(-1)!.v).toBe(249.5);
});
