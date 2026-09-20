// Second Shift server: game link + model + web chat on localhost.
import chatPage from "../../displays/src/chat.html";
import { DigestSchema } from "@companion/interfaces";
import { Agent, fileSession, mapSession, SELECTED_PREFIX, TOOLS } from "./agent";
import { GameLink, type Snapshot } from "./game";
import type { ServerMessage } from "./messages";
import { OmlxClient, readOmlxApiKey } from "./model";
import { craftersByCategory, recognitionPhrases } from "./grounding";
import { VoiceClips } from "./voice-clips";
import { WhisperService } from "./stt";
import { normalizeNames } from "./normalize-names";
import { COMPANION_NAME } from "./prompt";
import { alignToCacheBlock, buildMessages, systemPrompt, userTurn } from "./prompt";
import { RecipeRetriever } from "./retrieval";
import { buildSeries } from "./series";
import { join } from "node:path";
import { USER_DIR } from "./factorio";
import { SHOT_NAME } from "./screenshots";
import { ElevenLabs, elevenLabsKey } from "./tts";
import { SOUND_NAMES, type SoundName } from "./sfx";
import { ModelWaker } from "./wake";
import { howLongAgo, Watcher } from "./watch";
import { nameCorrections } from "./names";
import { existsSync } from "node:fs";

export type { ClientMessage, ServerMessage } from "./messages";
import { parseClientMessage } from "@companion/interfaces";

const PORT = Number(process.env.COMPANION_PORT ?? 5170);
const MODEL = process.env.COMPANION_MODEL ?? "Qwen3.8-Flash-Next-oQ4e-mtp";
// The engine is a config value (FC-237): any OpenAI-compatible server. oMLX's key is read from its settings only
// when the URL is oMLX's; another engine gets COMPANION_MODEL_KEY, or no key.
const MODEL_URL = (process.env.COMPANION_MODEL_URL ?? "http://127.0.0.1:8888").replace(/\/$/, "");
const isOmlx = MODEL_URL === "http://127.0.0.1:8888";

const game = new GameLink({ pollMs: 2000, historySize: 1800, cacheDir: new URL("../../data/cache", import.meta.url).pathname });
const model = new OmlxClient({ baseUrl: MODEL_URL, apiKey: isOmlx ? await readOmlxApiKey() : (process.env.COMPANION_MODEL_KEY ?? ""), model: MODEL, thinkingSwitch: isOmlx ? "chat_template_kwargs" : "reasoning_effort" });
console.log(`Model server: ${MODEL_URL} (${MODEL})`);
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
  log: console.log,
  turnLog: process.env.COMPANION_TURN_LOG ?? new URL("../../data/eval/turns.jsonl", import.meta.url).pathname,
  scriptOutput: join(USER_DIR, "script-output"),
  session: fileSession(LEGACY_SESSION),
});

const SOUNDS_DIR = new URL("../../data/sounds", import.meta.url).pathname;

// ElevenLabs voices (FC-148), only when the player has put a key in the environment or .env.
const tts = elevenLabsKey() ? new ElevenLabs({ key: elevenLabsKey()!, model: process.env.ELEVENLABS_MODEL, defaultVoice: process.env.ELEVENLABS_VOICE_ID }) : null;

/**
 * The second shift (FC-193): a quiet look while the player plays. Off until they turn it on. The model round uses
 * the same system prompt as a turn, so it shares the cached blocks rather than competing for them — FC-192 measured
 * that a concurrent request leaves `cached 4096` intact and costs the player ~0.15 s of first token.
 */
const watcher = new Watcher({
  digest: () => game.latest()?.digest,
  say: async (found, sinceMs) => {
    const protos = game.prototypes()?.data ?? null;
    const lines = found.map((f) => `- ${f.line}`).join("\n");
    const turn = userTurn(`You looked at the factory ${howLongAgo(sinceMs)} and nobody asked you anything. These are the only things worth saying, computed from the game's own data:\n${lines}\n\nPick the single one that matters most and say it in one sentence, under 25 words, flat and plain — no aside, nothing about yourself, no advice unless it fits in the same sentence. Name nothing that isn't in the lines above. If none of it is worth interrupting for, reply with exactly: nothing.`);
    try {
      const result = await model.stream(buildMessages(system, [], turn), { maxTokens: 60 });
      const text = result.text.trim();
      if (!text || /^nothing\b/i.test(text)) return null;
      // A background claim nobody asked for is the easiest place for an invented name to hide (FC-171), so a note
      // that would need a correction isn't shown at all.
      if (nameCorrections(text, protos).length) {
        console.log(`Dropped a background note that named something the save lacks: ${text}`);
        return null;
      }
      return text;
    } catch (e) {
      console.warn("Background look failed:", (e as Error).message);
      return null;
    }
  },
  emit: (note) => {
    console.log(`Second shift (looked ${howLongAgo(note.sinceMs)}): ${note.text}`);
    broadcast({ type: "note", text: note.text, at: note.at, sinceMs: note.sinceMs });
  },
});

/**
 * Local transcription (FC-230): whisper.cpp's server kept resident beside oMLX, started here and restarted if it
 * dies; absent without complaint when it isn't installed. The console posts each spoken clip and uses the text if
 * it comes back in time, the browser's transcript otherwise.
 */
