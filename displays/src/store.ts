// Page state as signals, fed by the server's WebSocket. Components read these; only this file writes.
import { signal, type Signal } from "@preact/signals";
import type { Digest, GameEvent } from "@companion/interfaces";
import type { ClientMessage, ServerMessage } from "../../server/src/messages";
import type { Plan } from "../../server/src/planner";
import type { BlueprintCard } from "../../server/src/messages";
import type { Point, SeriesMap } from "../../server/src/series";
import { answerSpeech, talkRequests } from "./voice";

export type ThreadItem =
  | { kind: "user"; key: number; text: string }
  | { kind: "agent"; key: number; text: Signal<string>; meta: Signal<string | null>; plan: Signal<Plan | null>; blueprint: Signal<BlueprintCard | null>; images: Signal<{ url: string; caption: string }[]> }
  | { kind: "tool"; key: number; text: string }
  | { kind: "approval"; key: number; id: string; title: string; detail: string; status: Signal<string | null>; result: Signal<string | null> }
  | { kind: "error"; key: number; text: string };

type Status = Extract<ServerMessage, { type: "status" }>;

export const status = signal<Status | null>(null);
export const connected = signal(false);
export const thread = signal<ThreadItem[]>([]);
export const events = signal<GameEvent[]>([]);
export const droppedEvents = signal(0);
export const digest = signal<{ digest: Digest; receivedAt: number } | null>(null);
export const series = signal<SeriesMap>({});

const MAX_EVENTS = 100;
const MAX_POINTS = 360;

let keys = 0;
let streaming: Extract<ThreadItem, { kind: "agent" }> | null = null;
let socket: WebSocket | null = null;

const append = (item: ThreadItem) => { thread.value = [...thread.value, item]; };

/** Applies one server message to the page state (exported for tests). */
export function onMessage(m: ServerMessage): void {
  switch (m.type) {
    case "status":
      status.value = m;
      break;
    case "user":
      append({ kind: "user", key: keys++, text: m.text });
      answerSpeech.onQuestion();
      streaming = { kind: "agent", key: keys++, text: signal(""), meta: signal(null), plan: signal(null), blueprint: signal(null), images: signal([]) };
      append(streaming);
      break;
    case "token":
      if (streaming) streaming.text.value += m.text;
      answerSpeech.onToken(m.text);
      break;
    case "tool": {
      // Tool summaries go just above the answer that's streaming.
      const item: ThreadItem = { kind: "tool", key: keys++, text: m.summary };
      const list = thread.value;
      const at = streaming ? list.indexOf(streaming) : list.length;
      thread.value = [...list.slice(0, at), item, ...list.slice(at)];
      break;
    }
    case "done":
      answerSpeech.onDone();
      if (streaming) {
        streaming.meta.value = `first token ${m.ttftMs ? (m.ttftMs / 1000).toFixed(1) : "?"} s · total ${(m.totalMs / 1000).toFixed(1)} s · prompt ${m.promptTokens ?? "?"} tok (${m.cachedTokens ?? 0} cached) · ${m.completionTokens ?? "?"} tok out`;
        // A turn that only produced tool calls and a card leaves an empty bubble; drop it.
        if (!streaming.text.value.trim() && !streaming.plan.value && !streaming.blueprint.value && !streaming.images.value.length) thread.value = thread.value.filter((i) => i !== streaming);
      }
      streaming = null;
      break;
    case "approval":
      append({ kind: "approval", key: keys++, id: m.id, title: m.title, detail: m.detail, status: signal(null), result: signal(null) });
      break;
    case "approval_result": {
      const card = thread.value.find((i) => i.kind === "approval" && i.id === m.id);
      if (card && card.kind === "approval") { card.status.value = m.status; card.result.value = m.message; }
      break;
    }
    case "error":
      append({ kind: "error", key: keys++, text: m.message });
      streaming = null;
      break;
    case "talk":
      talkRequests.value++;
      break;
    case "reset":
      answerSpeech.onQuestion();
      thread.value = [];
      streaming = null;
      break;
    case "events": {
      const seen = new Set(events.value.map((e) => e.seq));
      events.value = [...events.value, ...m.events.filter((e) => !seen.has(e.seq))].slice(-MAX_EVENTS);
      if (m.dropped) droppedEvents.value += m.dropped;
      break;
    }
    case "plan":
      if (streaming) streaming.plan.value = m.plan;
      break;
    case "transcript":
      // Replayed on connect: rebuild the thread unless this page already has it.
      if (thread.value.length === 0) {
        thread.value = m.items.map((item) => item.kind === "user"
          ? { kind: "user" as const, key: keys++, text: item.text }
          : { kind: "agent" as const, key: keys++, text: signal(item.text), meta: signal(null), plan: signal(null), blueprint: signal(null), images: signal([]) });
      }
      break;
    case "image":
      if (streaming) streaming.images.value = [...streaming.images.value, { url: m.url, caption: m.caption }];
      break;
    case "blueprint":
      if (streaming) streaming.blueprint.value = m.blueprint;
      break;
    case "series":
      series.value = m.series;
      break;
    case "digest": {
      digest.value = { digest: m.digest, receivedAt: m.receivedAt };
      // Extend the series with this snapshot, the same way the server builds them.
      const next: SeriesMap = { ...series.value };
      const add = (key: string, v: number) => { const pts: Point[] = [...(next[key] ?? []), { t: m.receivedAt, v }]; next[key] = pts.slice(-MAX_POINTS); };
      for (const s of m.digest.surfaces) {
        for (const r of s.produced) add(`${s.name}/produced/${r.name}`, r.per_minute);
        for (const r of s.science) add(`${s.name}/science/${r.name}`, r.per_minute);
      }
      series.value = next;
      break;
    }
  }
}

export function send(msg: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function connect(): void {
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.onopen = () => { connected.value = true; };
  socket.onmessage = (e) => onMessage(JSON.parse(e.data));
  socket.onclose = () => { connected.value = false; setTimeout(connect, 1000); };
}
