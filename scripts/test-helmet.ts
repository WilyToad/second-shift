// FC-029: in-game checks that actions do what a player could do, and refuse what they couldn't.
// Runs against the hosted dev save (bun run launch -- --dev). Test setup uses /sc on that copy only.
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { readRconSettings } from "../server/src/factorio";
import { RconClient } from "../server/src/rcon";

const rcon = await RconClient.connect({ ...(await readRconSettings())!, timeoutMs: 30_000 });
let nextId = 1;
const call = async (action: string, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await rcon.exec(encodeCommand({ id: nextId++, action, args, profile: true })));
  // Parse known actions through their schemas so Lua's {} for empty arrays is normalized.
  const data = reply.ok && action in actions ? actions[action as ActionName].data.parse(reply.data) : reply.data;
  return { ...reply, data, profile };
};
// First /sc on a save only answers the achievement prompt and returns nothing.
const sc = async (lua: string) => { const a = (await rcon.exec(`/sc ${lua}`)).trim(); return a || (await rcon.exec(`/sc ${lua}`)).trim(); };
// Placement below is "near the player": leave map view so that means the character (FC-092).
await sc(`local p = game.connected_players[1] if p.controller_type == defines.controllers.remote then p.exit_remote_view() end rcon.print("ok")`);

const RAILS = ["straight-rail", "curved-rail-a", "curved-rail-b", "half-diagonal-rail", "legacy-straight-rail", "legacy-curved-rail", "elevated-straight-rail", "elevated-curved-rail-a", "elevated-curved-rail-b", "elevated-half-diagonal-rail", "rail-ramp"];
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

// Setup: up to 8 straight rails east of the player where they fit, plus one in a far, unseen chunk.
const setup = JSON.parse(await sc(`
  local p = game.connected_players[1]; local s = p.surface; local placed = {}
  for dx = 4, 40, 2 do for dy = -8, 8, 2 do
    if #placed < 8 then
      local pos = { x = math.floor(p.position.x / 2) * 2 + dx + 1, y = math.floor(p.position.y / 2) * 2 + dy + 1 }
      if s.can_place_entity({ name = "straight-rail", position = pos, force = p.force }) then
        local e = s.create_entity({ name = "straight-rail", position = pos, force = p.force })
        if e then placed[#placed + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
      end
    end
  end end
  local far = { x = math.floor(p.position.x / 2) * 2 + 3001, y = math.floor(p.position.y / 2) * 2 + 1 }
  s.request_to_generate_chunks(far, 0); s.force_generate_chunk_requests()
  local fe = s.can_place_entity({ name = "straight-rail", position = far, force = p.force }) and s.create_entity({ name = "straight-rail", position = far, force = p.force })
  rcon.print(helpers.table_to_json({ placed = placed, far = fe and { name = fe.name, x = fe.position.x, y = fe.position.y } or nil,
    far_visible = p.force.is_chunk_visible(s, { x = math.floor(far.x / 32), y = math.floor(far.y / 32) }), player = { x = p.position.x, y = p.position.y } }))
`));
const placed: { name: string; x: number; y: number }[] = Array.isArray(setup.placed) ? setup.placed : [];
check("setup placed test rails east of the player", placed.length > 0, `${placed.length} rails, far rail ${setup.far ? "placed" : "not placed"}, far chunk visible=${setup.far_visible}`);

try {
  const right = await call("find_entities", { types: RAILS, direction: "right", radius: 48 });
  const d = right.data as any;
  const foundAll = placed.every((r) => d.entities.some((e: any) => e.x === r.x && e.y === r.y));
  check("find right: finds every test rail", right.ok && foundAll, `count ${d?.count}, ${right.profile}`);
  check("find right: area is east of the player", right.ok && d.area.left_top.x === setup.player.x && d.radius === 48);

  const left = await call("find_entities", { types: RAILS, direction: "left", radius: 48 });
  check("find left: excludes the test rails", left.ok && placed.every((r) => !(left.data as any).entities.some((e: any) => e.x === r.x && e.y === r.y)));

  const hl = await call("highlight", { entities: placed, seconds: 10 });
  check("highlight draws one box per rail", hl.ok && (hl.data as any).drawn === placed.length, `${hl.profile}`);

  const undoBefore = await sc(`local st = game.connected_players[1].undo_redo_stack rcon.print(helpers.table_to_json({ n = st.get_undo_item_count(), top = st.get_undo_item_count() > 0 and st.get_undo_item(1) or {} }))`);
  const mark = await call("mark_deconstruction", { entities: placed });
  check("mark: marks every test rail", mark.ok && (mark.data as any).done === placed.length, `${JSON.stringify(mark.data)}, ${mark.profile}`);
  const marked = JSON.parse(await sc(`local p = game.connected_players[1] local n = 0 for _, r in pairs(helpers.json_to_table('${JSON.stringify(placed)}')) do local e = p.surface.find_entity(r.name, r) if e and e.to_be_deconstructed() then n = n + 1 end end rcon.print(n)`));
  check("mark: rails really are marked in the game", marked === placed.length, `${marked}/${placed.length}`);
  const undoAfter = await sc(`local st = game.connected_players[1].undo_redo_stack rcon.print(helpers.table_to_json({ n = st.get_undo_item_count(), top = st.get_undo_item(1) }))`);
  const top = JSON.parse(undoAfter).top;
  check("mark: one new undo item on the player's stack holds the action", undoAfter !== undoBefore && Array.isArray(top) && top.length === placed.length, `top item has ${Array.isArray(top) ? top.length : "?"} actions, first: ${JSON.stringify(top?.[0]).slice(0, 120)}`);

  const again = await call("mark_deconstruction", { entities: placed });
  check("mark again: refused as already marked", again.ok && (again.data as any).done === 0 && (again.data as any).rejected.already_marked === placed.length);

  const cancel = await call("cancel_deconstruction", { entities: placed });
  check("cancel: unmarks every test rail", cancel.ok && (cancel.data as any).done === placed.length, JSON.stringify(cancel.data));

  const character = await call("mark_deconstruction", { entities: [{ name: "character", x: setup.player.x, y: setup.player.y }] });
  check("refuses the player's character", character.ok && (character.data as any).done === 0 && (character.data as any).rejected.not_deconstructable === 1, JSON.stringify(character.data));

  if (setup.far && !setup.far_visible) {
    const far = await call("mark_deconstruction", { entities: [setup.far] });
    check("refuses an entity in a chunk the player can't see", far.ok && (far.data as any).done === 0 && (far.data as any).rejected.not_visible === 1, JSON.stringify(far.data));
  } else {
    check("refuses an entity in a chunk the player can't see", false, "setup couldn't create an unseen test rail");
  }

  const bogus = await call("destroy_entities", { entities: placed });
  check("no instant-delete action exists", !bogus.ok && bogus.error?.code === "unknown_action");

  await call("clear_highlight");
} finally {
  await sc(`local p = game.connected_players[1] for _, r in pairs(helpers.json_to_table('${JSON.stringify([...placed, ...(setup.far ? [setup.far] : [])])}')) do local e = p.surface.find_entity(r.name, r) if e then e.destroy() end end rcon.print("cleaned")`);
  rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
