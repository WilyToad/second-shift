import { describe, expect, test } from "bun:test";
import { composing, keepWarm, TYPING_WINDOW_MS, WAKE_EVERY_MS } from "./warm";

describe("composing", () => {
  test("talking counts once words are heard; typing counts for a while after the last key", () => {
    expect(composing({ listening: true, heard: "", lastTypedAt: 0 }, 1_000)).toBe(false);
    expect(composing({ listening: true, heard: "where is", lastTypedAt: 0 }, 1_000)).toBe(true);
    expect(composing({ listening: false, heard: "where is", lastTypedAt: 0 }, 1_000)).toBe(false);
    expect(composing({ listening: false, heard: "", lastTypedAt: 5_000 }, 5_000 + TYPING_WINDOW_MS - 1)).toBe(true);
    expect(composing({ listening: false, heard: "", lastTypedAt: 5_000 }, 5_000 + TYPING_WINDOW_MS)).toBe(false);
  });
});

describe("keepWarm", () => {
  test("wakes at most once per interval, only while active", () => {
    let t = 0;
    let active = true;
    let wakes = 0;
    const warm = keepWarm(() => active, () => wakes++, () => t);
    warm.stop();
    expect(warm.tick()).toBe(true);
    t = WAKE_EVERY_MS - 1;
    expect(warm.tick()).toBe(false);
    t = WAKE_EVERY_MS;
    expect(warm.tick()).toBe(true);
    active = false;
    t = 10 * WAKE_EVERY_MS;
    expect(warm.tick()).toBe(false);
    expect(wakes).toBe(2);
  });
});
