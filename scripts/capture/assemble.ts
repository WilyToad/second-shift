// Timestamped frames (frames.json) → constant-rate MP4.  bun scripts/capture/assemble.ts <dir> <out.mp4> [--from s] [--to s] [--speed x] [--scale w] [--hold s]
import { existsSync } from "node:fs";
const [dir, out, ...rest] = Bun.argv.slice(2);
if (!dir || !out) throw new Error("usage: assemble.ts <dir> <out.mp4> [--from s] [--to s] [--speed x] [--scale w] [--hold s]");
const arg = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d; };
const from = arg("--from", 0), to = arg("--to", 1e9), speed = arg("--speed", 1), width = arg("--scale", 1440), hold = arg("--hold", 2);
const frames = ((await Bun.file(`${dir}/frames.json`).json()) as { file: string; t: number }[]).filter((f) => existsSync(f.file));
const t0 = frames[0]!.t;
const keep = frames.filter((f) => f.t - t0 >= from && f.t - t0 <= to);
let list = "";
keep.forEach((f, i) => { const next = keep[i + 1]; const d = next ? (next.t - f.t) / speed : hold; list += `file '${f.file}'\nduration ${Math.max(d, 1 / 60).toFixed(4)}\n`; });
list += `file '${keep.at(-1)!.file}'\n`;
await Bun.write(`${dir}/concat.txt`, list);
const p = Bun.spawnSync(["/opt/homebrew/bin/ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${dir}/concat.txt`, "-vf", `fps=30,scale=${width}:-2:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", out]);
console.log(p.exitCode === 0 ? `${out}: ${keep.length} frames, ${((keep.at(-1)!.t - keep[0]!.t) / speed + hold).toFixed(1)} s` : p.stderr.toString());
