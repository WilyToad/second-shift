// Factorio Companion server: game link + model + web chat on localhost.
import chatPage from "../../displays/src/chat.html";
import { GameLink } from "./game";
import { OmlxClient, readOmlxApiKey, type ChatMessage } from "./model";
import { buildMessages, formatSnapshot, systemPrompt, userTurn } from "./prompt";
import { RecipeRetriever } from "./retrieval";

const PORT = Number(process.env.COMPANION_PORT ?? 5170);
const MODEL = process.env.COMPANION_MODEL ?? "Qwen3.8-Flash-Next-oQ4e-mtp";

export type ServerMessage =
  | { type: "status"; game: { connected: boolean; tick?: number; ageMs?: number; error?: string }; model: { state: "loading" | "ready" | "error"; error?: string } }
  | { type: "user"; text: string }
  | { type: "token"; text: string }
  | { type: "done"; ttftMs?: number; totalMs: number; promptTokens?: number; cachedTokens?: number; completionTokens?: number }
  | { type: "error"; message: string };
export type ClientMessage = { type: "ask"; text: string; thinking?: boolean };

const game = new GameLink({ pollMs: 2000, historySize: 1800, cacheDir: new URL("../../data/cache", import.meta.url).pathname });
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: MODEL });
const history: ChatMessage[] = [];
let modelState: { state: "loading" | "ready" | "error"; error?: string } = { state: "loading" };
let busy: Promise<void> = Promise.resolve();
let system = systemPrompt(null);
let retriever: RecipeRetriever | null = null;

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  routes: { "/": chatPage },
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("chat");
      ws.send(JSON.stringify(statusMessage()));
    },
    message(_ws, raw) {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      if (msg.type === "ask" && msg.text.trim()) busy = busy.then(() => answer(msg.text.trim(), msg.thinking ?? false));
    },
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true },
});

function broadcast(m: ServerMessage): void {
  server.publish("chat", JSON.stringify(m));
}

function statusMessage(): ServerMessage {
  const s = game.status();
  return {
    type: "status",
    game: { connected: s.connected, tick: s.latest?.digest.tick, ageMs: s.latest ? Date.now() - s.latest.receivedAt : undefined, error: s.connected ? undefined : s.lastError },
    model: modelState,
  };
}

async function answer(question: string, thinking: boolean): Promise<void> {
  const snap = game.latest();
  const recipes = retriever?.retrieve(question).lines ?? [];
  const turn = userTurn(question, { recipes, snapshot: snap ? formatSnapshot(snap.digest, Date.now() - snap.receivedAt) : null });
  broadcast({ type: "user", text: question });
  try {
    const result = await model.stream(buildMessages(system, history, turn), {
      thinking,
      onToken: (text) => broadcast({ type: "token", text }),
    });
    history.push(turn, { role: "assistant", content: result.text });
    broadcast({
      type: "done",
      ttftMs: result.ttftMs,
      totalMs: result.totalMs,
      promptTokens: result.usage?.prompt_tokens,
      cachedTokens: result.usage?.prompt_tokens_details?.cached_tokens,
      completionTokens: result.usage?.completion_tokens,
    });
  } catch (e) {
    broadcast({ type: "error", message: (e as Error).message });
  }
}

// Load the model and cache the system prompt so the first real question is fast.
async function warmUp(): Promise<void> {
  try {
    const r = await model.stream(buildMessages(system, [], userTurn("Reply with OK.")), { maxTokens: 1 });
    modelState = { state: "ready" };
    console.log(`Model ready (load ${r.usage?.model_load_duration?.toFixed(1) ?? "0"} s, ${r.totalMs.toFixed(0)} ms total).`);
  } catch (e) {
    modelState = { state: "error", error: (e as Error).message };
    console.error("Model warm-up failed:", (e as Error).message);
  }
  broadcast(statusMessage());
}

game.onStatus(() => broadcast(statusMessage()));
// New prototype data changes the system prompt, so rebuild retrieval and re-warm the cache.
game.onPrototypes((p) => {
  system = systemPrompt(p.data);
  retriever = new RecipeRetriever(p.data);
  console.log(`Grounding on ${Object.keys(p.data.recipes).length} recipes (${p.source}).`);
  busy = busy.then(warmUp);
});
await game.loadCachedPrototypes();
game.start();
if (!game.prototypes()) busy = busy.then(warmUp);
console.log(`Factorio Companion on http://127.0.0.1:${PORT}`);
