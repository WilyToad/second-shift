// Visual components the agent can put in an answer as terse fenced specs (PLAN §3 visual component
// library). The model only names what to draw; the data comes from the page's recorded history.
import { useSignal } from "@preact/signals";
import type { BlueprintCard } from "../../server/src/messages";
import type { Plan } from "../../server/src/planner";
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

const pretty = (name: string) => name.replace(/-/g, " ");

/** The computed plan as a left-to-right chain: raw inputs, intermediates, then the target (S09). */
export function RecipeGraph({ plan }: { plan: Plan }) {
  // Column = longest distance from the raw inputs, so each step sits right of everything it consumes.
  const steps = new Map(plan.steps.map((s) => [s.item, s]));
  const column = new Map<string, number>();
  const depth = (item: string, seen: string[] = []): number => {
    if (column.has(item)) return column.get(item)!;
    const step = steps.get(item);
    const d = !step || seen.includes(item) ? 0 : 1 + Math.max(0, ...step.inputs.map((i) => depth(i, [...seen, item])));
    column.set(item, d);
    return d;
  };
  const nodes = [...Object.keys(plan.raw), ...plan.steps.map((s) => s.item)].filter((v, i, a) => a.indexOf(v) === i);
  nodes.forEach((n) => depth(n));
  const columns = Math.max(...nodes.map((n) => column.get(n)!)) + 1;
  const byColumn = Array.from({ length: columns }, (_, c) => nodes.filter((n) => column.get(n) === c));
  const NW = 170, NH = 44, GX = 40, GY = 12, PAD = 10;
  const width = PAD * 2 + columns * NW + (columns - 1) * GX;
  const height = PAD * 2 + Math.max(...byColumn.map((c) => c.length)) * (NH + GY) - GY;
  const pos = new Map<string, { x: number; y: number }>();
  byColumn.forEach((items, c) => items.forEach((item, r) => pos.set(item, { x: PAD + c * (NW + GX), y: PAD + r * (NH + GY) })));
  const edges = plan.steps.flatMap((s) => s.inputs.filter((i) => pos.has(i)).map((i) => [i, s.item] as const));
  return (
    <figure class="vis">
      <figcaption class="vis-head">{plan.perMinute}/min {pretty(plan.item)}<span class="tag">recipe_graph · computed plan</span></figcaption>
      <div class="graph-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Production chain for ${plan.perMinute} ${pretty(plan.item)} per minute`}>
          {edges.map(([from, to]) => {
            const a = pos.get(from)!, b = pos.get(to)!;
            const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
            return <path key={`${from}>${to}`} class="graph-edge" d={`M${x1} ${y1} C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}`} />;
          })}
          {nodes.map((n) => {
            const p = pos.get(n)!, step = steps.get(n);
            return (
              <g key={n} class={`graph-node${step ? "" : " raw"}${step && !step.unlocked ? " locked" : ""}`}>
                <rect x={p.x} y={p.y} width={NW} height={NH} rx="3" />
                <text class="graph-name" x={p.x + 8} y={p.y + 17}>{pretty(n).slice(0, 24)}</text>
                <text class="graph-sub" x={p.x + 8} y={p.y + 34}>{step ? `${step.machines}× ${pretty(step.machine)}`.slice(0, 26) : `${plan.raw[n]}/min input`}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div class="vis-note">{plan.notes.join(" · ")}</div>
    </figure>
  );
}

/** A blueprint built in code: a top-down tile sketch and a button that copies the string (S14). */
export function BlueprintView({ card }: { card: BlueprintCard }) {
  const copied = useSignal<"idle" | "copied" | "select">("idle");
  // Tile size shrinks for big blueprints so the sketch stays about a panel wide.
  const T = Math.max(2, Math.min(14, Math.floor(760 / card.width))), PAD = 6;
  const width = card.width * T + PAD * 2, height = card.height * T + PAD * 2;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.string);
      copied.value = "copied";
    } catch {
      copied.value = "select"; // clipboard blocked: show the string to copy by hand
    }
  };
  return (
    <figure class="vis blueprint">
      <figcaption class="vis-head">{pretty(card.label)}<span class="tag">layout_sketch · built in code</span></figcaption>
      <div class="graph-scroll">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Layout of ${card.label}: ${card.summary}`}>
          {card.sketch.map((e, i) => {
            const x = PAD + e.x * T, y = PAD + e.y * T, w = e.w * T, h = e.h * T;
            // Belts and inserters get a direction tick: 0 north, 4 east, 8 south, 12 west.
            const turn = e.direction === undefined ? null : (e.direction / 16) * 2 * Math.PI;
            return (
              <g key={i} class={`bp-${e.kind}`}>
                <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={e.w > 1 ? 2 : 1}><title>{pretty(e.name)}</title></rect>
                {turn !== null && <line x1={x + w / 2} y1={y + h / 2} x2={x + w / 2 + Math.sin(turn) * w * 0.35} y2={y + h / 2 - Math.cos(turn) * h * 0.35} />}
              </g>
            );
          })}
        </svg>
      </div>
      <div class="vis-note">{card.summary}</div>
      <div class="bp-actions">
        <button onClick={copy}>{copied.value === "copied" ? "Copied" : "Copy blueprint string"}</button>
        {copied.value === "select" && <textarea class="bp-string" readOnly rows={3} value={card.string} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />}
      </div>
    </figure>
  );
}
