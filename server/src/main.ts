// Second Shift server: game link + model + web chat on localhost.
import chatPage from "../../displays/src/chat.html";
import { DigestSchema } from "@companion/interfaces";
import { Agent, fileSession, mapSession, SELECTED_PREFIX, TOOLS } from "./agent";
import { GameLink, type Snapshot } from "./game";
import type { ClientMessage, ServerMessage } from "./messages";
import { OmlxClient, readOmlxApiKey } from "./model";
import { craftersByCategory, recognitionPhrases, vocabulary } from "./grounding";
import { alignToCacheBlock, buildMessages, systemPrompt, userTurn } from "./prompt";
import { RecipeRetriever } from "./retrieval";
import { buildSeries } from "./series";
import { join } from "node:path";
import { USER_DIR } from "./factorio";
import { SHOT_NAME } from "./screenshots";
import { ElevenLabs, elevenLabsKey } from "./tts";
import { SOUND_NAMES, type SoundName } from "./sfx";
import { ModelWaker } from "./wake";
import { existsSync } from "node:fs";

export type { ClientMessage, ServerMessage } from "./messages";

const PORT = Number(process.env.COMPANION_PORT ?? 5170);
const MODEL = process.env.COMPANION_MODEL ?? "Qwen3.8-Flash-Next-oQ4e-mtp";

const game = new GameLink({ pollMs: 2000, historySize: 1800, cacheDir: new URL("../../data/cache", import.meta.url).pathname });
const model = new OmlxClient({ baseUrl: "http://127.0.0.1:8888", apiKey: await readOmlxApiKey(), model: MODEL });
let modelState: { state: "loading" | "ready" | "error"; error?: string } = { state: "loading" };
let busy: Promise<void> = Promise.resolve();
let asking = 0;
const waker = new ModelWaker(() => model.stream([{ role: "user", content: "hi" }], { maxTokens: 1 }), () => asking > 0);
let system = systemPrompt(null);
let alignedBase: string | null = null; // the base prompt `system` was last aligned from
let retriever: RecipeRetriever | null = null;

// COMPANION_REPLAY_DIGEST=data/captures/digest.json: use a captured digest while the game isn't
// connected, so offline evals see a realistic full-size prompt.
const replayDigest = process.env.COMPANION_REPLAY_DIGEST
  ? DigestSchema.parse(await Bun.file(process.env.COMPANION_REPLAY_DIGEST).json())
  : null;

// One conversation per map (FC-137). Until the game reports its map id, the last conversation without one is shown.
const SESSIONS_DIR = process.env.COMPANION_SESSIONS ?? new URL("../../data/sessions", import.meta.url).pathname;
const LEGACY_SESSION = new URL("../../data/session.json", import.meta.url).pathname;
let mapId: string | undefined;

const agent = new Agent({
  model,
  game,
  system: () => system,
  retriever: () => retriever,
  prototypes: () => game.prototypes()?.data ?? null,
  fallbackSnapshot: (): Snapshot | undefined => (replayDigest ? { digest: replayDigest, receivedAt: Date.now() } : undefined),
  emit: (m) => broadcast(m),
  turnLog: process.env.COMPANION_TURN_LOG ?? new URL("../../data/eval/turns.jsonl", import.meta.url).pathname,
  scriptOutput: join(USER_DIR, "script-output"),
  session: fileSession(LEGACY_SESSION),
});

const SOUNDS_DIR = new URL("../../data/sounds", import.meta.url).pathname;

