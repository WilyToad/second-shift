// S22: in-game checks for the player's own situation: map id, inventory, hand crafting, recent builds,
// surroundings and trigger research. Runs against a hosted save copy (bun run launch -- --dev, or the
// new-game eval map). Test setup uses /sc on that copy only.
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { saveEvalRun, asChecks } from "./lib/eval-log";
import { connectDevGame } from "./lib/devgame";

const game = await connectDevGame();
const { rcon, sc } = game;
let nextId = 1;
const call = async (action: string, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await rcon.exec(encodeCommand({ id: nextId++, action, args, profile: true })));
  const data = reply.ok && action in actions ? actions[action as ActionName].data.parse(reply.data) : reply.data;
  return { ...reply, data: data as any, profile };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

await game.leaveRemoteView();

// Map id: made once, the same on every read, and in the digest.
const id1 = await call("map_id");
const id2 = await call("map_id");
const digest = await call("digest");
check("map id exists and is stable", id1.ok && typeof id1.data.map_id === "string" && id1.data.map_id === id2.data.map_id, String(id1.data?.map_id));
check("digest carries the map id", digest.ok && digest.data.map_id === id1.data.map_id);

// Inventory matches what the game says the character carries.
const status = await call("player_status");
check("player_status answers", status.ok && status.data.character === true, status.profile ?? "");
const truth = JSON.parse(await sc(`local p = game.connected_players[1] local t = {} for _, s in pairs(p.get_main_inventory().get_contents()) do t[s.name] = (t[s.name] or 0) + s.count end rcon.print(helpers.table_to_json(t))`)) as Record<string, number>;
const reported = Object.fromEntries((status.data.items as { name: string; count: number }[]).map((i) => [i.name, i.count]));
const top = Object.entries(truth).sort((a, b) => b[1] - a[1]).slice(0, 40);
check("inventory counts match the character's inventory", top.every(([n, c]) => reported[n] === c), `${Object.keys(truth).length} kinds`);

// Hand crafting: every listed recipe is unlocked, hand-craftable by the character, and craftable in that amount.
const craftable = status.data.craftable as { name: string; count: number }[];
const verified = JSON.parse(await sc(`
  local p = game.connected_players[1] local cats = p.character.prototype.crafting_categories local bad = {}
  for _, c in pairs(helpers.json_to_table('${JSON.stringify(craftable)}')) do
    local r = p.force.recipes[c.name]
    if not (r and r.enabled and not r.hidden and cats[r.category] and p.get_craftable_count(r) == c.count) then bad[#bad + 1] = c.name end
  end
  rcon.print(helpers.table_to_json({ bad = bad }))`));
check("craftable list: only unlocked hand recipes, with the right counts", (verified.bad?.length ?? 0) === 0, `${craftable.length} listed${status.data.more_craftable ? " (more)" : ""}; bad: ${JSON.stringify(verified.bad)}`);

// With plates in the inventory: intermediate crafts are listed and the lookup stays cheap (test items removed after).
const GIVE = { "iron-plate": 200, "copper-plate": 200, "stone": 100, "wood": 50 };
await sc(`local inv = game.connected_players[1].get_main_inventory() for name, n in pairs(helpers.json_to_table('${JSON.stringify(GIVE)}')) do inv.insert({ name = name, count = n }) end rcon.print("ok")`);
const stocked = await call("player_status");
await sc(`local inv = game.connected_players[1].get_main_inventory() for name, n in pairs(helpers.json_to_table('${JSON.stringify(GIVE)}')) do inv.remove({ name = name, count = n }) end rcon.print("ok")`);
const ms = Number(/([\d.]+)ms/.exec(stocked.profile ?? "")?.[1] ?? NaN);
const names = (stocked.data.craftable as { name: string }[]).map((c) => c.name);
check("with plates: gears and other intermediates are hand-craftable", stocked.ok && names.includes("iron-gear-wheel"), `${names.length} listed${stocked.data.more_craftable ? " (more)" : ""}: ${names.slice(0, 6).join(", ")}`);
// Measured 1.7–2.3 ms across runs on the dev save; the bound catches a regression to the 6.8 ms full sweep.
check("with plates: the lookup costs under 3 ms", ms < 3, stocked.profile ?? "");

