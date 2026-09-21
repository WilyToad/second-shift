// The console's side panels: the alert feed (left) and live factory state (right).
import type { GameEvent } from "@companion/interfaces";
import { useSignal } from "@preact/signals";
import type { Point } from "../../server/src/series";
import { RichName } from "./rich-text";
import { digest, droppedEvents, events, notes, send, series, lists, watching } from "./store";

const round = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : String(Math.round(n * 10) / 10));
const words = (s: string) => s.replace(/[-_]/g, " ");

function ago(tick: number, now: number | undefined): string {
  if (now === undefined) return "";
  const s = Math.max(0, Math.round((now - tick) / 60));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

function describe(e: GameEvent): string {
  if (e.kind === "research_finished") return `Research complete: ${words(e.research ?? "")}`;
  if (e.kind === "selection") return e.count ? `Build selected for review (${e.count} entities)` : "Selection had nothing to review";
  // What the companion was moving (FC-051, FC-144).
  if (e.kind === "control_arrived") return `${words(e.entity ?? "it")} arrived${e.position ? ` at (${e.position.x}, ${e.position.y})` : ""}`;
  if (e.kind === "control_stopped") return `Stopped ${words(e.entity ?? e.control ?? "it")}${e.reason ? ` (${words(e.reason)})` : ""}`;
  const what = e.entity ? `${words(e.entity)}: ` : "";
  return `${what}${words(e.type ?? "alert")}${e.count && e.count > 1 ? ` (${e.count})` : ""}`;
}

/** The companion's lists (FC-163): the whole active list, done items ticked. Nothing here is clickable — the
 * player asks the companion to change a list, which is what they wanted. */
export function ListPanel() {
  const { lists: all, active } = lists.value;
  if (!all.length) return null;
  const current = all.find((l) => l.name === active) ?? all[0]!;
  // An item whose words name nothing in this save can never be ticked, so it isn't part of the count — the
  // companion says "3 of 9" and the panel has to agree with him (FC-246).
  const tracked = current.items.filter((i) => !i.untracked);
  const done = tracked.filter((i) => i.done).length;
  return (
    <section class="panel list-panel" aria-label="Lists the companion keeps">
      <div class="panel-head">
        <span class="label">{current.name}</span>
        <span class="label-sub num">{done} of {tracked.length} done</span>
      </div>
      <ul class="check-list">
        {current.items.length === 0 && <li class="empty">Ask for items and they show up here.</li>}
        {current.items.map((item) => (
          <li key={item.text} class="check" data-done={item.untracked ? "untracked" : item.done ? "yes" : "no"}>
            <span class="tick" aria-hidden="true">{item.untracked ? "?" : item.done ? "✓" : "○"}</span>
            <span class="check-text"><RichName text={item.text} />{item.note ? <span class="check-note"> — {item.note}</span> : null}{item.untracked ? <span class="check-note"> — not a thing in this save, so it isn't counted</span> : null}</span>
          </li>
        ))}
      </ul>
      {all.length > 1 && (
        <div class="panel-foot label-sub">
          also: {all.filter((l) => l !== current).map((l) => { const t = l.items.filter((i) => !i.untracked); return `${l.name} (${t.filter((i) => i.done).length}/${t.length})`; }).join(", ")}
        </div>
      )}
    </section>
  );
}

export function AlertFeed() {
  const now = digest.value?.digest.tick;
  const list = [...events.value].reverse();
  const active = digest.value?.digest.alerts ?? [];
  return (
    <aside class="col-alerts panel" aria-label="Alerts">
      <div class="panel-head"><span class="label">Alerts</span><span class="label-sub">{active.length ? `${active.reduce((n, a) => n + a.count, 0)} active` : "none active"}</span></div>
      {/* The second shift (FC-193): quiet, off by default, and it only ever says things — it never acts. */}
      <label class="watch-toggle" title="Ballast looks at the factory every few minutes while you play and writes at most one line here. He never acts on what he finds.">
        <input type="checkbox" id="watching" checked={watching.value} onChange={(e) => send({ type: "watch", on: e.currentTarget.checked })} />
        Keep an eye on things
      </label>
      {notes.value.slice().reverse().map((n) => (
        <div class="note" key={n.at}>
          <div class="alert-meta"><span>second shift</span><span class="num">{new Date(n.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
          <div class="alert-text">{n.text}</div>
        </div>
      ))}
      {droppedEvents.value > 0 && <div class="notice">{droppedEvents.value} older events were missed</div>}
      <ul class="alert-list">
        {list.length === 0 && <li class="empty">Urgent alerts and finished research show up here as they happen.</li>}
        {list.map((e) => (
          <li key={e.seq} class="alert" data-sev={e.severity}>
            <span class="stripe" />
            <div class="alert-body">
              <div class="alert-meta"><span>{e.surface ? <RichName text={e.surface} /> : ""}{e.position ? ` · ${e.position.x}, ${e.position.y}` : ""}</span><span class="num">{ago(e.tick, now)}</span></div>
              <div class="alert-text">{describe(e)}</div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function Sparkline({ points, width = 72, height = 22, down = false }: { points: Point[]; width?: number; height?: number; down?: boolean }) {
  if (points.length < 2) return <svg class="spark" width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...points.map((p) => p.v), 1) * 1.1;
  const t0 = points[0]!.t, t1 = points.at(-1)!.t || t0 + 1;
  const x = (t: number) => 2 + ((t - t0) / Math.max(t1 - t0, 1)) * (width - 4);
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
  const line = points.map((p) => `${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" L");
  return (
    <svg class={`spark${down ? " down" : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path class="area" d={`M${line} L${x(t1).toFixed(1)} ${height} L2 ${height} Z`} />
      <path class="line" d={`M${line}`} />
    </svg>
  );
}

export function LivePanel() {
  const d = digest.value?.digest;
  const chosen = useSignal<string | null>(null);
  if (!d) return <aside class="col-live panel"><div class="panel-head"><span class="label">Live state</span></div><div class="panel-body empty">Waiting for the game…</div></aside>;
  const surfaces = d.surfaces;
  const current = surfaces.find((s) => s.name === (chosen.value ?? d.player?.surface)) ?? surfaces[0];
  const r = d.research;
  return (
    <aside class="col-live" aria-label="Live factory state">
      <section class="panel">
        <div class="panel-head"><span class="label">Live state</span><span class="label-sub num">tick {d.tick.toLocaleString()}</span></div>
        <div class="surface-tabs" role="tablist">
          {surfaces.map((s) => (
            <button type="button" key={s.name} role="tab" aria-selected={s === current} onClick={() => (chosen.value = s.name)}>{s.platform ? <RichName text={s.platform} /> : words(s.name)}</button>
          ))}
        </div>
        {current && (
          <div class="panel-body">
            <div class="sub-label">Top produced / min</div>
            {current.produced.slice(0, 6).map((p) => (
              <div class="rate-row" key={p.name}>
                <span>{words(p.name)}</span>
                <Sparkline points={series.value[`${current.name}/produced/${p.name}`] ?? []} />
                <span class="num">{round(p.per_minute)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section class="panel">
        <div class="panel-head"><span class="label">Science / min</span><span class="label-sub">now · 10 h avg</span></div>
        <div class="panel-body">
          {surfaces.flatMap((s) => s.science.map((x) => ({ s, x }))).length === 0 && <div class="empty">No science produced yet.</div>}
          {surfaces.flatMap((s) => s.science.map((x) => (
            <div class="rate-row" key={`${s.name}/${x.name}`}>
              <span title={s.name}>{words(x.name.replace(/-science-pack$/, ""))}</span>
              <Sparkline points={series.value[`${s.name}/science/${x.name}`] ?? []} down={x.per_minute < x.per_minute_10h * 0.5} />
              <span class={`num${x.per_minute < x.per_minute_10h * 0.5 ? " delta-down" : ""}`}>{round(x.per_minute)} · {round(x.per_minute_10h)}</span>
            </div>
          )))}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><span class="label">Research</span>{r.current && <span class="label-sub num">{Math.round(r.progress * 100)}%</span>}</div>
        <div class="panel-body">
          {r.current ? (
            <>
              <div class="research-name">{words(r.current)}</div>
              <div class="progress" aria-hidden="true"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></div>
              {r.queue.length > 1 && <ul class="queue">{r.queue.slice(1, 4).map((q) => <li key={q}>{words(q)}</li>)}</ul>}
            </>
          ) : <div class="empty warn">Nothing is being researched.</div>}
        </div>
      </section>
    </aside>
  );
}
