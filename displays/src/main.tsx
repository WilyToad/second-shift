import { render } from "preact";
import { Composer, Thread } from "./chat";
import { AlertFeed, ListPanel, LivePanel } from "./console";
import { connect, connected, send, status } from "./store";
import { loadElevenVoices, probeRecognition } from "./voice";
import { loadSounds } from "./sounds";
import { composing, keepWarm, lastTypedAt } from "./warm";
import { heard, listenState } from "./voice";

/** The Second Shift mark (brand/logo/mark.svg), drawn from the tokens so it follows the theme. */
function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M19 6h26l13 13v26L45 58H19L6 45V19z" fill="var(--text)" />
      <path d="M12 24h19l-3 15H12z" fill="var(--seam)" />
      <path d="M35 24h17v15H32z" fill="var(--agent)" />
    </svg>
  );
}

function Header() {
  const s = status.value;
  const game = !connected.value
    ? { text: "server: reconnecting…", cls: "crit" }
    : !s ? { text: "game: connecting…", cls: "warn" }
    : s.game.connected && s.game.paused ? { text: "game paused", cls: "warn" }
    : s.game.connected ? { text: `game linked · snapshot ${s.game.ageMs !== undefined ? `${Math.round(s.game.ageMs / 1000)} s old` : "waiting"}`, cls: "ok" }
    : { text: `game: not connected${s.game.error ? ` (${s.game.error})` : ""}`, cls: "warn" };
  const model = s?.model.state ?? "loading";
  return (
    <header class="topbar">
      <strong class="brand"><Mark />Second Shift</strong>
      <span class="status">
        <span class={`pill ${game.cls}`}>{game.text}</span>
        <span class={`pill ${model === "ready" ? "ok" : model === "error" ? "crit" : "warn"}`}>model: {model}</span>
      </span>
    </header>
  );
}

function App() {
  return (
    <div class="shell">
      <Header />
      <div class="console">
        <div class="col-alerts">
          <ListPanel />
          <AlertFeed />
        </div>
        <section class="col-chat panel" aria-label="Conversation">
          <Thread />
          <Composer />
        </section>
        <LivePanel />
      </div>
    </div>
  );
}

connect();
void probeRecognition();
void loadElevenVoices();
void loadSounds();
// The model idles within ~3 s; keep it awake while a question is being spoken or typed (FC-158).
keepWarm((now) => composing({ listening: listenState.peek() === "listening", heard: heard.peek(), lastTypedAt: lastTypedAt.peek() }, now), () => send({ type: "wake" }));
render(<App />, document.getElementById("app")!);
