import type { ClientMessage, ServerMessage } from "../../server/src/messages";

const thread = document.getElementById("thread")!;
const ask = document.getElementById("ask") as HTMLTextAreaElement;
const thinking = document.getElementById("thinking") as HTMLInputElement;
const gameStatus = document.getElementById("game-status")!;
const modelStatus = document.getElementById("model-status")!;
let current: HTMLElement | null = null;
const cards = new Map<string, HTMLElement>();
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
    case "tool": {
      const line = document.createElement("div");
      line.className = "tool";
      line.textContent = m.summary;
      (current ?? thread.lastElementChild)?.before(line);
      break;
    }
    case "approval": {
      const card = document.createElement("div");
      card.className = "approval";
      card.innerHTML = `<div class="approval-title"></div><div class="approval-detail"></div><div class="row"><button class="confirm">Confirm</button><button class="cancel">Cancel</button></div>`;
      card.querySelector(".approval-title")!.textContent = m.title;
      card.querySelector(".approval-detail")!.textContent = m.detail;
      card.querySelector(".confirm")!.addEventListener("click", () => send({ type: "approve", id: m.id }));
      card.querySelector(".cancel")!.addEventListener("click", () => send({ type: "decline", id: m.id }));
      thread.appendChild(card);
      cards.set(m.id, card);
      thread.scrollTop = thread.scrollHeight;
      break;
    }
    case "approval_result": {
      const card = cards.get(m.id);
      if (!card) break;
      card.querySelector(".row")?.remove();
      card.classList.add(m.status);
      const result = document.createElement("div");
      result.className = "approval-result";
      result.textContent = m.message;
      card.appendChild(result);
      break;
    }
    case "reset":
      thread.replaceChildren();
      cards.clear();
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

function send(msg: ClientMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
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
