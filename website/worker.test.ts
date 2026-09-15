import { expect, test } from "bun:test";
import { withRange } from "./worker";

const asset = () => new Response(new Uint8Array([...Array(10).keys()]), { status: 200, headers: { "content-type": "video/mp4", etag: '"x"' } });
const ask = (range?: string) => new Request("https://second-shift.wilytoad.com/clip.mp4", { headers: range ? { range } : {} });

test("byte ranges get 206 with the right slice; plain requests pass through", async () => {
  const plain = await withRange(ask(), asset());
  expect(plain.status).toBe(200);

  const first = await withRange(ask("bytes=0-1"), asset());
  expect(first.status).toBe(206);
  expect(first.headers.get("content-range")).toBe("bytes 0-1/10");
  expect(first.headers.get("content-type")).toBe("video/mp4");
  expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([0, 1]);

  expect((await withRange(ask("bytes=7-"), asset())).headers.get("content-range")).toBe("bytes 7-9/10");
  expect([...new Uint8Array(await (await withRange(ask("bytes=-3"), asset())).arrayBuffer())]).toEqual([7, 8, 9]);
  expect((await withRange(ask("bytes=5-99"), asset())).headers.get("content-length")).toBe("5");
  expect((await withRange(ask("bytes=20-30"), asset())).status).toBe(416);
  expect((await withRange(ask("bytes=0-1"), new Response("gone", { status: 404 }))).status).toBe(404);
});
