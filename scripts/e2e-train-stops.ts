// FC-109 through the real server: find train stops, ask to set their train limit, approve, check the game.
// Needs bun run start + the dev save hosted. Test tooling moves the player to open ground, builds two
// train stops there, and puts everything back afterwards.
import { openConsole } from "./lib/console";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const setup = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.surface local from = p.position
  local spot = s.find_non_colliding_position("rocket-silo", { from.x - 60, from.y }, 300, 2, true)
  p.teleport(spot)
  local out = { from = from, machines = {} }
  for i = 0, 1 do
    local e = s.create_entity({ name = "train-stop", position = { spot.x - 4 + i * 8, spot.y + 5 }, force = p.force, direction = defines.direction.north })
    if e then out.machines[#out.machines + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
  end
  out.to = p.position
  rcon.print(helpers.table_to_json(out))`)) as { from: { x: number; y: number }; to: { x: number; y: number }; machines: { name: string; x: number; y: number }[] };

const { ws, got, until, check, results } = await openConsole();
const limits = async () => JSON.parse(await dev.sc(`local s = game.connected_players[1].surface local out = {} for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(setup.machines)}]=])) do local e = s.find_entity(r.name, r) out[#out + 1] = e and e.trains_limit or -1 end rcon.print(helpers.table_to_json(out))`)) as number[];

try {
    await until((m) => m.type === "digest" && Math.abs((m.digest.player?.position.x ?? 0) - setup.to.x) < 1, 10_000, got.length);
  check("setup: two train stops next to the player", setup.machines.length === 2, JSON.stringify(setup.machines));
  const before = await limits();
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  const started = performance.now();
  ws.send(JSON.stringify({ type: "ask", text: "Find the train stops around me and set their train limit to 2" }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const slice = got.slice(from);
  const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
  const tools = slice.filter((m) => m.type === "tool").map((m: any) => m.summary);
  const card = slice.find((m) => m.type === "approval");
  check("asks for approval before changing anything", card?.type === "approval" && JSON.stringify(await limits()) === JSON.stringify(before), `${card?.type === "approval" ? card.title : "no card"} | tools: ${tools.join(" / ")} | ${answer.slice(0, 200)} [${((performance.now() - started) / 1000).toFixed(1)} s]`);
  if (card?.type === "approval") {
    const at = got.length;
    ws.send(JSON.stringify({ type: "approve", id: card.id }));
    const result = await until((m) => m.type === "approval_result", 30_000, at);
    const now = await limits();
    check("approving sets the train limit in the game", result?.type === "approval_result" && result.status === "done" && now.every((l) => l === 2), `${result?.type === "approval_result" ? result.message : "no result"}; game: ${now.join(", ")}`);
  }
} finally {
  ws.close();
  console.log(`  cleanup: ${await dev.sc(`local p = game.connected_players[1] local s = p.surface
    for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(setup.machines)}]=])) do local e = s.find_entity(r.name, r) if e then e.destroy() end end
    p.teleport({ ${setup.from.x}, ${setup.from.y} })
    rcon.print("back at " .. p.position.x .. "," .. p.position.y)`)}`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
