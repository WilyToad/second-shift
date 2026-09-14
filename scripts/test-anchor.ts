// FC-092 in-game: with the player in remote view, "character" searches and screenshots centre on the character and
// "view" ones on the map view; the digest reports both. Test tooling puts the player in remote view and back.
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const call = async (action: ActionName, args: Record<string, unknown> = {}) => {
  const { reply } = parseReply(await dev.rcon.exec(encodeCommand({ id: Date.now(), action, args })));
  if (!reply.ok) throw new Error(`${action}: ${JSON.stringify(reply.error)}`);
  return actions[action].data.parse(reply.data) as any;
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }, d = 2) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;

// Remote view at a visible spot 60–120 tiles from the character.
const setup = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.physical_surface local c = p.physical_position
  for _, d in pairs({ 120, 96, 64 }) do
    local spot = { x = c.x + d, y = c.y }
    if p.force.is_chunk_visible(s, { x = math.floor(spot.x / 32), y = math.floor(spot.y / 32) }) then
      p.set_controller({ type = defines.controllers.remote, position = spot, surface = s })
      rcon.print(helpers.table_to_json({ character = c, view = p.position, remote = p.controller_type == defines.controllers.remote })) return
    end
  end
  rcon.print("{}")`)) as { character?: { x: number; y: number }; view?: { x: number; y: number }; remote?: boolean };

try {
  check("setup: the player is in remote view away from their character", !!setup.remote && !!setup.character && !near(setup.character, setup.view!, 30), JSON.stringify(setup));
  if (setup.remote) {
    const digest = await call("digest");
    check("the digest reports both spots", digest.player?.remote_view === true && near(digest.player.position, setup.view!) && near(digest.player.character_position, setup.character!), JSON.stringify(digest.player));
    const byCharacter = await call("find_entities", { from: "character", radius: 16 });
    const byView = await call("find_entities", { from: "view", radius: 16 });
    check("'near me' searches centre on the character", near(byCharacter.center, setup.character!) && byCharacter.from === "character", JSON.stringify(byCharacter.center));
    check("'here' searches centre on the map view", near(byView.center, setup.view!) && byView.from === "view", JSON.stringify(byView.center));
    const shot = await call("screenshot", { from: "character", size: 256 });
    check("a screenshot of where I'm standing is taken at the character", near(shot, setup.character!), `${shot.x}, ${shot.y}`);
  }
} finally {
  await dev.sc(`local p = game.connected_players[1] if p.controller_type == defines.controllers.remote then p.exit_remote_view() end rcon.print("back")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
