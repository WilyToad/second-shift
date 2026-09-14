// Page state as signals, fed by the server's WebSocket. Components read these; only this file writes.
import { signal, type Signal } from "@preact/signals";
import type { ClientMessage, ServerMessage } from "../../server/src/messages";

export type ThreadItem =
  | { kind: "user"; key: number; text: string }
  | { kind: "agent"; key: number; text: Signal<string>; meta: Signal<string | null> }
  | { kind: "tool"; key: number; text: string }
  | { kind: "approval"; key: number; id: string; title: string; detail: string; status: Signal<string | null>; result: Signal<string | null> }
  | { kind: "error"; key: number; text: string };

type Status = Extract<ServerMessage, { type: "status" }>;

export const status = signal<Status | null>(null);
export const connected = signal(false);
export const thread = signal<ThreadItem[]>([]);

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
      streaming = { kind: "agent", key: keys++, text: signal(""), meta: signal(null) };
      append(streaming);
      break;
    case "token":
      if (streaming) streaming.text.value += m.text;
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
      if (streaming) {
        streaming.meta.value = `first token ${m.ttftMs ? (m.ttftMs / 1000).toFixed(1) : "?"} s · total ${(m.totalMs / 1000).toFixed(1)} s · prompt ${m.promptTokens ?? "?"} tok (${m.cachedTokens ?? 0} cached) · ${m.completionTokens ?? "?"} tok out`;
        // A turn that only produced tool calls and a card leaves an empty bubble; drop it.
        if (!streaming.text.value.trim()) thread.value = thread.value.filter((i) => i !== streaming);
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
    case "reset":
      thread.value = [];
      streaming = null;
      break;
    case "events":
      break; // shown by the alert feed (FC-021)
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
