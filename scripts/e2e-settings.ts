// FC-093 through the real server: find assemblers, ask to change their recipe, approve, check the game.
// Needs bun run start + the dev save hosted. Test tooling moves the player to open ground, builds three
// assemblers there, and puts everything back afterwards.
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const setup = JSON.parse(await dev.sc(`local p = game.connected_players[1] local s = p.surface local from = p.position
  local spot = s.find_non_colliding_position("rocket-silo", { from.x - 60, from.y }, 300, 2, true)
  p.teleport(spot)
  local out = { from = from, machines = {} }
  for i = 0, 2 do
    local e = s.create_entity({ name = "assembling-machine-2", position = { spot.x - 4 + i * 4, spot.y + 5 }, force = p.force })
    if e then e.set_recipe("iron-gear-wheel") out.machines[#out.machines + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
  end
  out.to = p.position
  rcon.print(helpers.table_to_json(out))`)) as { from: { x: number; y: number }; to: { x: number; y: number }; machines: { name: string; x: number; y: number }[] };

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const recipes = async () => JSON.parse(await dev.sc(`local s = game.connected_players[1].surface local out = {} for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(setup.machines)}]=])) do local e = s.find_entity(r.name, r) out[#out + 1] = e and e.get_recipe() and e.get_recipe().name or "none" end rcon.print(helpers.table_to_json(out))`)) as string[];

try {
  await until((m) => m.type === "status" && m.model.state === "ready", 120_000);
  await until((m) => m.type === "digest" && Math.abs((m.digest.player?.position.x ?? 0) - setup.to.x) < 1, 10_000, got.length);
  check("setup: three gear assemblers next to the player", setup.machines.length === 3, JSON.stringify(setup.machines));
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  const started = performance.now();
  ws.send(JSON.stringify({ type: "ask", text: "Switch the assembling machines around me to copper cable" }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const slice = got.slice(from);
  const answer = slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim();
  const tools = slice.filter((m) => m.type === "tool").map((m: any) => m.summary);
  const card = slice.find((m) => m.type === "approval");
  check("asks for approval before changing anything", card?.type === "approval" && (await recipes()).every((r) => r === "iron-gear-wheel"), `${card?.type === "approval" ? card.title : "no card"} | tools: ${tools.join(" / ")} | ${answer.slice(0, 200)} [${((performance.now() - started) / 1000).toFixed(1)} s]`);
  if (card?.type === "approval") {
    const at = got.length;
    ws.send(JSON.stringify({ type: "approve", id: card.id }));
    const result = await until((m) => m.type === "approval_result", 30_000, at);
    const now = await recipes();
    check("approving sets the recipe in the game", result?.type === "approval_result" && result.status === "done" && now.every((r) => r === "copper-cable"), `${result?.type === "approval_result" ? result.message : "no result"}; game: ${now.join(", ")}`);
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
