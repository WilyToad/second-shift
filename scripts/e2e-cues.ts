// FC-260: Ballast writes delivery cues only when an ElevenLabs voice will read him, and they reach the voice and
// nothing else. Asks the same kinds of question with and without the console's `cues` flag, then reopens the console
// to check the transcript a reloaded page gets.
// Usage (server running; the game can be closed): bun scripts/e2e-cues.ts [--listen]
//   --listen: reads the cued answers aloud through the server's /tts with its ElevenLabs voice. **Spends the player's
//             ElevenLabs credits** — only on their word.
import { CUES, withoutCues } from "../interfaces/src/cues";
import { openConsole } from "./lib/console";

const listen = process.argv.includes("--listen");
const url = process.env.COMPANION_CONSOLE_URL ?? "ws://127.0.0.1:5170/ws";
const QUESTIONS = [
  "Why is my research stuck?",
  "Biters just hit the north wall and two turrets are dry. What do I do?",
  "What goes into a Cerys charging rod?",
  "Do you ever miss flying?",
];
const CUE = new RegExp(`\\[(?:${[...CUES].sort((a, b) => b.length - a.length).join("|")})\\]`, "gi");
const ANY_BRACKET = /\[[a-z][a-z ,]*\]/gi;
/** A test without the global flag's memory of where the last match was. */
const hasCue = (s: string) => new RegExp(CUE.source, "i").test(s);

const c = await openConsole({ ready: true, reset: true });
const cued: string[] = [];
for (const q of QUESTIONS) {
  const a = await c.ask(q, { extra: { cues: true } });
  cued.push(a);
  const found: string[] = a.match(CUE) ?? [];
  const offList = (a.match(ANY_BRACKET) ?? []).filter((b) => !found.includes(b));
  console.log(`  ${found.length} cue(s) ${found.join(" ")}${offList.length ? ` | off the list: ${offList.join(" ")}` : ""}\n    ${a.replace(/\s+/g, " ").slice(0, 220)}`);
  c.check(`"${q}": at most three cues`, found.length <= 3, found.join(" "));
  c.check(`"${q}": no cue the list doesn't have`, offList.length === 0, offList.join(" "));
}
c.check("cues appear when an ElevenLabs voice reads the answers", cued.some(hasCue), `${cued.map((a) => (a.match(CUE) ?? []).length).join(", ")} per answer`);
const plain = await c.ask("Why is my research stuck?");
c.check("no cues when the flag isn't set", !(plain.match(ANY_BRACKET) ?? []).some(hasCue), plain.slice(0, 120));

// A reloaded page gets the transcript: the answers without their cues.
const again = await openConsole({ ready: true });
const transcript = await again.until((m) => m.type === "transcript", 5000) as { items: { text: string }[] } | null;
const text = JSON.stringify(transcript?.items ?? []);
c.check("the transcript a reloaded page gets has no cues", Boolean(transcript) && !hasCue(text), "");
again.close();

if (listen) {
  const http = url.replace(/^ws/, "http").replace(/\/ws$/, "");
  const dir = new URL("../data/captures/cues/", import.meta.url).pathname;
  await Bun.$`mkdir -p ${dir}`;
  for (const [i, a] of cued.entries()) {
    // The console sends sentence by sentence; one request per answer is enough to hear the cues land.
    const res = await fetch(`${http}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: a.slice(0, 600) }) });
    if (!res.ok) { console.log(`  listen ${i + 1}: ${res.status} ${await res.text()}`); continue; }
    const file = `${dir}/answer-${i + 1}.mp3`;
    await Bun.write(file, await res.arrayBuffer());
    console.log(`  playing answer ${i + 1}: ${withoutCues(a).slice(0, 80)}…`);
    await Bun.$`afplay ${file}`;
  }
}
await c.finish("e2e-cues");
