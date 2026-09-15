// FC-147 through the real server: a push-to-talk press in the game reaches the console as a "talk" message within
// about half a second, and never shows up in the alert feed. Needs bun run start + the dev save hosted.
// Custom inputs can't be raised from script, so test tooling pushes the same feed event a key press makes.
import { encodeCommand, parseReply } from "../interfaces/src/index";
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const bound = await dev.sc(`local c = prototypes.custom_input["second-shift-talk"] rcon.print(c and c.key_sequence or "missing")`);
check("the game has the Talk to Second Shift control", bound !== "missing", `key ${bound}`);

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: { at: number; m: ServerMessage }[] = [];
ws.onmessage = (e) => got.push({ at: performance.now(), m: JSON.parse(String(e.data)) });
await new Promise((r) => (ws.onopen = r));
await Bun.sleep(1500);
const from = got.length;
const pressed = performance.now();
const { reply } = parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "debug_push_talk", args: {} })));
const end = performance.now() + 3000;
while (performance.now() < end && !got.slice(from).some((g) => g.m.type === "talk")) await Bun.sleep(20);
const talk = got.slice(from).find((g) => g.m.type === "talk");
check("a press reaches the console as a talk message", reply.ok && !!talk, talk ? `${Math.round(talk.at - pressed)} ms` : "no talk message in 3 s");
check("within half a second", !!talk && talk.at - pressed < 500);
await Bun.sleep(600);
const leaked = got.slice(from).some((g) => g.m.type === "events" && g.m.events.some((e) => e.kind === "talk"));
check("the press isn't an alert-feed event", !leaked);

// A page that connects later doesn't get old presses (it would start listening on its own).
const late = new WebSocket("ws://127.0.0.1:5170/ws");
const lateGot: ServerMessage[] = [];
late.onmessage = (e) => lateGot.push(JSON.parse(String(e.data)));
await new Promise((r) => (late.onopen = r));
await Bun.sleep(800);
check("a page opened later gets no old presses", !lateGot.some((m) => m.type === "talk" || (m.type === "events" && m.events.some((e) => e.kind === "talk"))));

ws.close();
late.close();
dev.rcon.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
