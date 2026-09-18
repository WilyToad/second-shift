// The one console harness for the eval and e2e scripts (FC-197). Twenty-five scripts each carried their own copy
// of this — a WebSocket, a message log, `until`, `ask`, `check` — and they drifted: some declined cards inside
// `ask`, some returned the answer text and some the raw slice. The shapes are all here, named.
import type { ServerMessage } from "../../server/src/messages";
import { asChecks, saveEvalRun } from "./eval-log";

export type Msg = ServerMessage;
export type Result = [name: string, ok: boolean, detail: string];
export type Asked = { answer: string; slice: Msg[]; done: Extract<Msg, { type: "done" }> | Extract<Msg, { type: "error" }> | null };

export type ConsoleOptions = {
  url?: string;
  /** Wait for the model to be ready; "game" also waits for the game to be connected. */
  ready?: boolean | "game";
  /** Start from a fresh conversation. */
  reset?: boolean;
};

export type AskOptions = {
  /** What to do with approval cards the answer puts up. Default: leave them. */
  cards?: "leave" | "decline" | "approve";
  timeoutMs?: number;
};

export async function openConsole(opts: ConsoleOptions = {}) {
  const ws = new WebSocket(opts.url ?? "ws://127.0.0.1:5170/ws");
  const got: Msg[] = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));

  const until = async <T extends Msg = Msg>(pred: (m: Msg) => boolean, ms: number, from = 0): Promise<T | null> => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const hit = got.slice(from).find(pred);
      if (hit) return hit as T;
      await Bun.sleep(50);
    }
    return null;
  };
  const send = (m: unknown) => ws.send(JSON.stringify(m));

  if (opts.ready !== false) {
    await until((m) => m.type === "status" && m.model.state === "ready" && (opts.ready !== "game" || m.game.connected), 120_000);
  }
  const reset = async () => {
    const from = got.length;
    send({ type: "reset" });
    await until((m) => m.type === "reset", 5000, from);
  };
  if (opts.reset) await reset();

  /** Asks and waits for the answer to finish; returns the text, the messages it produced and the done/error. */
  const askFull = async (text: string, o: AskOptions = {}): Promise<Asked> => {
    const from = got.length;
    send({ type: "ask", text });
    const done = await until<Asked["done"] & object>((m) => m.type === "done" || m.type === "error", o.timeoutMs ?? 120_000, from);
    const slice = got.slice(from);
    if (o.cards && o.cards !== "leave") {
      for (const card of slice.filter((m) => m.type === "approval") as { id: string }[]) send({ type: o.cards === "approve" ? "approve" : "decline", id: card.id });
    }
    const answer = slice.filter((m) => m.type === "token").map((m) => (m as { text: string }).text).join("").trim();
    return { answer, slice, done };
  };
  const ask = async (text: string, o: AskOptions = {}): Promise<string> => (await askFull(text, o)).answer;

  const results: Result[] = [];
  const answers: Record<string, string> = {};
  const check = (name: string, ok: boolean, detail = "") => {
    results.push([name, ok, detail]);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  };

  /** Prints the tally, saves the run under `evalName` if given, closes the socket, and exits 1 on any failure. */
  const finish = async (evalName?: string): Promise<never> => {
    ws.close();
    const passed = results.filter(([, ok]) => ok).length;
    console.log(`\n${passed}/${results.length} passed`);
    if (evalName) console.log(`Saved to ${await saveEvalRun(evalName, asChecks(results), answers)}`);
    process.exit(passed < results.length ? 1 : 0);
  };

  return { ws, got, until, send, reset, ask, askFull, check, results, answers, finish, close: () => ws.close() };
}