// Recent builds: a build from the player's cursor is recorded; a script-created entity isn't.
const built = JSON.parse(await sc(`
  local p = game.connected_players[1] local s = p.physical_surface
  p.clear_cursor()
  p.cursor_stack.set_stack({ name = "wooden-chest", count = 1 })
  local spot = s.find_non_colliding_position("wooden-chest", { p.physical_position.x + 4, p.physical_position.y }, 10, 1)
  local ok = spot and p.can_build_from_cursor({ position = spot }) or false
  if ok then p.build_from_cursor({ position = spot }) end
  p.cursor_stack.clear()
  -- Building snaps to the tile grid, so look near the spot rather than at it.
  local chest = spot and s.find_entities_filtered({ name = "wooden-chest", position = spot, radius = 1.5, limit = 1 })[1]
  local other_spot = s.find_non_colliding_position("iron-chest", { p.physical_position.x - 6, p.physical_position.y }, 10, 1)
  local scripted = s.create_entity({ name = "iron-chest", position = other_spot, force = p.force })
  rcon.print(helpers.table_to_json({ built = chest ~= nil, x = chest and chest.position.x, y = chest and chest.position.y, scripted = scripted and { x = scripted.position.x, y = scripted.position.y } or nil }))`));
check("setup: built a wooden chest from the cursor", built.built === true, JSON.stringify(built));
const after = await call("player_status");
const newest = after.data.recent_builds[0];
check("the build from the cursor is the newest recent build", newest?.name === "wooden-chest" && newest.x === built.x && newest.y === built.y && newest.still_there === true, JSON.stringify(newest));
check("a script-created entity isn't a player build", !after.data.recent_builds.some((b: any) => b.name === "iron-chest"));

// Surroundings: the chest is listed as built nearby; everything counted is in chunks the player can see.
const around = await call("surroundings", { radius: 32 });
const chest = (around.data.mine as any[]).find((e) => e.name === "wooden-chest");
check("surroundings lists the new chest as built", around.ok && chest?.count >= 1, `${around.profile}; mine ${around.data.mine.length} names, resources ${around.data.resources.length}, trees ${around.data.trees}`);
// No resources within 32 tiles: resources are looked for out to 96, and the cost stays low (FC-139).
const far = await call("surroundings", { radius: 32, resource_radius: 96 });
const farMs = Number(/([\d.]+)ms/.exec(far.profile ?? "")?.[1] ?? NaN);
check("wider resource look costs under 3 ms", far.ok && farMs < 3, `${far.profile}; looked out to ${far.data.resource_radius}, ${far.data.resources.length} resource kinds`);
const wide = await call("surroundings", { radius: 64 });
check("surroundings radius is capped at 64", wide.ok && wide.data.radius === 64, wide.profile ?? "");

// Removing the chest: the record says it's gone.
await sc(`local p = game.connected_players[1] local e = p.physical_surface.find_entity("wooden-chest", { ${built.x ?? 0}, ${built.y ?? 0} }) if e then e.destroy() end ${built.scripted ? `local i = p.physical_surface.find_entity("iron-chest", { ${built.scripted.x}, ${built.scripted.y} }) if i then i.destroy() end` : ""} rcon.print("ok")`);
const gone = await call("player_status");
check("a removed build is marked gone", gone.data.recent_builds[0]?.still_there === false);

// Helmet: without a body there's no inventory or hand crafting to report.
const noBody = JSON.parse(await sc(`local p = game.connected_players[1] storage_test_character = p.character p.set_controller({ type = defines.controllers.god }) rcon.print(helpers.table_to_json({ god = p.character == nil }))`));
const godStatus = await call("player_status");
await sc(`local p = game.connected_players[1] p.set_controller({ type = defines.controllers.character, character = storage_test_character }) storage_test_character = nil rcon.print("ok")`);
const restored = JSON.parse(await sc(`rcon.print(helpers.table_to_json({ ok = game.connected_players[1].character ~= nil }))`));
check("without a character: no inventory or crafting reported", noBody.god && godStatus.ok && godStatus.data.character === false && godStatus.data.craftable.length === 0, `restored character: ${restored.ok}`);

