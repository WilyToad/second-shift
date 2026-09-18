// Time series for the console's sparklines and rate charts, built from the snapshot history.
import type { Digest } from "@companion/interfaces";
import type { Snapshot } from "./game";

export type Point = { t: number; v: number };
/** Keys look like "gleba/produced/bioflux" or "nauvis/science/automation-science-pack". */
export type SeriesMap = Record<string, Point[]>;

export function pointsFrom(digest: Digest, _t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of digest.surfaces) {
    for (const r of s.produced) out[`${s.name}/produced/${r.name}`] = r.per_minute;
    for (const r of s.science) out[`${s.name}/science/${r.name}`] = r.per_minute;
  }
  return out;
}

/** Series from history, downsampled to at most `maxPoints` per key (latest point always kept). */
export function buildSeries(history: Snapshot[], maxPoints = 120): SeriesMap {
  const all: SeriesMap = {};
  for (const snap of history) {
    for (const [key, v] of Object.entries(pointsFrom(snap.digest, snap.receivedAt))) (all[key] ??= []).push({ t: snap.receivedAt, v });
  }
  for (const [key, points] of Object.entries(all)) {
    if (points.length <= maxPoints) continue;
    const step = points.length / maxPoints;
    const sampled = Array.from({ length: maxPoints - 1 }, (_, i) => points[Math.floor(i * step)]!);
    all[key] = [...sampled, points.at(-1)!];
  }
  return all;
}
