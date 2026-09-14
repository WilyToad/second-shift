// FC-106 through the real server: a pasted build with a known answer. Needs bun run start + the dev save hosted.
// Expected numbers come from the save's own data via blueprintThroughput, so research on the save can't break it.
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { BlueprintSchema, encodeBlueprintString } from "../server/src/blueprint";
import { blueprintThroughput } from "../server/src/blueprint-throughput";
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const RUNS = 2;
const dev = await connectDevGame();
const p = PrototypesSchema.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} }))).reply.data);
dev.rcon.close();

// 3 copper cable : 2 circuit assemblers (cables balance exactly), one basic inserter feeding a circuit assembler, a belt.
const entities: object[] = [];
for (let i = 0; i < 5; i++) entities.push({ name: "assembling-machine-3", position: { x: 1.5 + 4 * i, y: 1.5 }, recipe: i < 3 ? "copper-cable" : "electronic-circuit" });
entities.push({ name: "inserter", position: { x: 13.5, y: -0.5 }, direction: 0 });
for (let x = 0; x < 20; x++) entities.push({ name: "fast-transport-belt", position: { x: x + 0.5, y: 4.5 }, direction: 4 });
const bp = { item: "blueprint", label: "circuits", version: 562949958139904, entities: entities.map((e, i) => ({ entity_number: i + 1, ...e })) };
const t = blueprintThroughput(BlueprintSchema.parse(bp), p);
const flow = (list: typeof t.inputs, name: string) => Math.round(list.find((f) => f.name === name)?.perMinute ?? NaN);
const circuits = flow(t.outputs, "electronic-circuit"), copper = flow(t.inputs, "copper-plate"), iron = flow(t.inputs, "iron-plate");
console.log(`  expected: ${circuits} circuits/min from ${copper} copper and ${iron} iron plate/min; limits ${JSON.stringify(t.limits)}`);
const str = encodeBlueprintString({ blueprint: bp });

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
await until((m) => m.type === "status" && m.model.state === "ready", 120_000);
const results: [string, boolean, string][] = [];
const answers: Record<string, string> = {};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const has = (text: string, n: number) => new RegExp(`\\b${n.toLocaleString("en-US").replace(",", ",?")}\\b`).test(text);

for (let run = 1; run <= RUNS; run++) {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  const started = performance.now();
  ws.send(JSON.stringify({ type: "ask", text: `How many electronic circuits per minute does this make, what does it need per minute, and is anything holding it back? ${str}` }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const answer = got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  answers[`run ${run}`] = answer;
  check(`run ${run}: circuits per minute (${circuits})`, has(answer, circuits), `${answer.slice(0, 500)} [${seconds} s]`);
  check(`run ${run}: copper and iron plate per minute (${copper}, ${iron})`, has(answer, copper) && has(answer, iron));
  check(`run ${run}: names the slow inserter`, t.limits.length > 0 && /inserter/i.test(answer));
  check(`run ${run}: no chart for a build that isn't running`, !answer.includes("```rate_chart"));
}
ws.close();
await saveEvalRun("throughput", asChecks(results), answers);
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