// Direction hints (FC-143): an arrow and marks only this player sees, that expire; refused where the player couldn't look.
const here = JSON.parse(await sc(`local c = game.connected_players[1].character.position rcon.print(helpers.table_to_json({ x = c.x, y = c.y }))`));
const pointed = await call("point_to", { x: here.x + 40, y: here.y - 10, label: "test spot", seconds: 2 });
const drawn = JSON.parse(await sc(`local n, mine = 0, 0 for _, o in pairs(rendering.get_all_objects("second-shift")) do n = n + 1 if o.players and #o.players == 1 and o.time_to_live > 0 then mine = mine + 1 end end rcon.print(helpers.table_to_json({ n = n, mine = mine }))`));
check("point_to draws player-only, expiring marks", pointed.ok && drawn.mine >= 4 && drawn.n === drawn.mine, `${pointed.profile}; ${drawn.mine}/${drawn.n} player-only with a time to live; distance ${pointed.data?.distance}`);
const uncharted = await call("point_to", { x: here.x + 1_000_000, y: here.y });
check("point_to refuses a spot that isn't on the player's map", !uncharted.ok && uncharted.error?.code === "not_charted", uncharted.error?.code ?? "");
const other = await call("point_to", { x: here.x, y: here.y, surface: "some-other-surface" });
check("point_to refuses another surface", !other.ok && other.error?.code === "other_surface", other.error?.code ?? "");
await Bun.sleep(2500);
const expired = JSON.parse(await sc(`rcon.print(#rendering.get_all_objects("second-shift"))`));
check("the marks expire", expired === 0, `${expired} left after 2.5 s`);

// What the player points at (FC-151), what's inside (FC-152), highlights tied to their entities (FC-159). Test chests are
// placed with /sc and removed after.
const placeChest = async (force: string, far = false) => JSON.parse(await sc(`
  local p = game.connected_players[1] local s = p.character.surface
  local at = p.character.position
  ${far ? `at = { x = at.x + 6000, y = at.y } s.request_to_generate_chunks(at, 0) s.force_generate_chunk_requests()` : ""}
  local pos = s.find_non_colliding_position("iron-chest", { x = at.x + 3, y = at.y + 3 }, 20, 1)
  local e = pos and s.create_entity({ name = "iron-chest", position = pos, force = "${force}" })
  if e then e.insert({ name = "iron-plate", count = 50 }) e.insert({ name = "copper-plate", count = 3 }) end
  rcon.print(helpers.table_to_json(e and { name = e.name, x = e.position.x, y = e.position.y, visible = p.force.is_chunk_visible(s, { x = math.floor(e.position.x / 32), y = math.floor(e.position.y / 32) }) } or {}))`));
const testChest = await placeChest("player");
const selectedNow = await call("debug_select_entity", testChest);
const pointedAt = await call("pointed_at");
check("pointed_at reports the entity under the mouse", pointedAt.ok && pointedAt.data.selected?.name === "iron-chest" && pointedAt.data.selected.x === Math.floor(testChest.x), `selected set: ${selectedNow.data?.selected}; ${pointedAt.profile}`);
await call("debug_select_entity", {});
const afterMove = await call("pointed_at");
check("after the mouse moves on, the last hovered entity stays with how long ago", afterMove.ok && !afterMove.data.selected && afterMove.data.last_hovered?.name === "iron-chest" && afterMove.data.last_hovered.still_there === true, JSON.stringify(afterMove.data.last_hovered));
const inside = await call("container_contents", { name: "iron-chest", x: Math.floor(testChest.x), y: Math.floor(testChest.y) });
const got = Object.fromEntries(((inside.data?.items ?? []) as { name: string; count: number }[]).map((i) => [i.name, i.count]));
check("container_contents lists what's inside, from a whole-tile position", inside.ok && got["iron-plate"] === 50 && got["copper-plate"] === 3, `${JSON.stringify(got)}; ${inside.profile}`);
const enemyChest = await placeChest("enemy");
const theirs = await call("container_contents", { name: "iron-chest", x: enemyChest.x, y: enemyChest.y });
check("container_contents refuses another force's chest", !theirs.ok && theirs.error?.code === "not_yours", theirs.error?.code ?? "");
const farChest = await placeChest("player", true);
const unseen = await call("container_contents", { name: "iron-chest", x: farChest.x, y: farChest.y });
check("container_contents refuses a chest the player can't see", farChest.visible === false && !unseen.ok && unseen.error?.code === "not_visible", `${unseen.error?.code ?? "ok"}; visible ${farChest.visible}`);
const nothing = await call("container_contents", { name: "iron-chest", x: testChest.x + 50, y: testChest.y + 50 });
check("container_contents refuses a spot with nothing there", !nothing.ok && nothing.error?.code === "gone", nothing.error?.code ?? "");
await call("highlight", { entities: [testChest], seconds: 60 });
const boxes = Number(await sc(`rcon.print(#rendering.get_all_objects("second-shift"))`));
await game.destroy([testChest]);
await Bun.sleep(200);
const boxesAfter = Number(await sc(`rcon.print(#rendering.get_all_objects("second-shift"))`));
check("a highlight box goes when its entity is removed", boxes === 1 && boxesAfter === 0, `${boxes} before, ${boxesAfter} after`);
await game.destroy([enemyChest, farChest].filter((c) => c.name));

