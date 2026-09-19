// FC-108 through the real server: blueprint requests are built in code, shown with a copyable string, and can be
// pasted through the approval card. Needs bun run start + the dev save hosted. Pasted ghosts are removed afterwards.
import { decodeBlueprintString, blueprintsIn } from "../server/src/blueprint";
import { openConsole } from "./lib/console";
import { connectDevGame } from "./lib/devgame";

const REQUESTS = [
  { text: "Make me a blueprint for 120 iron gear wheels per minute", item: "iron-gear-wheel" },
  { text: "Can you design a blueprint for 30 automation science packs per minute?", item: "automation-science-pack" },
];

const { ws, got, until, check, results } = await openConsole();
const ask = async (text: string, reset = true) => {
  if (reset) { ws.send(JSON.stringify({ type: "reset" })); await until((m) => m.type === "reset", 5000, got.length); }
  const from = got.length;
  const started = performance.now();
  ws.send(JSON.stringify({ type: "ask", text }));
  await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const slice = got.slice(from);
  return { slice, from, answer: slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim(), seconds: ((performance.now() - started) / 1000).toFixed(1) };
};

for (const [n, req] of REQUESTS.entries()) {
  const r = await ask(req.text);
  const card = r.slice.find((m) => m.type === "blueprint");
  const bp = card?.type === "blueprint" ? card.blueprint : null;
  let entities = 0, label = "";
  try {
    const decoded = blueprintsIn(decodeBlueprintString(bp?.string ?? ""))[0]!.blueprint;
    entities = decoded.entities.length;
    label = decoded.label ?? "";
  } catch {}
  check(`${req.item}: the page gets a blueprint card with a valid string`, bp !== null && entities > 0 && label.startsWith(req.item), `${label}, ${entities} entities; ${bp?.summary}`);
  const machines = /(\d+) (assembling-machine|electromagnetic-plant|foundry)/.exec(bp?.summary ?? "")?.[1];
  // "Two assembling-machine-3s" is the same count as "2": the answer may spell it out.
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const saysCount = !!machines && new RegExp(`\\b(${machines}|${WORDS[Number(machines)] ?? machines})\\b`, "i").test(r.answer);
  check(`${req.item}: the answer explains it without writing a string`, saysCount && !/0eN[A-Za-z0-9+/]{20,}/.test(r.answer), `${r.answer.slice(0, 400)} [${r.seconds} s]`);

  if (n === 0) {
    // Test tooling: stand the player on open ground (the dev save's spot is built up), restored afterwards.
    const dev = await connectDevGame();
await dev.leaveRemoteView();
    const moved = JSON.parse(await dev.sc(`local p = game.connected_players[1] local from = p.position
      local spot = p.surface.find_non_colliding_position("rocket-silo", { from.x + 40, from.y }, 200, 2, true)
      if spot and p.character then p.teleport(spot) end
      rcon.print(helpers.table_to_json({ from = from, to = p.position }))`)) as { from: { x: number; y: number }; to: { x: number; y: number } };
    // Wait for a digest with the new position before asking.
    const since = got.length;
    await until((m) => m.type === "digest" && Math.abs((m.digest.player?.position.x ?? 0) - moved.to.x) < 1, 10_000, since);
    const paste = await ask("Paste that blueprint here", false);
    const approval = paste.slice.find((m) => m.type === "approval");
    check(`${req.item}: pasting it asks for approval first`, approval?.type === "approval", approval?.type === "approval" ? approval.title : paste.answer.slice(0, 200));
    if (approval?.type === "approval") {
      const from = got.length;
      ws.send(JSON.stringify({ type: "approve", id: approval.id }));
      const result = await until((m) => m.type === "approval_result", 30_000, from);
      const placed = result?.type === "approval_result" ? /Placed (\d+) of (\d+) ghosts/.exec(result.message) : null;
      check(`${req.item}: approving places every ghost`, result?.type === "approval_result" && result.status === "done" && placed !== null && placed[1] === String(entities) && placed[2] === String(entities), result?.type === "approval_result" ? result.message : "no result");
      // Test tooling cleanup: remove the ghosts just placed around the player, then put the player back.
      const names = JSON.stringify([...new Set(bp?.sketch.map((e) => e.name) ?? [])]);
      console.log(`  cleanup: ${await dev.sc(`local p = game.connected_players[1] local wanted = {} for _, n in pairs(helpers.json_to_table('${names}')) do wanted[n] = true end local n = 0 for _, g in pairs(p.surface.find_entities_filtered({ type = "entity-ghost", position = p.position, radius = 40, force = p.force })) do if wanted[g.ghost_name] then g.destroy() n = n + 1 end end rcon.print(n .. " ghosts removed")`)}`);
    }
    console.log(`  restore: ${await dev.sc(`local p = game.connected_players[1] if p.character then p.teleport({ ${moved.from.x}, ${moved.from.y} }) end rcon.print("back at " .. p.position.x .. "," .. p.position.y)`)}`);
    dev.rcon.close();
  }
}
ws.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
