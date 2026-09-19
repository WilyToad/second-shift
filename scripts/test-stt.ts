// FC-230: the /stt route against real clips from the player's sessions (server running, whisper installed).
// Usage: bun scripts/test-stt.ts
export {}; // a module, so top-level await is allowed
const stt = await (await fetch("http://127.0.0.1:5170/stt/status")).json() as { available: boolean; ready: boolean; reason?: string; model: string; vad: boolean };
console.log("status:", JSON.stringify(stt));
if (!stt.ready) { console.log("whisper isn't ready; nothing to test"); process.exit(stt.available ? 1 : 0); }
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const post = async (file: string) => {
  const wav = await Bun.file(file).arrayBuffer();
  const started = performance.now();
  const res = await fetch("http://127.0.0.1:5170/stt", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
  return { ...(await res.json()) as { text: string; ms: number; gated?: string }, wall: performance.now() - started, status: res.status };
};
const dir = "data/captures/voice";
// The three FC-189 misses a normalizer can fix, plus a clean one and the noise clip Whisper called "Thank you."
const cases: [string, RegExp | null, string][] = [
  ["20260918-222443-fuys", /send the spidertron to the ore patch/i, "spidertron put back from Spider-Tron"],
  ["20260918-222753-mb7k", /spidertron to the nearest roboport/i, "spidertron and roboport put back"],
  ["20260918-220805-3hgp", /really hitting/i, "the dropped syllable the browser missed"],
  ["20260918-211618-rwvi", /okay,? i'm running wire/i, "the forty-Ballasts clip, recovered"],
  ["20260918-211646-abob", null, "the noise clip: refused or empty, never 'Thank you.'"],
];
const walls: number[] = [];
for (const [id, want, why] of cases) {
  const r = await post(`${dir}/${id}.wav`);
  walls.push(r.wall);
  if (want) check(`${id}: ${why}`, r.status === 200 && want.test(r.text), `"${r.text}" in ${Math.round(r.wall)} ms${r.gated ? ` (gated: ${r.gated})` : ""}`);
  else check(`${id}: ${why}`, r.status === 200 && (!!r.gated || r.text === "" || !/^thank/i.test(r.text)), `"${r.text}"${r.gated ? ` (gated: ${r.gated})` : ""}`);
}
walls.sort((a, b) => a - b);
check("round trip through the server stays under 300 ms at p95", walls[Math.floor(walls.length * 0.95)]! < 300, `p50 ${Math.round(walls[Math.floor(walls.length / 2)]!)} ms, max ${Math.round(walls.at(-1)!)} ms`);
// A silent clip is refused by loudness before whisper sees it.
const silent = new Uint8Array(44 + 32000);
const r = await fetch("http://127.0.0.1:5170/stt", { method: "POST", headers: { "content-type": "audio/wav" }, body: silent });
const j = await r.json() as { gated?: string };
check("a silent clip is refused as quiet", j.gated === "quiet", JSON.stringify(j));
const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed < results.length ? 1 : 0);
