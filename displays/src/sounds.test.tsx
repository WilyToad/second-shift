import { beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

beforeAll(() => {
  const window = new Window({ url: "http://127.0.0.1:5170/" });
  Object.assign(globalThis, { window, document: window.document });
});

beforeEach(async () => {
  const sounds = await import("./sounds");
  sounds.resetSoundThrottle();
  sounds.setSoundsOn(true);
  sounds.generated.value = new Set();
});

test("FC-150: generated sounds play when the server has them, built-in tones otherwise, and repeats are throttled", async () => {
  const { playSound, generated } = await import("./sounds");
  const played: string[] = [];
  const player = { file: (n: string) => played.push(`file:${n}`), tone: (n: string) => played.push(`tone:${n}`) };
  expect(playSound("listen", 1000, player)).toBe(true);
  generated.value = new Set(["alert-critical"]);
  expect(playSound("alert-critical", 1000, player)).toBe(true);
  expect(playSound("alert-critical", 3000, player)).toBe(false); // an attack wave isn't a drum roll
  expect(playSound("alert-critical", 6000, player)).toBe(true);
  expect(played).toEqual(["tone:listen", "file:alert-critical", "file:alert-critical"]);
});

test("FC-150: the Sounds switch silences everything and is remembered", async () => {
  const { playSound, setSoundsOn, soundsOn } = await import("./sounds");
  const played: string[] = [];
  setSoundsOn(false);
  expect(playSound("done", 1000, { file: (n) => played.push(n), tone: (n) => played.push(n) })).toBe(false);
  expect(played).toEqual([]);
  expect(soundsOn.value).toBe(false);
});

test("FC-150: live alerts, research and cards make sounds; the replay on connect doesn't", async () => {
  const sounds = await import("./sounds");
  const { onMessage } = await import("./store");
  const played: string[] = [];
  // Observe through the throttle: a played sound can't play again immediately.
  const attack = { seq: 101, tick: 1, kind: "alert" as const, severity: "critical" as const, type: "entity_under_attack", count: 3 };
  onMessage({ type: "events", events: [attack], replay: true });
  expect(sounds.playSound("alert-critical", Date.now(), { file: () => played.push("f"), tone: () => played.push("t") })).toBe(true); // the replay didn't play it
  sounds.resetSoundThrottle();
  onMessage({ type: "events", events: [{ ...attack, seq: 102 }] });
  expect(sounds.playSound("alert-critical", Date.now(), { file: () => {}, tone: () => {} })).toBe(false); // the live one just did
  onMessage({ type: "events", events: [{ seq: 103, tick: 2, kind: "research_finished", severity: "info", research: "automation" }] });
  expect(sounds.playSound("research", Date.now(), { file: () => {}, tone: () => {} })).toBe(false);
  onMessage({ type: "approval", id: "a9", title: "Mark 2 rails?", detail: "" });
  expect(sounds.playSound("approval", Date.now(), { file: () => {}, tone: () => {} })).toBe(false);
  onMessage({ type: "approval_result", id: "a9", status: "done", message: "Marked 2." });
  expect(sounds.playSound("done", Date.now(), { file: () => {}, tone: () => {} })).toBe(false);
});
