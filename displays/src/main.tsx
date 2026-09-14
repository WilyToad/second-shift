import { render } from "preact";
import { Composer, Thread } from "./chat";
import { connect, connected, status } from "./store";

function Header() {
  const s = status.value;
  const game = !connected.value
    ? { text: "server: reconnecting…", cls: "crit" }
    : !s ? { text: "game: connecting…", cls: "warn" }
    : s.game.connected ? { text: `game: tick ${s.game.tick ?? "…"} · ${s.game.ageMs !== undefined ? `${Math.round(s.game.ageMs / 1000)} s old` : "waiting"}`, cls: "ok" }
    : { text: `game: not connected${s.game.error ? ` (${s.game.error})` : ""}`, cls: "warn" };
  const model = s?.model.state ?? "loading";
  return (
    <header>
      <strong>Factorio Companion</strong>
      <span class={`pill ${game.cls}`}>{game.text}</span>
      <span class={`pill ${model === "ready" ? "ok" : model === "error" ? "crit" : "warn"}`}>model: {model}</span>
    </header>
  );
}

function App() {
  return (
    <>
      <Header />
      <Thread />
      <Composer />
    </>
  );
}

connect();
render(<App />, document.getElementById("app")!);
