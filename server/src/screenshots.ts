// Screenshots the game writes to script-output on request (FC-049): wait until a file is complete, serve it,
// and keep only the newest few so captures don't pile up.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const SHOT_NAME = /^shot-\d+-\d+\.jpg$/;
export const KEEP_SHOTS = 20;

/** Waits for the game to finish writing `relative` under `outputDir` (size stable across two polls). */
export async function waitForShot(outputDir: string, relative: string, timeoutMs = 5000): Promise<string> {
  const file = join(outputDir, relative);
  const end = performance.now() + timeoutMs;
  let last = -1;
  while (performance.now() < end) {
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0 && size === last) return basename(file);
    last = size;
    await Bun.sleep(25);
  }
  throw new Error("the game didn't write the screenshot in time");
}

/** Deletes all but the newest `keep` screenshots in `dir`. */
export function pruneShots(dir: string, keep = KEEP_SHOTS): number {
  if (!existsSync(dir)) return 0;
  const shots = readdirSync(dir).filter((n) => SHOT_NAME.test(n)).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const old of shots.slice(keep)) rmSync(join(dir, old.n), { force: true });
  return Math.max(0, shots.length - keep);
}
