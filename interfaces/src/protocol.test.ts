import { expect, test } from "bun:test";
import { DigestSchema, encodeCommand, MAX_COMMAND_BYTES, parseReply } from "./index";

test("encodes a request as one /companion command", () => {
  expect(encodeCommand({ id: 3, action: "ping" })).toBe('/companion {"id":3,"action":"ping"}');
});

test("refuses commands over the size limit before they reach the game", () => {
  expect(() => encodeCommand({ id: 1, action: "ping", args: { pad: "x".repeat(MAX_COMMAND_BYTES) } })).toThrow("the limit is");
});

test("parses a reply and the optional profile line", () => {
  const { reply, profile } = parseReply('{"id":1,"ok":true,"data":{"tick":5}}\nprofile Duration: 0.19ms');
  expect(reply).toEqual({ id: 1, ok: true, data: { tick: 5 } });
  expect(profile).toBe("0.19ms");
});

test("digest accepts {} for empty Lua arrays", () => {
  const d = DigestSchema.parse({ tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {} });
  expect(d.research.queue).toEqual([]);
  expect(d.surfaces).toEqual([]);
});

test("digest capture from the dev save validates", async () => {
  const file = Bun.file(new URL("../../data/captures/digest.json", import.meta.url));
  if (!(await file.exists())) return; // captures are local-only
  const data = await file.json();
  expect(() => DigestSchema.parse(data)).not.toThrow();
});
