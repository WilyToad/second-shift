// FC-086: diagnosis scenario on the hosted dev save, through the real server (bun run start).
// Builds starved and output-blocked assemblers near the player, then asks why they're stuck.
import type { ServerMessage } from "../server/src/messages";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const results: [string, boolean, string][] = [];
const answers: Record<string, string> = {};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };

// Test tooling: 4 starved (no inputs) and 2 output-blocked iron gear assemblers.
const setup = await dev.sc(`
  local p = game.connected_players[1] local s = p.surface storage.diag = {} local made = { starved = 0, blocked = 0 }
  for dx = -40, 40, 4 do for dy = 20, 44, 4 do
    local total = made.starved + made.blocked
    if total < 6 then
      local pos = { x = p.position.x + dx + 0.5, y = p.position.y + dy + 0.5 }
      local powered = s.count_entities_filtered({ type = "electric-pole", position = pos, radius = 5, force = p.force }) > 0
      if powered and s.can_place_entity({ name = "assembling-machine-2", position = pos, force = p.force }) then
        local e = s.create_entity({ name = "assembling-machine-2", position = pos, force = p.force, raise_built = true })
        e.set_recipe("iron-gear-wheel")
        if made.starved < 4 then made.starved = made.starved + 1
        else
          e.get_inventory(defines.inventory.crafter_input).insert({ name = "iron-plate", count = 100 })
          e.get_inventory(defines.inventory.crafter_output).insert({ name = "iron-gear-wheel", count = 200 })
          made.blocked = made.blocked + 1
        end
        storage.diag[#storage.diag + 1] = e
      end
    end
  end end
  rcon.print(helpers.table_to_json(made))`);
console.log(`setup: ${setup}`);

try {
  // Let the registry poll them and the server pick up a fresh digest.
  await Bun.sleep(8000);
  const statuses = await dev.sc(`local c = {} for _, e in pairs(storage.diag or {}) do if e.valid then local st for k, v in pairs(defines.entity_status) do if v == e.status then st = k end end c[st or "?"] = (c[st or "?"] or 0) + 1 end end rcon.print(helpers.table_to_json(c))`);
  console.log(`in-game statuses: ${statuses}`);

  const ws = new WebSocket("ws://127.0.0.1:5170/ws");
  const got: ServerMessage[] = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));
  const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
    const end = performance.now() + ms;
    while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
    return null;
  };
  await until((m) => m.type === "status" && m.model.state === "ready" && m.game.connected, 60_000);
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000);
  const ask = async (text: string) => {
    const from = got.length;
    ws.send(JSON.stringify({ type: "ask", text }));
    const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
    const slice = got.slice(from);
    return { answer: slice.filter((m) => m.type === "token").map((m: any) => m.text).join(""), tool: slice.find((m) => m.type === "tool") as any, done: done as any };
  };

  // Expectations follow the statuses the machines actually have in-game (placement can leave some unpowered).
  const actual = JSON.parse(statuses) as Record<string, number>;
  const WORDS: Record<string, RegExp> = {
    no_power: /power/i, low_power: /power/i,
    no_ingredients: /iron plate|iron-plate|ingredient|input/i, item_ingredient_shortage: /iron plate|iron-plate|ingredient|input/i,
    full_output: /full|output/i,
  };
  const q1 = await ask("Why aren't my iron gear wheel assemblers making anything?");
  console.log(`      answer: ${q1.answer.trim()} [${(q1.done.totalMs / 1000).toFixed(1)} s]`);
  for (const [status, n] of Object.entries(actual)) {
    if (status === "working" || !WORDS[status]) continue;
    check(`names the real status "${status.replace(/_/g, " ")}" (${n} machines)`, WORDS[status]!.test(q1.answer));
  }

  const q2 = await ask("Show me the stuck iron gear wheel assemblers.");
  const count = Number(q2.tool?.summary?.match(/(\d+) iron-gear-wheel machines not working on (\w+)/)?.[1] ?? 0);
  check("find_stuck_machines highlights at least the 6 scenario machines", count >= 6 && /Highlighted/.test(q2.tool?.summary ?? ""), q2.tool?.summary ?? `no tool call; answer: ${q2.answer.trim()}`);
  answers.why = q1.answer;
  answers.show = q2.answer;
  ws.close();
} finally {
  await dev.sc(`for _, e in pairs(storage.diag or {}) do if e.valid then e.destroy({ raise_destroy = true }) end end storage.diag = nil rcon.print("cleaned")`);
  dev.rcon.close();
}
await saveEvalRun("diagnosis", asChecks(results), answers);
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
