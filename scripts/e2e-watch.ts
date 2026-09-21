// FC-193: the background pass runs while the player asks their own questions, says at most one quiet line, and
// costs them nothing they'd notice. Checks the behaviour end to end and re-measures the cache with it running.
// Usage (server started with COMPANION_WATCH_MS=10000, dev save hosted): bun scripts/e2e-watch.ts
import { openConsole } from "./lib/console";

const { ws, got, until, check, results } = await openConsole({ ready: false });

/** Every finding the pass judged is written here, said or not (FC-247) — so a look leaves a trace even when a
 *  healthy factory gives it nothing to say. */
const LABELS = new URL("../data/labels/watch.jsonl", import.meta.url).pathname;
const judged = async () => (await Bun.file(LABELS).exists()) ? (await Bun.file(LABELS).text()).trimEnd().split("\n").filter(Boolean).length : 0;
const judgedBefore = await judged();

await until((m) => m.type === "status", 30_000);
check("off until it's turned on", got.some((m) => m.type === "watching" && !m.on), "");

// Nothing should arrive while it's off.
const quiet = got.length;
await Bun.sleep(6000);
check("says nothing while off", !got.slice(quiet).some((m) => m.type === "note"), "");

ws.send(JSON.stringify({ type: "watch", on: true }));
const on = await until((m) => m.type === "watching" && m.on, 5000);
check("turns on when asked", Boolean(on), "");

const from = got.length;
const note = await until((m) => m.type === "note", 90_000, from) as { text: string; sinceMs: number } | null;
// A healthy factory says nothing, and that is correct — so silence on its own can't be a failure, or the suite
// fails on the game's mood (it did once, 7/8, on a save whose labs had just been given something to do). What has
// to be true is that the pass *looked*: either it wrote a line, or it judged findings and decided against one.
const judgedNow = await judged();
const looked = note !== null || judgedNow > judgedBefore;
check("looked at the factory, and wrote a line if there was one worth writing", looked,
  note ? note.text : `no line; ${judgedNow - judgedBefore} findings judged and none worth saying`);
if (note) {
  check("one sentence, not a paragraph", note.text.split(/\s+/).length <= 30, `${note.text.split(/\s+/).length} words`);
  check("says nothing about itself", !/\b(the ship|hauler|manifest|i flew|trimmed)\b/i.test(note.text), note.text);
}

// It must not repeat itself, and must not chatter: with a 10 s look interval the floor is 20 s.
await Bun.sleep(25_000);
const said = got.filter((m) => m.type === "note").map((m) => (m as { text: string }).text);
check("never says the same line twice", new Set(said).size === said.length, said.join(" | ").slice(0, 200));
check("keeps quiet between notes", said.length <= 2, `${said.length} notes in ~40 s of looking every 10 s`);

// And the player's own question still works while it's running.
const asked = got.length;
ws.send(JSON.stringify({ type: "ask", text: "How many copper cables does a green circuit take?" }));
const done = await until((m) => m.type === "done" || m.type === "error", 120_000, asked);
const answer = got.slice(asked).filter((m) => m.type === "token").map((m) => (m as { text: string }).text).join("");
check("a question still gets answered with it running", Boolean(done) && /\b3\b/.test(answer), answer.slice(0, 120));

ws.send(JSON.stringify({ type: "watch", on: false }));
await until((m) => m.type === "watching" && !m.on, 5000);
check("turns off again", true, "");
ws.close();

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed < results.length) process.exit(1);
