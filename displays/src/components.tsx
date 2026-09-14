// Visual components the agent can put in an answer as terse fenced specs (PLAN §3 visual component
// library). The model only names what to draw; the data comes from the page's recorded history.
import type { Point } from "../../server/src/series";
import { series } from "./store";

export type RateChartSpec = { kind: "rate_chart"; item: string; surface: string; windowMin: number; source: "produced" | "science" };
export type Segment = { kind: "text"; text: string } | { kind: "pending" } | RateChartSpec;

const BLOCK = /```rate_chart[ \t]*\n?([^`]*?)```/g;

export function parseSpec(body: string): RateChartSpec | null {
  const fields = Object.fromEntries([...body.matchAll(/(\w+)=([^\s]+)/g)].map((m) => [m[1]!, m[2]!]));
  if (!fields.item || !fields.surface) return null;
  const window = /^(\d+)(m|h)?$/.exec(fields.window ?? "30m");
  const windowMin = window ? Number(window[1]) * (window[2] === "h" ? 60 : 1) : 30;
  return { kind: "rate_chart", item: fields.item, surface: fields.surface, windowMin, source: fields.item.endsWith("science-pack") ? "science" : "produced" };
}

/** Splits streamed answer text into text and chart specs; an unfinished block shows as pending. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(BLOCK)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(parseSpec(m[1]!) ?? { kind: "text", text: m[0] });
    last = m.index! + m[0].length;
  }
  const rest = text.slice(last);
  const open = rest.indexOf("```rate_chart");
  if (open >= 0) {
    if (open > 0) out.push({ kind: "text", text: rest.slice(0, open) });
    out.push({ kind: "pending" });
  } else if (rest) {
    out.push({ kind: "text", text: rest });
  }
  return out;
}

const W = 560, H = 190, L = 44, R = 548, T = 14, B = 160;
const label = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 10) / 10));

export function RateChart({ spec }: { spec: RateChartSpec }) {
  const key = `${spec.surface}/${spec.source}/${spec.item}`;
  const all = series.value[key] ?? [];
  const cutoff = (all.at(-1)?.t ?? 0) - spec.windowMin * 60_000;
  const points: Point[] = all.filter((p) => p.t >= cutoff);
  const title = `${spec.item.replace(/-/g, " ")} on ${spec.surface}, per minute`;
  if (points.length < 2) {
    return <figure class="vis"><figcaption class="vis-head">{title}</figcaption><div class="vis-empty">No recorded history for {spec.item} on {spec.surface} yet.</div></figure>;
  }
  const t0 = points[0]!.t, t1 = points.at(-1)!.t;
  const max = Math.max(...points.map((p) => p.v), 1) * 1.15;
  const x = (t: number) => L + ((t - t0) / Math.max(t1 - t0, 1)) * (R - L);
  const y = (v: number) => B - (v / max) * (B - T);
  const line = points.map((p) => `${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" L");
  const ticks = [0, max / 3, (2 * max) / 3].map((v) => Math.round(v));
  const spanMin = Math.round((t1 - t0) / 60_000);
  const latest = points.at(-1)!;
  return (
    <figure class="vis">
      <figcaption class="vis-head">{title}<span class="tag">rate_chart · recorded history</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${label(latest.v)} now over the last ${spanMin} minutes`}>
        {ticks.map((v) => (
          <g key={v}>
            <line class={v === 0 ? "axis" : "grid"} x1={L} x2={R} y1={y(v)} y2={y(v)} />
            <text class="tick" x={L - 8} y={y(v) + 4} text-anchor="end">{label(v)}</text>
          </g>
        ))}
        <text class="tick" x={L} y={B + 20}>−{spanMin || "<1"} min</text>
        <text class="tick" x={R} y={B + 20} text-anchor="end">now</text>
        <path class="chart-area" d={`M${line} L${x(t1)} ${B} L${L} ${B} Z`} />
        <path class="chart-line" d={`M${line}`} />
        <circle class="chart-end" cx={x(latest.t)} cy={y(latest.v)} r="4" />
        <text class="end-label" x={x(latest.t) - 8} y={Math.max(y(latest.v) - 10, T + 10)} text-anchor="end">{label(latest.v)}/min</text>
      </svg>
    </figure>
  );
}
