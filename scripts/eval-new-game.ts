// FC-138: the first hour on a brand-new map, through the running server (bun run start).
// Creates a fresh map with the player's own mods (about 2 s), hosts it, and asks
// the first-hour questions from the S22 walkthrough, checking answers against what the game itself says.
// Usage: bun scripts/eval-new-game.ts [--switch-back]
//   --switch-back  afterwards, host the dev save again and check its conversation comes back (FC-137)
// Close Factorio first. Test setup uses /sc on the eval copy only.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import type { ServerMessage } from "../server/src/messages";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { connectDevGame } from "./lib/devgame";
import { isFactorioRunning, spawnFactorio } from "./lib/factorio";

const args = Bun.argv.slice(2);
const saves = join(import.meta.dir, "../data/saves");
const run = join(saves, "new-game-run.zip");
const repo = join(import.meta.dir, "..");

if (isFactorioRunning()) { console.error("Close Factorio first."); process.exit(1); }
const server = await fetch("http://127.0.0.1:5170/").then((r) => r.ok, () => false);
if (!server) { console.error("Start the server first: bun run start"); process.exit(1); }

const results: [string, boolean, string][] = [];
const answers: Record<string, string> = {};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

// 1. A fresh map every run, created like a new game: freeplay, a random seed, the player's enabled mods.
// A new seed means a new map id, so the server must start a new conversation.
mkdirSync(saves, { recursive: true });
rmSync(run, { force: true });
const t0 = Date.now();
await spawnFactorio(["--create", run], { logPath: join(repo, "data/factorio-create.log") }).exited;
if (!existsSync(run)) { console.error("Map creation failed; see data/factorio-create.log"); process.exit(1); }
console.log(`Created ${run} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// 2. Host it and let the server find it.
const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
let answer = "";
let onDone: (m: ServerMessage) => void = () => {};
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as ServerMessage;
  got.push(m);
  if (m.type === "token") answer += m.text;
  if (m.type === "done" || m.type === "error") onDone(m);
};
await new Promise((r) => (ws.onopen = r));
const lastMap = () => [...got].reverse().find((m): m is Extract<ServerMessage, { type: "digest" }> => m.type === "digest")?.digest.map_id;
const before = lastMap();

const host = Bun.spawn(["bun", "scripts/launch.ts", run, "--dev"], { cwd: repo, stdout: "inherit", stderr: "inherit" });
if ((await host.exited) !== 0) { console.error("Hosting failed."); process.exit(1); }

const game = await connectDevGame();
let nextId = 1;
const call = async <A extends ActionName>(action: A, a: Record<string, unknown> = {}) => {
  const { reply } = parseReply(await game.rcon.exec(encodeCommand({ id: nextId++, action, args: a })));
  if (!reply.ok) throw new Error(`${action}: ${JSON.stringify(reply.error)}`);
  return actions[action].data.parse(reply.data) as any;
};
// The host joins after the map loads; wait for the character, then skip the crash-site cutscene.
for (let i = 0; i < 60; i++) {
  const ready = await game.sc(`local p = game.connected_players[1] rcon.print(p and (p.controller_type == defines.controllers.cutscene and "cutscene" or (p.character and "ready" or "waiting")) or "none")`);
  if (ready === "cutscene") await game.sc(`game.connected_players[1].exit_cutscene() rcon.print("ok")`);
  if (ready === "ready") break;
  await Bun.sleep(1000);
}
const mapId = (await call("map_id")).map_id as string;
for (let i = 0; i < 30 && lastMap() !== mapId; i++) await Bun.sleep(1000);
check("the server switched to the new map", lastMap() === mapId, `${before ?? "none"} → ${mapId}`);
await Bun.sleep(1500); // let the switch's reset reach the page
const switched = got.findLastIndex((m) => m.type === "reset");
check("the new map starts with no conversation from another map", switched >= 0 && !got.slice(switched).some((m) => m.type === "transcript"));

const turns = new URL("../data/eval/turns.jsonl", import.meta.url).pathname;
const lastTurn = async () => JSON.parse((await Bun.file(turns).text()).trim().split("\n").at(-1)!);
const turnsByQuestion: { q: string; text: string; turn: any }[] = [];
const send = async (text: string) => {
  answer = "";
  const done = new Promise<ServerMessage>((r) => (onDone = r));
  ws.send(JSON.stringify({ type: "ask", text }));
  await done;
  answers[answers[text] === undefined ? text : `${text} (${Object.keys(answers).length})`] = answer;
  console.log(`\n> ${text}\n${answer}\n`);
  const turn = await lastTurn();
  turnsByQuestion.push({ q: text, text: answer, turn });
  return { text: answer, turn };
};
// The first time an answer ends by offering something ("Want me to look around?"), reply "yeah": the reply must
// be taken as that offer, so the turn looks or uses the player's data instead of saying it can't (FC-132).
let offerChecked = false;
const ask = async (text: string) => {
  const reply = await send(text);
  // The server takes the last question in the answer as the offer; so does this check.
  const offer = (reply.text.match(/[^.!?\n]*\?/g) ?? []).join(" ");
  if (!offerChecked && /\b(want|should|shall) (me|i)\b[^?]*\b(look|scan|search|check|find)\b/i.test(offer)) {
    offerChecked = true;
    const yes = await send("yeah");
    check("yeah after an offer to look: looked or used the player's data", (yes.turn.chars.player ?? 0) > 0 || yes.turn.rounds.some((r: any) => r.toolCalls > 0), offer.slice(-100));
    check("yeah after an offer to look: doesn't say it can't look", !/\b(can'?t|cannot|unable to) (see|look|check)\b/i.test(yes.text));
  }
  return reply;
};
const norm = (s: string) => s.toLowerCase().replace(/[*_`]/g, "").replace(/-/g, " ");
const mentions = (text: string, names: string[]) => names.filter((n) => norm(text).includes(norm(n)));
const LEAKS = /\b(tool call|no tools?|the data provided|data (you|i was) (gave|given|provided)|without a tool|can'?t see what)\b/i;
// Advice to get a mining tool (none exist in 2.0), or wreckage "scrap" (a Fulgora item). "No pickaxe needed" is fine.
const MEMORY = /\b(craft|make|get|build|use|with) (a |an |your |the )?(stone |iron )?(pick ?axe|axe)\b|\bscrap\b/i;
const RESEARCH = /\bresearch/i;

// Truth for ore claims: every resource the player can see within 128 tiles (the widest search the companion can
// make), taken at the start and the end. Visibility changes as the game runs: the starting area is charted at the
// start and fades to "charted, not visible" later, so something seen early can be gone from a later look.
const visibleOres = async () => {
  const names = JSON.parse(await game.sc(`
    local p = game.connected_players[1] local s = p.physical_surface local names = {} local seen = {}
    for _, e in pairs(s.find_entities_filtered({ position = p.physical_position, radius = 128, type = "resource" })) do
      local key = math.floor(e.position.x / 32) .. ":" .. math.floor(e.position.y / 32)
      if seen[key] == nil then seen[key] = p.force.is_chunk_visible(s, { x = math.floor(e.position.x / 32), y = math.floor(e.position.y / 32) }) end
      if seen[key] then names[e.name] = true end
    end
    local out = {} for n in pairs(names) do out[#out + 1] = n end rcon.print(helpers.table_to_json(out))`));
  return Array.isArray(names) ? (names as string[]) : [];
};
const startOres = await visibleOres();

// 3. The walkthrough.
const status = await call("player_status");
const around = await call("surroundings", { radius: 32, resource_radius: 96 });
const craftNames = (status.craftable as { name: string }[]).map((c) => c.name);
const itemNames = (status.items as { name: string }[]).map((i) => i.name);
const resourceNames = (around.resources as { name: string }[]).map((r) => r.name);
const seenNames = [...resourceNames, ...(around.other as { name: string }[]).map((o) => o.name), ...(around.other.length ? ["wreck"] : []), ...(around.mine as { name: string }[]).map((m) => m.name), ...(around.trees ? ["tree"] : []), ...(around.rocks ? ["rock"] : [])];
console.log(`inventory: ${itemNames.join(", ")}\ncraftable: ${craftNames.join(", ")}\nsurroundings: ${JSON.stringify(around)}`);

const whereAmI = await ask("where am I?");
check("where am I: answers without raising research", !RESEARCH.test(whereAmI.text));

const help = await ask("help me... what do I do?");
check("what do I do: fetched inventory and surroundings", (help.turn.chars.player ?? 0) > 0);
check("what do I do: names something the player has, can craft or can see", mentions(help.text, [...itemNames, ...craftNames, ...seenNames]).length > 0, mentions(help.text, [...itemNames, ...craftNames, ...seenNames]).join(", "));

const craft = await ask("what can I craft right now?");
check("what can I craft: names a recipe the game says is craftable", craftNames.length === 0 ? /nothing|can't craft|no /i.test(craft.text) : mentions(craft.text, craftNames).length > 0, mentions(craft.text, craftNames).join(", "));

// The crash site: mine one wreck the way the player would, then tell the companion about it.
const wreck = await game.sc(`
  local p = game.connected_players[1] local s = p.physical_surface
  local w
  for _, e in pairs(s.find_entities_filtered({ type = "container", force = "neutral", position = p.physical_position, radius = 40 })) do
    local inv = e.get_inventory(defines.inventory.chest)
    if inv and not inv.is_empty() then w = e break end
  end
  if not w then rcon.print("no wreck") return end
  local ok = p.mine_entity(w, true)
  rcon.print(ok and "mined" or "not mined")`);
const afterDebris = await call("player_status");
const debrisItems = (afterDebris.items as { name: string }[]).map((i) => i.name);
const debris = await ask("I just picked up a bunch of debris from a crashed ship!");
check("debris: names what the player now carries", wreck !== "mined" || mentions(debris.text, debrisItems.filter((n) => !itemNames.includes(n))).length > 0, `${wreck}; new items: ${debrisItems.filter((n) => !itemNames.includes(n)).join(", ")}`);

const look = await ask("look around");
check("look around: looked (surroundings fetched or a search)", (look.turn.chars.player ?? 0) > 0 || look.turn.rounds.some((r: any) => r.toolCalls > 0));
check("look around: names something that's really there", mentions(look.text, seenNames).length > 0, mentions(look.text, seenNames).join(", "));
check("look around: doesn't invent enemies", around.enemies > 0 || !/\b\d+ enem/i.test(look.text));

const ore = await ask("I think I found some ore");
check("found ore: names the resources that are really nearby, or says there are none", mentions(ore.text, resourceNames).length > 0 || /\b(no|don'?t see any|can'?t see any|not seeing any)\b[^.]*\bore\b/i.test(ore.text), mentions(ore.text, resourceNames).join(", ") || "none nearby");

// Build a stone furnace from the inventory, the way the player would.
const built = await game.sc(`
  local p = game.connected_players[1] local inv = p.get_main_inventory() local s = p.physical_surface
  local stack = inv.find_item_stack("stone-furnace")
  if not stack then rcon.print("no furnace") return end
  p.clear_cursor() p.cursor_stack.transfer_stack(stack)
  local spot = s.find_non_colliding_position("stone-furnace", { p.physical_position.x + 3, p.physical_position.y + 3 }, 12, 1)
  if spot and p.can_build_from_cursor({ position = spot }) then p.build_from_cursor({ position = spot }) end
  p.clear_cursor()
  rcon.print(#s.find_entities_filtered({ name = "stone-furnace", position = p.physical_position, radius = 20 }) > 0 and "built" or "not built")`);
check("setup: built a stone furnace from the inventory", built === "built", built);
const buildNames = ((await call("player_status")).recent_builds as { name: string }[]).map((b) => b.name);
const justBuilt = await ask("I just built something");
check("I just built something: names the stone furnace", mentions(justBuilt.text, ["stone furnace"]).length > 0);

await ask("what should I build next?");
// No offer came up on its own: ask for one, so the "yeah" path is always exercised through the real model.
if (!offerChecked) await ask("Before you scan for ore, ask me whether I want you to look around.");
if (!offerChecked) check("an answer offered to look, so 'yeah' could be checked", false, "the model didn't offer even when asked to");

const all = Object.entries(answers);
const leaks = all.filter(([, a]) => LEAKS.test(a));
check("no answer talks about tools, tool calls or 'the data provided'", leaks.length === 0, leaks.map(([q]) => q).join(" | "));
const memory = all.filter(([, a]) => MEMORY.test(a));
check("no answer repeats vanilla-memory mistakes (craft a pickaxe or axe, scrap)", memory.length === 0, memory.map(([q]) => q).join(" | "));
// FC-139: details the data contradicts.
// A build the answer says the player made must be in the build record.
const builtClaims = all.flatMap(([q, a]) => [...a.matchAll(/\byou(?:'ve| have)? (?:just )?(?:placed|built|put down|set up) (?!with |for |it |that |this |in |on |to |so |and |there |here )(?:a |an |your |the )?([a-z][a-z0-9 -]{2,40}?)(?= \d| tiles|,|\.|!| to | at | near | next | south| north| east| west| —|$)/gi)].map((m) => ({ q, said: m[1]! })));
const wrongBuilds = builtClaims.filter((c) => !buildNames.some((n) => norm(c.said).includes(norm(n))));
check("named builds match the build record", wrongBuilds.length === 0, wrongBuilds.map((c) => `"${c.said}" in: ${c.q}`).join(" | ") || `${builtClaims.length} claims, record: ${buildNames.join(", ")}`);
// An ore the answer places near the player must be among the resources the player can see (out to 96 tiles).
const ORES = ["iron ore", "copper ore", "coal", "stone", "uranium ore", "crude oil"];
const truthOres = [...new Set([...startOres, ...resourceNames, ...(await visibleOres())])];
const absent = ORES.filter((o) => !truthOres.some((r) => norm(r) === o));
const LOCATES = /\b(\d+ tiles|nearby|near (the|you)|next to|beside|to the (north|south|east|west)|(north|south|east|west)(-(east|west))? of you|patch (is|at|by|near|to))\b/i;
const HEDGES = /\b(no|not|none|isn'?t|find|scout|look for|search|explore|once you|when you|if you|until you)\b/i;
// Clause by clause, so "No iron ore here — the big patch is 82 tiles south-west" isn't excused by its "No".
// "stone" in "stone furnace" or stone from rocks isn't an ore claim.
const clauses = (a: string) => a.split(/(?<=[.!?])\s+|\n+|\s+[—–]\s+|;\s+/).map((c) => norm(c).replace(/\bstone (furnace|wall|brick)s?\b/g, "")).map((c) => (/\brocks?\b/.test(c) ? c.replace(/\bstone\b/g, "") : c));
const oreClaims = all.flatMap(([q, a]) => clauses(a).filter((c) => absent.some((o) => c.includes(o)) && LOCATES.test(c) && !HEDGES.test(c)).map((c) => `${q}: ${c.slice(0, 100)}`));
check("ore claims match what's around", oreClaims.length === 0, oreClaims.join(" | ") || `absent: ${absent.join(", ")}`);
// Ingredient amounts on a turn with the player's data need recipe lines in that turn.
const INGREDIENTS = /\(\s*\d+\s+[a-z][a-z -]+(\s*\+\s*\d+\s+[a-z][a-z -]+)+\s*\)|\bneeds? \d+ [a-z-]+ (plates?|gears?|wheels?|wood|stone)\b/i;
const ungrounded = turnsByQuestion.filter((t) => INGREDIENTS.test(t.text) && (t.turn.chars.player ?? 0) > 0 && !(t.turn.chars.retrieved > 0));
check("ingredient claims come with recipe lines", ungrounded.length === 0, ungrounded.map((t) => t.q).join(" | "));
const leaksHidden = all.filter(([, a]) => /\b(in )?(chunks|areas?|places?) (you|the player) can'?t (currently )?see\b|\bexist in (chunks|areas)\b/i.test(a));
check("no answer reveals what's in chunks the player can't see (helmet rule)", leaksHidden.length === 0, leaksHidden.map(([q]) => q).join(" | "));
const unaskedCards = got.filter((m) => m.type === "approval");
check("no approval cards (nothing was asked for)", unaskedCards.length === 0, unaskedCards.map((m: any) => m.title).join(" | "));

const nags = all.filter(([q, a]) => !RESEARCH.test(q) && /nothing is research|not research|no research/i.test(a));
check("no answer nags about research on a map without labs", nags.length === 0, nags.map(([q]) => q).join(" | "));

// 4. Back to the dev save: its conversation returns (FC-137).
if (args.includes("--switch-back")) {
  game.rcon.close();
  Bun.spawnSync(["pkill", "-TERM", "-f", "factorio.app/Contents/MacOS/factorio"]);
  for (let i = 0; i < 30 && isFactorioRunning(); i++) await Bun.sleep(1000);
  got.length = 0;
  const dev = Bun.spawn(["bun", "scripts/launch.ts", "--dev"], { cwd: repo, stdout: "inherit", stderr: "inherit" });
  await dev.exited;
  for (let i = 0; i < 40 && !got.some((m) => m.type === "transcript" || (m.type === "digest" && m.digest.map_id !== mapId)); i++) await Bun.sleep(1000);
  await Bun.sleep(3000);
  const transcript = got.findLast((m): m is Extract<ServerMessage, { type: "transcript" }> => m.type === "transcript");
  check("back on the dev save: its own conversation comes back", Boolean(transcript?.items.length) && !transcript!.items.some((i) => i.text === "I just built something"), `${transcript?.items.length ?? 0} items`);
} else {
  game.rcon.close();
}

ws.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-new-game", asChecks(results), answers)}`);
process.exit(failed.length ? 1 : 0);
