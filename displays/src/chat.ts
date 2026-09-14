import type { ClientMessage, ServerMessage } from "../../server/src/main";

const thread = document.getElementById("thread")!;
const ask = document.getElementById("ask") as HTMLTextAreaElement;
const thinking = document.getElementById("thinking") as HTMLInputElement;
const gameStatus = document.getElementById("game-status")!;
const modelStatus = document.getElementById("model-status")!;
let current: HTMLElement | null = null;
let socket: WebSocket;

function add(cls: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

function onMessage(m: ServerMessage): void {
  switch (m.type) {
    case "status": {
      const g = m.game;
      gameStatus.textContent = g.connected ? `game: tick ${g.tick ?? "…"} · ${g.ageMs !== undefined ? Math.round(g.ageMs / 1000) + " s old" : "waiting"}` : `game: not connected${g.error ? ` (${g.error})` : ""}`;
      gameStatus.className = `pill ${g.connected ? "ok" : "warn"}`;
      modelStatus.textContent = `model: ${m.model.state}`;
      modelStatus.className = `pill ${m.model.state === "ready" ? "ok" : m.model.state === "error" ? "crit" : "warn"}`;
      break;
    }
    case "user":
      add("user", m.text);
      current = add("agent", "");
      break;
    case "token":
      if (current) { current.textContent += m.text; thread.scrollTop = thread.scrollHeight; }
      break;
    case "done": {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `first token ${m.ttftMs ? (m.ttftMs / 1000).toFixed(1) : "?"} s · total ${(m.totalMs / 1000).toFixed(1)} s · prompt ${m.promptTokens ?? "?"} tok (${m.cachedTokens ?? 0} cached) · ${m.completionTokens ?? "?"} tok out`;
      current?.after(meta);
      current = null;
      break;
    }
    case "reset":
      thread.replaceChildren();
      current = null;
      break;
    case "error":
      add("error", m.message);
      current = null;
      break;
  }
}

function connect(): void {
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.onmessage = (e) => onMessage(JSON.parse(e.data));
  socket.onclose = () => { gameStatus.textContent = "server: reconnecting…"; gameStatus.className = "pill crit"; setTimeout(connect, 1000); };
}

document.getElementById("composer")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ask.value.trim();
  if (!text || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "ask", text, thinking: thinking.checked } satisfies ClientMessage));
  ask.value = "";
});
ask.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (document.getElementById("composer") as HTMLFormElement).requestSubmit(); }
});

connect();