// FC-165: what the player can reach — carried plus the containers they can see — against the game's own counts.
const stockChest = JSON.parse(await sc(`local p = game.connected_players[1] local s = p.physical_surface local at = p.physical_position
  local pos = s.find_non_colliding_position("iron-chest", { x = at.x - 4, y = at.y + 4 }, 20, 1)
  local e = pos and s.create_entity({ name = "iron-chest", position = pos, force = p.force })
  if e then e.insert({ name = "iron-plate", count = 123 }) end
  rcon.print(helpers.table_to_json(e and { name = e.name, x = e.position.x, y = e.position.y } or {}))`));
const stock = await call("stock", { radius: 48 });
const stockTruth = JSON.parse(await sc(`local p = game.connected_players[1] local s = p.physical_surface local at = p.physical_position
  local r, totals, containers = 48, {}, 0
  local inv = p.get_main_inventory()
  for _, stack in pairs(inv.get_contents()) do totals[stack.name] = (totals[stack.name] or 0) + stack.count end
  for _, e in pairs(s.find_entities_filtered({ type = { "container", "logistic-container", "linked-container", "cargo-wagon", "car", "spider-vehicle" }, force = p.force, area = { { at.x - r, at.y - r }, { at.x + r, at.y + r } } })) do
    if p.force.is_chunk_visible(s, { x = math.floor(e.position.x / 32), y = math.floor(e.position.y / 32) }) then
      containers = containers + 1
      for i = 1, e.get_max_inventory_index() do
        local einv = e.get_inventory(i)
        if einv then for _, stack in pairs(einv.get_contents()) do totals[stack.name] = (totals[stack.name] or 0) + stack.count end end
      end
    end
  end
  rcon.print(helpers.table_to_json({ totals = totals, containers = containers, free = inv.count_empty_stacks() }))`));
const inStock = Object.fromEntries((stock.data.items as any[]).map((i) => [i.name, i.count])) as Record<string, number>;
const topTruth = Object.entries(stockTruth.totals as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 20);
// The base is running, so a chest's contents can change between the two reads: allow 2% drift on the totals and
// hold the test chest (which nothing else touches) to the exact number.
check("stock matches the game's own counts for what the player can reach", stock.ok
  && topTruth.every(([name, count]) => inStock[name] === undefined || Math.abs(inStock[name]! - count) <= Math.max(2, count * 0.02))
  && (inStock["iron-plate"] ?? 0) >= 123
  && Math.abs((stock.data?.containers ?? 0) - stockTruth.containers) <= 2,
  `${stock.data?.total_kinds} kinds from ${stock.data?.containers} containers (game says ${stockTruth.containers}), ${stock.data?.free_slots} free slots (game says ${stockTruth.free}); ${stock.profile}`);
check("reading stock costs under 3 ms", parseFloat(stock.profile ?? "99") < 3, stock.profile ?? "");
const stockNear = await call("stock", { radius: 8 });
check("a smaller radius reads fewer containers", stockNear.ok && stockNear.data.containers <= stock.data.containers, `${stockNear.data?.containers} within 8 tiles vs ${stock.data?.containers} within 48`);
if (stockChest.name) await game.destroy([stockChest]);

// Trigger research: listed techs aren't researched and their prerequisites are.
const research = await call("research_options");
const triggers = research.data.triggers as { name: string; trigger: string }[];
const triggerTruth = JSON.parse(await sc(`
  local f = game.connected_players[1].force local bad = {}
  for _, t in pairs(helpers.json_to_table('${JSON.stringify(triggers)}')) do
    local tech = f.technologies[t.name]
    local ready = tech and not tech.researched and tech.prototype.research_trigger ~= nil
    if ready then for _, pre in pairs(tech.prerequisites) do if not pre.researched then ready = false end end end
    if not ready then bad[#bad + 1] = t.name end
  end
  rcon.print(helpers.table_to_json({ bad = bad }))`));
check("trigger technologies are ready and unresearched", research.ok && (triggerTruth.bad?.length ?? 0) === 0, `${triggers.length} listed: ${triggers.slice(0, 3).map((t) => `${t.name} (${t.trigger})`).join(", ")}`);

rcon.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("test-player", asChecks(results), {})}`);
process.exit(failed.length ? 1 : 0);
