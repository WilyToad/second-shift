// FC-151 FC-152: "what is this?" and "what's in this chest?" through the real server, with the mouse on a test chest
// (selected by test tooling). Server and dev save running; resets the conversation.
import { openConsole } from "./lib/console";
import { encodeCommand } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const game = await connectDevGame();
await game.leaveRemoteView();
const chest = JSON.parse(await game.sc(`
  local p = game.connected_players[1] local s = p.character.surface local at = p.character.position
  local e = s.create_entity({ name = "iron-chest", position = s.find_non_colliding_position("iron-chest", { x = at.x + 3, y = at.y }, 20, 1), force = p.force })
  e.insert({ name = "iron-gear-wheel", count = 37 }) e.insert({ name = "copper-cable", count = 120 })
  rcon.print(helpers.table_to_json({ name = e.name, x = e.position.x, y = e.position.y }))`));
const select = (args: Record<string, unknown>) => game.rcon.exec(encodeCommand({ id: Date.now(), action: "debug_select_entity", args }));

const { ws, got, until, results } = await openConsole({ reset: true });
const ask = async (q: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: q }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  return got.slice(from).filter((m) => m.type === "token").map((m) => (m as { text: string }).text).join("");
};
const check = (name: string, ok: boolean, detail: string) => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`); };

await select(chest);
const what = await ask("Can you see what I have highlighted, what is this?");
check("names the chest under the mouse", /iron[- ]chest/i.test(what), what);
const inside = await ask("What's in this chest?");
check("says what's inside from the save", /\b37\b/.test(inside) && /\b120\b/.test(inside) && /gear/i.test(inside), inside);
await select({});
const moved = await ask("what was that I was just hovering over?");
check("after the mouse moved on, names the last hovered", /iron[- ]chest/i.test(moved), moved);
ws.close();
await game.destroy([chest]);
game.rcon.close();
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