const stt = new WhisperService(console.log);
void stt.start();
// whisper-server is our child: it goes when we go (FC-238: three of them, 1.8 GB each, were found running after a
// day of restarts).
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stt.stop(); process.exit(0); });

const clips = new VoiceClips(join(import.meta.dir, "..", "..", "data", "captures", "voice"));

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
    // The player's own voice, kept for FC-189's comparison. Local only, gitignored, and off unless they turn it on.
    "/stt/status": () => Response.json(stt.status()),
    "/stt": {
      POST: async (req) => {
        const wav = new Uint8Array(await req.arrayBuffer());
        if (wav.byteLength < 44) return new Response("no audio", { status: 400 });
        const started = performance.now();
        const result = await stt.transcribe(wav);
        if (!result) return Response.json({ available: stt.status().ready, text: "" }, { status: 503 });
        // The save's own spellings go back in afterwards (FC-189: a prompt made "spider tron" worse, not better).
        const protos = game.prototypes()?.data;
        const text = result.text && protos ? normalizeNames(result.text, [...recognitionPhrases(protos, 400), "Ballast"]) : result.text;
        const ms = Math.round(performance.now() - started);
        if ("gated" in result) console.log(`Local transcription refused a clip (${result.gated}) in ${ms} ms`);
        else console.log(`Local transcription (${ms} ms): "${text}"${text !== result.text ? ` — was "${result.text}"` : ""}`);
        return Response.json({ text, ms, engine: result.engine, ...("gated" in result ? { gated: result.gated } : {}) });
      },
    },
    "/capture/voice": {
      POST: async (req) => {
        try {
          const form = await req.formData();
          const audio = form.get("audio");
          if (!(audio instanceof Blob)) return new Response("no audio", { status: 400 });
          const meta = JSON.parse(String(form.get("meta") ?? "{}")) as { heard?: string; detail?: unknown; seconds?: number; sampleRate?: number };
          const id = await clips.save(await audio.arrayBuffer(), {
            heard: String(meta.heard ?? ""), detail: meta.detail,
            seconds: Number(meta.seconds ?? 0), sampleRate: Number(meta.sampleRate ?? 16000),
          });
          console.log(`Kept clip ${id} (${meta.seconds}s): "${meta.heard}"`);
          return Response.json({ id, ...(await clips.count()) });
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
    "/capture/truth": {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { id?: string; said?: string };
        const ok = await clips.setTruth(String(body.id ?? ""), String(body.said ?? ""));
        if (ok) console.log(`Clip ${body.id}: the player actually said "${body.said}"`);
        return Response.json({ ok, ...(await clips.count()) });
      },
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
      ws.send(JSON.stringify({ type: "watching", on: watcher.on } satisfies ServerMessage));
      // The conversation so far, so a reloaded page (or a restarted server) shows where things stand (FC-063).
      const transcript = agent.transcript();
      if (transcript.length) ws.send(JSON.stringify({ type: "transcript", items: transcript } satisfies ServerMessage));
      // The save's own words, so the console can pick the transcript that matches them (FC-175).
      const protos = game.prototypes()?.data;
      if (protos) ws.send(JSON.stringify({ type: "vocabulary", phrases: recognitionPhrases(protos), name: COMPANION_NAME } satisfies ServerMessage));
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
      // A malformed message is dropped and logged rather than reaching the agent (FC-200).
      const parsed = parseClientMessage(String(raw));
      if (!parsed.message) { console.warn(`Dropped a console message (${parsed.reason})`); return; }
      const msg = parsed.message;
      if (msg.type === "ask" && msg.text.trim()) busy = busy.then(async () => {
        asking++;
        // One line per spoken question, so a good transcript can be attributed afterwards (FC-185).
        if (msg.heard) {
          const h = msg.heard;
          const others = h.offered.slice(1).filter((t) => t !== h.picked);
          console.log(`Heard (${h.where}, ${h.alternatives} alternative${h.alternatives === 1 ? "" : "s"}, ${h.phrases} phrase${h.phrases === 1 ? "" : "s"}${h.carried ? ", carried across a restart" : ""}${h.localMs !== undefined ? `, ${h.localMs} ms` : ""}): "${h.picked}"${h.browser !== undefined && h.browser !== h.picked ? ` — browser heard "${h.browser}"` : h.first !== h.picked ? ` — engine's first guess was "${h.first}"` : ""}${others.length ? ` · also offered: ${others.map((t) => `"${t}"`).join(", ")}` : ""}`);
        }
        try {
          if (msg.interrupted) console.log(`Cut in${msg.interrupted.stopOnly ? " (stop only)" : ""} while reading: "${msg.interrupted.during}"`);
          await agent.ask(msg.text.trim(), msg.thinking ?? false, msg.spoken === true, msg.interrupted);
        } finally {
          asking--;
        }
      });
      if (msg.type === "watch") {
        // COMPANION_WATCH_MS shortens the interval for the e2e check; play uses the five-minute default.
        if (msg.on) watcher.start(Number(process.env.COMPANION_WATCH_MS) || undefined); else watcher.stop();
        broadcast({ type: "watching", on: watcher.on });
      }
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
  // The console usually opens before the game does, so the words and phrases also go out when the save arrives
  // rather than only to a page that connects after it (FC-175, FC-177).
  broadcast({ type: "vocabulary", phrases: recognitionPhrases(p.data), name: COMPANION_NAME });
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
