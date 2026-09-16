// FC-160: "what is this?" answers must stick to what the save says about the thing, and not volunteer game
// mechanics from the model's memory (a modded save can contradict them). Test entities are placed next to the
// player, put under the mouse with test tooling, and asked about through the real server.
// Usage (server and dev save running, resets the conversation): bun scripts/eval-pointing.ts
import type { ServerMessage } from "../server/src/messages";
import { encodeCommand, parseReply, PrototypesSchema } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const p = PrototypesSchema.parse(parseReply(await dev.rcon.exec(encodeCommand({ id: 1, action: "dump_prototypes", args: {} }))).reply.data);

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
ws.send(JSON.stringify({ type: "reset" }));
await until((m) => m.type === "reset", 5000);
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  for (const card of got.slice(from).filter((m) => m.type === "approval") as any[]) ws.send(JSON.stringify({ type: "decline", id: card.id }));
  return got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const answers: Record<string, string> = {};

// Claims about how a thing behaves. The save's own facts (type, logistic job, stacks, fluid, speed) are fine; these
// verbs are how the model states mechanics nobody asked about, which is what FC-160 is about.
const MECHANICS = /\b(pulls?|pull from|won'?t pull|requests?|requesting|provides?|feeds?|inserts?|accepts?|rejects?|connects? to|powers?|needs power|automatically|only you can|robots? will|bots? will|can'?t be|must be|will not|stacks? up to)\b/i;

const CASES = [
  { name: "passive-provider-chest", ask: "What is this?", insert: { name: "iron-gear-wheel", count: 37 },
    // Wrong in the first voice-session replay: requester chests are filled from passive providers.
    forbidden: [/requester chests? (won'?t|can'?t|don'?t|do not|will not) (pull|take|request)/i, /only you can (take|grab)/i] },
  { name: "storage-tank", ask: "What's this thing, what's it for?", forbidden: [] },
  { name: "transport-belt", ask: "What is this belt?", forbidden: [] },
  { name: "medium-electric-pole", ask: "What is this?", forbidden: [] },
];

const placed: { name: string; x: number; y: number }[] = [];
try {
  for (const c of CASES) {
    const spot = JSON.parse(await dev.sc(`local pl = game.connected_players[1] local s = pl.physical_surface local at = pl.physical_position
      local pos = s.find_non_colliding_position("${c.name}", { x = at.x + 3, y = at.y + 3 }, 30, 1)
      local e = pos and s.create_entity({ name = "${c.name}", position = pos, force = pl.force })
      ${c.insert ? `if e then e.insert({ name = "${c.insert.name}", count = ${c.insert.count} }) end` : ""}
      rcon.print(helpers.table_to_json(e and { name = e.name, x = e.position.x, y = e.position.y } or {}))`));
    if (!spot.name) { check(`${c.name}: placed for the test`, false, "no room to place it"); continue; }
    placed.push(spot);
    await dev.rcon.exec(encodeCommand({ id: Date.now(), action: "debug_select_entity", args: spot }));
    const answer = await ask(c.ask);
    answers[`${c.name}: ${c.ask}`] = answer;
    console.log(`\n> ${c.name}: ${c.ask}\n${answer}`);
    check(`${c.name}: named from the save`, new RegExp(c.name.replace(/-/g, "[- ]?"), "i").test(answer), answer.slice(0, 160));
    for (const bad of c.forbidden) check(`${c.name}: doesn't repeat the wrong mechanic ${bad}`, !bad.test(answer), answer);
    // Numbers the save knows: if the answer gives one, it must be the save's.
    const facts = p.entities[c.name];
    if (facts?.fluid_capacity) {
      const said = answer.match(/([\d][\d,\.]*)\s*(?:units? of )?(?:fluid|liquid)/i)?.[1]?.replace(/[,\.]/g, "");
      check(`${c.name}: any fluid capacity is the save's ${facts.fluid_capacity}`, !said || Number(said) === facts.fluid_capacity, said ? `said ${said}` : "gave no number");
    }
    if (facts?.inventory_size) {
      const said = answer.match(/([\d]+)\s*(?:slots?|stacks?)/i)?.[1];
      check(`${c.name}: any slot count is the save's ${facts.inventory_size}`, !said || Number(said) === facts.inventory_size, said ? `said ${said}` : "gave no number");
    }
  }
} finally {
  await dev.sc(`local pl = game.connected_players[1] pl.selected = nil rcon.print("ok")`);
  await dev.destroy(placed);
  ws.close();
}
const volunteered = Object.entries(answers).flatMap(([q, a]) => a.split(/(?<=[.!?])\s+/).filter((line) => MECHANICS.test(line)).map((line) => `${q.split(":")[0]}: ${line.trim()}`));
console.log(`\nsentences stating how something behaves (not asked for): ${volunteered.length}`);
for (const line of volunteered) console.log(`  · ${line}`);
// Measured, not a pass/fail line: the model may still explain what a thing does, and that's fine when the facts
// back it. The gate is that nothing known to be wrong comes back and every number comes from the save.
check("few answers volunteer how something behaves", volunteered.length <= 3, volunteered.join(" | "));
dev.rcon.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-pointing", asChecks(results), answers)}`);
process.exit(failed.length ? 1 : 0);