// ElevenLabs voices (FC-148), only when the player has put a key in the environment or .env.
const tts = elevenLabsKey() ? new ElevenLabs({ key: elevenLabsKey()!, model: process.env.ELEVENLABS_MODEL, defaultVoice: process.env.ELEVENLABS_VOICE_ID }) : null;

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  routes: {
    "/": chatPage,
    // Screenshots the game wrote on request (FC-049); only names the mod generates are served.
    "/shots/:name": (req) => {
      const name = req.params.name;
      if (!SHOT_NAME.test(name)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(join(USER_DIR, "script-output", "companion", name)), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
    },
    // Generated sound effects (FC-150, bun run sounds); the page falls back to built-in tones for any that are missing.
    "/sounds": () => Response.json({ sounds: SOUND_NAMES.filter((n) => existsSync(join(SOUNDS_DIR, `${n}.mp3`))) }),
    "/sounds/:name": (req) => {
      const name = req.params.name.replace(/\.mp3$/, "") as SoundName;
      if (!SOUND_NAMES.includes(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(join(SOUNDS_DIR, `${name}.mp3`));
      return new Response(file, { headers: { "content-type": "audio/mpeg", "cache-control": "no-cache" } });
    },
    "/tts/voices": async () => {
      if (!tts) return Response.json({ available: false, voices: [] });
      try {
        return Response.json({ available: true, voices: await tts.listVoices() });
      } catch (e) {
        return Response.json({ available: false, error: (e as Error).message, voices: [] });
      }
    },
    "/tts": {
      POST: async (req) => {
        if (!tts) return new Response("ElevenLabs isn't set up: add ELEVENLABS_API_KEY to .env and restart the server", { status: 404 });
        const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string; previous?: string };
        try {
          return await tts.speak(String(body.text ?? ""), body.voice, body.previous, req.signal);
        } catch (e) {
          return new Response((e as Error).message, { status: 502 });
        }
      },
    },
  },
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("chat");
      ws.send(JSON.stringify(statusMessage()));
      // The conversation so far, so a reloaded page (or a restarted server) shows where things stand (FC-063).
      const transcript = agent.transcript();
      if (transcript.length) ws.send(JSON.stringify({ type: "transcript", items: transcript } satisfies ServerMessage));
      // The save's own words, so the console can pick the transcript that matches them (FC-175).
      const protos = game.prototypes()?.data;
      if (protos) ws.send(JSON.stringify({ type: "vocabulary", words: vocabulary(protos), phrases: recognitionPhrases(protos) } satisfies ServerMessage));
      // The lists the companion keeps, so a reloaded page shows the panel straight away (FC-163).
      const lists = agent.lists.all();
      if (lists.length) ws.send(JSON.stringify({ type: "lists", lists, ...(agent.lists.active()?.name ? { active: agent.lists.active()!.name } : {}) } satisfies ServerMessage));
      const latest = game.latest();
      if (latest) {
        ws.send(JSON.stringify({ type: "series", series: buildSeries(game.history()) } satisfies ServerMessage));
        ws.send(JSON.stringify({ type: "digest", digest: latest.digest, receivedAt: latest.receivedAt } satisfies ServerMessage));
      }
      // Recent alerts only, and never a key press (an old one must not start listening): FC-150, FC-170.
      const recent = game.eventsForReplay();
      // Marked as a replay: old alerts fill the feed without making sounds (FC-150).
      if (recent.length) ws.send(JSON.stringify({ type: "events", events: recent, replay: true } satisfies ServerMessage));
    },
    message(_ws, raw) {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      if (msg.type === "ask" && msg.text.trim()) busy = busy.then(async () => {
        asking++;
        try {
          await agent.ask(msg.text.trim(), msg.thinking ?? false, msg.spoken === true);
        } finally {
          asking--;
        }
      });
      if (msg.type === "wake") waker.wake();
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
    // Warm with the restored conversation too, so the first follow-up after a restart hits the cache.
    const r = await model.stream(buildMessages(system, agent.history, userTurn("Reply with OK.")), { maxTokens: 1, tools: TOOLS });
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
  const id = s.latest?.digest.map_id;
  if (id && id !== mapId) {
    const first = mapId === undefined;
    mapId = id;
    busy = busy.then(async () => {
      agent.useSession(mapSession(SESSIONS_DIR, id, LEGACY_SESSION));
      console.log(`Map ${id}: ${agent.history.length ? "picking up its conversation" : "new conversation"}.`);
      // Re-warm with the other map's conversation so its first follow-up hits the cache.
      if (!first || agent.history.length) await warmUp();
    });
  }
  broadcast(statusMessage());
  if (s.latest && s.latest !== lastDigestSent) {
    lastDigestSent = s.latest;
    broadcast({ type: "digest", digest: s.latest.digest, receivedAt: s.latest.receivedAt });
  }
});
game.onEvents((all, dropped) => {
  // A push-to-talk press goes to the pages as its own message and never into the alert feed (FC-147).
  if (all.some((e) => e.kind === "talk")) broadcast({ type: "talk" });
  const events = all.filter((e) => e.kind !== "talk");
  if (events.length || dropped) broadcast({ type: "events", events, ...(dropped ? { dropped } : {}) });
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
    const base = systemPrompt(p.data, p.mods);
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
console.log(`Second Shift on http://127.0.0.1:${PORT}`);
