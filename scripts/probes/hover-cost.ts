// FC-151: cost of the hover record. Toggles the player's selection between two test chests (as sweeping the mouse
// does), timing the changes, and checks the mod saw them through on_selected_entity_changed. Dev save hosted.
import { encodeCommand, parseReply } from "../../interfaces/src/index";
import { connectDevGame } from "../lib/devgame";
const game = await connectDevGame();
const N = 5000;
const r = JSON.parse(await game.sc(`
  local p = game.connected_players[1] local s = p.character.surface local at = p.character.position
  local a = s.create_entity({ name = "iron-chest", position = s.find_non_colliding_position("iron-chest", { x = at.x + 2, y = at.y + 2 }, 20, 1), force = p.force })
  local b = s.create_entity({ name = "wooden-chest", position = s.find_non_colliding_position("wooden-chest", { x = at.x - 2, y = at.y + 2 }, 20, 1), force = p.force })
  local prof = helpers.create_profiler()
  for i = 1, ${N} do p.selected = (i % 2 == 0) and a or b end
  prof.stop()
  p.selected = nil
  storage_probe = { a = a, b = b }
  rcon.print(helpers.table_to_json({ ok = true }))
  helpers.write_file("hover-cost.txt", { "", prof }, false)`));
const { reply } = parseReply(await game.rcon.exec(encodeCommand({ id: 1, action: "pointed_at", args: {} })));
await game.sc(`for _, e in pairs(storage_probe) do if e.valid then e.destroy() end end storage_probe = nil rcon.print("ok")`);
const path = `${process.env.HOME}/Library/Application Support/factorio/script-output/hover-cost.txt`;
const text = (await Bun.file(path).text()).trim();
const ms = Number(/([\d.]+)ms/.exec(text)?.[1]);
console.log(`${N} selection changes: ${text} → ${((ms * 1000) / N).toFixed(3)} µs each; mod's last hovered: ${JSON.stringify((reply as any).data?.last_hovered)}`);
game.rcon.close();
