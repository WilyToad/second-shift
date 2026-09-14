// S08 acceptance through the real server and model (bun run start + dev save hosted).
import { encodeBlueprintString } from "../server/src/blueprint";
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
await dev.leaveRemoteView();
const sc = dev.sc;
const originalQueue = await sc(`local q = {} for _, t in pairs(game.forces.player.research_queue or {}) do q[#q+1] = t.name end rcon.print(helpers.table_to_json(q))`);
const { placed: rails } = await dev.placeRailsEast(6);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
const ask = async (text: string) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const slice = got.slice(from);
  return { answer: slice.filter((m) => m.type === "token").map((m: any) => m.text).join(""), tools: slice.filter((m) => m.type === "tool").map((m: any) => m.summary), card: slice.find((m) => m.type === "approval") as any, done: done as any };
};
const approve = async (card: any) => {
  const from = got.length;
  ws.send(JSON.stringify({ type: "approve", id: card.id }));
  return (await until((m) => m.type === "approval_result" && (m as any).id === card.id, 30_000, from)) as any;
};

try {
  await until((m) => m.type === "status" && m.model.state === "ready" && m.game.connected, 120_000);
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000);

  // 1. Research: pick and queue.
  const r1 = await ask("Research has stopped. Pick something useful I can research right now and queue it.");
  const queue = JSON.parse(await sc(`local q = {} for _, t in pairs(game.forces.player.research_queue or {}) do q[#q+1] = t.name end rcon.print(helpers.table_to_json(q))`));
  check("queues a technology when asked", Array.isArray(queue) && queue.length > 0 && r1.tools.some((t) => /^Queued/.test(t)), `${r1.tools.join(" | ") || "no tool"}; queue now ${JSON.stringify(queue)}; answer: ${r1.answer.trim().slice(0, 200)}`);

  // 2. Upgrade the rails found to the right... rails have no next tier, so use belts: find, then mark upgrade.
  const belts = JSON.parse(await sc(`
    local p = game.connected_players[1] local s = p.surface local out = {} storage.e2e_belts = {}
    for dx = 6, 40 do if #out < 4 then local pos = { x = math.floor(p.position.x) + dx + 0.5, y = math.floor(p.position.y) + 0.5 }
      if s.can_place_entity({ name = "transport-belt", position = pos, force = p.force }) then local e = s.create_entity({ name = "transport-belt", position = pos, force = p.force }) out[#out+1] = { name = e.name, x = e.position.x, y = e.position.y } storage.e2e_belts[#storage.e2e_belts+1] = e end end end
    rcon.print(helpers.table_to_json(out))`));
  const f = await ask("How many yellow belts are near me on the right?");
  check("finds the test belts", f.tools.some((t) => Number(t.match(/Found (\d+) /)?.[1] ?? 0) >= belts.length), f.tools.join(" | "));
  const u = await ask("Mark them for upgrade.");
  check("upgrade asks for approval first", !!u.card && /upgrade/i.test(u.card.title), u.card?.title ?? `no card; answer ${u.answer.trim()}`);
  if (u.card) {
    const res = await approve(u.card);
    const marked = Number(await sc(`local n = 0 for _, e in pairs(storage.e2e_belts or {}) do if e.valid and e.to_be_upgraded() then n = n + 1 end end rcon.print(n)`));
    check("approving marks the belts for upgrade in the game", res?.status === "done" && marked === belts.length, `${res?.message}; in game ${marked}/${belts.length}`);
  }

  // 3. Paste a small blueprint, then place it.
  const bp = encodeBlueprintString({ blueprint: { item: "blueprint", label: "three belts", entities: [0, 1, 2].map((i) => ({ entity_number: i + 1, name: "transport-belt", position: { x: i + 0.5, y: 0.5 }, direction: 4 })) } });
  await ask(`Here's a small blueprint: ${bp}`);
  const p = await ask("Paste it here.");
  check("placing a blueprint asks for approval first", !!p.card && /Paste the blueprint/.test(p.card.title), p.card?.title ?? `no card; answer ${p.answer.trim()}`);
  if (p.card) {
    const res = await approve(p.card);
    const reported = Number(res?.message?.match(/Placed (\d+)/)?.[1] ?? -1);
    const ghosts = Number(await sc(`local p = game.connected_players[1] local n = 0 for _, g in pairs(p.surface.find_entities_filtered({ position = p.position, radius = 6, name = "entity-ghost", force = p.force })) do if g.ghost_name == "transport-belt" then n = n + 1 end end rcon.print(n)`));
    check("the ghosts in the game match what was reported", res?.status === "done" && reported === ghosts, `${res?.message}; ghosts found ${ghosts}`);
  }

  // 4. Map tag, asked for directly.
  const t = await ask("Put a map tag here that says ore check.");
  const tags = Number(await sc(`local p = game.connected_players[1] local n = 0 for _, tg in pairs(p.force.find_chart_tags(p.surface, { { p.position.x - 4, p.position.y - 4 }, { p.position.x + 4, p.position.y + 4 } })) do if tg.text:lower():find("ore check") then n = n + 1 end end rcon.print(n)`));
  check("adds the requested map tag without a card", tags > 0 && !t.card, `${t.tools.join(" | ")}; tags ${tags}`);
} finally {
  await sc(`
    local p = game.connected_players[1] local s = p.surface local f = p.force
    for _, e in pairs(storage.e2e_belts or {}) do if e.valid then e.destroy() end end storage.e2e_belts = nil
    for _, g in pairs(s.find_entities_filtered({ position = p.position, radius = 60, name = "entity-ghost", force = f })) do if g.ghost_name == "transport-belt" then g.destroy() end end
    for _, tg in pairs(f.find_chart_tags(s, { { p.position.x - 10, p.position.y - 10 }, { p.position.x + 10, p.position.y + 10 } })) do if tg.text:lower():find("ore check") then tg.destroy() end end
    f.cancel_current_research() local q = {} for _, name in pairs(helpers.json_to_table([=[${originalQueue}]=]) or {}) do q[#q+1] = name end f.research_queue = q
    if p.controller_type == defines.controllers.remote then p.exit_remote_view() end
    rcon.print("cleaned")`);
  await dev.destroy(rails);
  dev.rcon.close();
  ws.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
