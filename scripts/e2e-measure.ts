// FC-162: "is this hitting its rate?" measures the machines in the player's own game from their craft counts.
// The first ask starts the clock, the next reports. Server and dev save running; resets the conversation.
// Test tooling feeds the idle machines next to the player so there's a real rate to find.
import { openConsole } from "./lib/console";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const fed = JSON.parse(await dev.sc(`local p = game.connected_players[1] local at = p.physical_position local n = 0
  for _, e in pairs(p.surface.find_entities_filtered({ area = { { at.x - 32, at.y - 32 }, { at.x + 32, at.y + 32 } }, type = "assembling-machine", force = p.force })) do
    local r = e.get_recipe()
    if r then
      for _, i in pairs(r.ingredients) do if i.type == "item" then e.insert({ name = i.name, count = math.min(400, i.amount * 120) }) end end
      n = n + 1
    end
  end rcon.print(helpers.table_to_json({ fed = n }))`));
const truth = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1] local at = p.physical_position local total = 0
  for _, e in pairs(p.surface.find_entities_filtered({ area = { { at.x - 32, at.y - 32 }, { at.x + 32, at.y + 32 } }, type = { "assembling-machine", "furnace", "rocket-silo" }, force = p.force })) do
    total = total + e.products_finished
  end rcon.print(helpers.table_to_json({ total = total, tick = game.tick }))`)) as { total: number; tick: number };

const { ws, got, until, results, answers } = await openConsole({ reset: true });
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  for (const card of got.slice(from).filter((m) => m.type === "approval") as any[]) ws.send(JSON.stringify({ type: "decline", id: card.id }));
  const answer = got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
  console.log(`\n> ${text}\n${answer}`);
  return { answer, tools: got.slice(from).filter((m) => m.type === "tool").map((m: any) => m.summary) };
};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

try {
  const first = await ask("Are the machines around me actually producing anything?");
  answers["first ask"] = first.answer;
  check("the first ask starts measuring and says to ask again", /again|minute|moment|second/i.test(first.answer), first.answer.slice(0, 200));
  const before = await truth();
  await Bun.sleep(30_000);
  const after = await truth();
  const truthPerMinute = ((after.total - before.total) * 3600) / (after.tick - before.tick);
  const second = await ask("And now? What rate are they really hitting?");
  answers["second ask"] = second.answer;
  const said = [...second.answer.matchAll(/([\d][\d,\.]*)\s*(?:crafts?|items?|magazines?|per minute|\/min| a minute)/gi)].map((m) => Number(m[1]!.replace(/,/g, "")));
  const close = said.some((n) => Math.abs(n - truthPerMinute) <= Math.max(5, truthPerMinute * 0.25));
  check("the answer gives the measured rate from the game", close, `answer numbers ${said.join(", ") || "none"}; the game made ${truthPerMinute.toFixed(1)}/min over ${((after.tick - before.tick) / 60).toFixed(0)} s (fed ${fed.fed} machines)`);
  check("it says the number was measured, not estimated", /measur\w+|craft counts|over the last/i.test(second.answer), second.answer.slice(0, 200));
} finally {
  ws.close();
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("e2e-measure", asChecks(results), answers)}`);
process.exit(failed.length ? 1 : 0);
