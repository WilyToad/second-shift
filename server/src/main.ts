// Factorio Companion server: game link + model + web chat on localhost.
import chatPage from "../../displays/src/chat.html";
import { DigestSchema } from "@companion/interfaces";
import { Agent, SELECTED_PREFIX, TOOLS } from "./agent";
import { GameLink, type Snapshot } from "./game";
import type { ClientMessage, ServerMessage } from "./messages";
import { OmlxClient, readOmlxApiKey } from "./model";
import { craftersByCategory } from "./grounding";
import { alignToCacheBlock, buildMessages, systemPrompt, userTurn } from "./prompt";
import { RecipeRetriever } from "./retrieval";
import { buildSeries } from "./series";

export type { ClientMessage, ServerMessage } from "./messages";

const PORT = Number(process.env.COMPANION_PORT ?? 5170);
const MODEL = process.env.COMPANION_MODEL ?? "Qwen3.8-Flash-Next-oQ4e-mtp";

const game = new GameLink({ pollMs: 2000, historySize: 1800, cacheDir: new URL("../../data/cache", import.meta.url).pathname });
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: MODEL });
let modelState: { state: "loading" | "ready" | "error"; error?: string } = { state: "loading" };
let busy: Promise<void> = Promise.resolve();
let system = systemPrompt(null);
let alignedBase: string | null = null; // the base prompt `system` was last aligned from
let retriever: RecipeRetriever | null = null;

// COMPANION_REPLAY_DIGEST=data/captures/digest.json: use a captured digest while the game isn't
// connected, so offline evals see a realistic full-size prompt.
const replayDigest = process.env.COMPANION_REPLAY_DIGEST
  ? DigestSchema.parse(await Bun.file(process.env.COMPANION_REPLAY_DIGEST).json())
  : null;

const agent = new Agent({
  model,
  game,
  system: () => system,
  retriever: () => retriever,
  prototypes: () => game.prototypes()?.data ?? null,
  fallbackSnapshot: (): Snapshot | undefined => (replayDigest ? { digest: replayDigest, receivedAt: Date.now() } : undefined),
  emit: (m) => broadcast(m),
  turnLog: process.env.COMPANION_TURN_LOG ?? new URL("../../data/eval/turns.jsonl", import.meta.url).pathname,
});

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
      const latest = game.latest();
      if (latest) {
        ws.send(JSON.stringify({ type: "series", series: buildSeries(game.history()) } satisfies ServerMessage));
        ws.send(JSON.stringify({ type: "digest", digest: latest.digest, receivedAt: latest.receivedAt } satisfies ServerMessage));
      }
      const recent = game.events();
      if (recent.length) ws.send(JSON.stringify({ type: "events", events: recent } satisfies ServerMessage));
    },
    message(_ws, raw) {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      if (msg.type === "ask" && msg.text.trim()) busy = busy.then(() => agent.ask(msg.text.trim(), msg.thinking ?? false));
      if (msg.type === "reset") busy = busy.then(() => agent.reset());
      // Approvals don't wait for the model: the player is waiting on them.
      if (msg.type === "approve") void agent.approve(msg.id);
      if (msg.type === "decline") agent.decline(msg.id);
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
    game: { connected: s.connected, tick: s.latest?.digest.tick, ageMs: s.latest ? Date.now() - s.latest.receivedAt : undefined, paused: s.latest?.digest.paused, error: s.connected ? undefined : s.lastError },
    model: modelState,
  };
}

// Load the model and cache the system prompt (tool definitions included) so the first question is fast.
async function warmUp(): Promise<void> {
  try {
    const r = await model.stream(buildMessages(system, [], userTurn("Reply with OK.")), { maxTokens: 1, tools: TOOLS });
    modelState = { state: "ready" };
    console.log(`Model ready (load ${r.usage?.model_load_duration?.toFixed(1) ?? "0"} s, ${r.totalMs.toFixed(0)} ms total).`);
  } catch (e) {
    modelState = { state: "error", error: (e as Error).message };
    console.error("Model warm-up failed:", (e as Error).message);
  }
  broadcast(statusMessage());
}

let lastDigestSent: Snapshot | undefined;
game.onStatus((s) => {
  broadcast(statusMessage());
  if (s.latest && s.latest !== lastDigestSent) {
    lastDigestSent = s.latest;
    broadcast({ type: "digest", digest: s.latest.digest, receivedAt: s.latest.receivedAt });
  }
});
game.onEvents((events, dropped) => {
  broadcast({ type: "events", events, ...(dropped ? { dropped } : {}) });
  // The player dragged the companion's selection tool over a build: review it like a pasted blueprint (FC-046).
  for (const e of events) if (e.kind === "selection" && e.count) busy = busy.then(() => reviewSelection(e.seq));
});

async function reviewSelection(seq: number): Promise<void> {
  try {
    const selection = await game.call("get_selection", { seq });
    if (selection.blueprint) await agent.ask(`${SELECTED_PREFIX} ${selection.blueprint}`);
  } catch (e) {
    broadcast({ type: "error", message: `Couldn't fetch the selected build: ${(e as Error).message}` });
  }
}
// New prototype data changes the system prompt, so rebuild retrieval and re-warm the cache.
game.onPrototypes((p) => {
  retriever = new RecipeRetriever(p.data);
  console.log(`Grounding on ${Object.keys(p.data.recipes).length} recipes (${p.source}).`);
  busy = busy.then(async () => {
    const base = systemPrompt(p.data);
    // Research only flips enabled and researched flags, which the system prompt doesn't show: the
    // aligned prompt and the model's cache are still good, so skip re-measuring and re-warming.
    if (base === alignedBase) return;
    system = base;
    try {
      const categories = [...craftersByCategory(p.data)].sort(([a], [b]) => a.localeCompare(b)).map(([c, crafters]) => `crafting category ${c}: ${crafters.join(", ")}`);
      // Static tech tree lines (no researched status, so they don't go stale) as further padding.
      const techTree = Object.entries(p.data.technologies).sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => `technology ${name}: needs ${t.prerequisites.join(", ") || "-"} | unlocks ${t.unlocks.join(", ") || "-"}`);
      const measure = async (s: string) => (await model.stream(buildMessages(s, [], { role: "user", content: "." }), { tools: TOOLS, maxTokens: 1 })).usage?.prompt_tokens ?? 0;
      const aligned = await alignToCacheBlock(base, [...categories, ...techTree], measure, "[save data: reference (crafting categories and the technology tree)]");
      system = aligned.system;
      alignedBase = base;
      console.log(`System prompt aligned to the cache: ${aligned.tokens} tokens (block boundary ${aligned.target}).`);
    } catch (e) {
      console.warn("Couldn't align the system prompt to the cache:", (e as Error).message);
    }
    await warmUp();
  });
});
await game.loadCachedPrototypes();
game.start();
if (!game.prototypes()) busy = busy.then(warmUp);
console.log(`Factorio Companion on http://127.0.0.1:${PORT}`);
