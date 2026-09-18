// Serves the static site, adding byte-range (206) answers that Workers static assets don't give on their own.
// Safari and iOS only play <video> from servers that honour Range requests. Files here are at most a few MB.
type Assets = { fetch(request: Request): Promise<Response> };

/** Answers a Range request from a full asset response; anything else passes through unchanged. */
export async function withRange(request: Request, response: Response): Promise<Response> {
  const range = request.headers.get("range");
  if (!range || response.status !== 200) return response;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) return response;
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  // "bytes=500-" from 500 to the end; "bytes=-500" the last 500 bytes.
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  if (start >= size || start > end) {
    headers.set("content-range", `bytes */${size}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

export default {
  async fetch(request: Request, env: { ASSETS: Assets }): Promise<Response> {
    return withRange(request, await env.ASSETS.fetch(request));
  },
};
