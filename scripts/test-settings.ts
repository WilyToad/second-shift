// FC-093: in-game helmet tests for set_recipe on the hosted dev save. Setup and cleanup use /sc (test tooling).
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";

type Ref = { name: string; x: number; y: number };
const dev = await connectDevGame();
await dev.leaveRemoteView();
let id = 1;
const call = async (action: ActionName, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile: true })));
  return { ...reply, data: reply.ok ? actions[action].data.parse(reply.data) as any : undefined, profile };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sc = dev.sc;

// Recipes to try: an enabled one an assembling-machine-2 can't craft, a locked one, a hidden one.
const picks = JSON.parse(await sc(`
  local f = game.forces.player local am = prototypes.entity["assembling-machine-2"].crafting_categories local out = {}
  for name, r in pairs(f.recipes) do
    if r.enabled and not r.hidden and not am[r.category] and not out.wrong then out.wrong = name end
    if not r.enabled and not r.hidden and am[r.category] and not out.locked then out.locked = name end
    if r.hidden and not out.hidden then out.hidden = name end
  end
  rcon.print(helpers.table_to_json(out))`)) as { wrong: string; locked: string; hidden: string };

// Two player assemblers making gears (one holding 20 iron plates), a stone furnace, a neutral assembler,
// all near the player; and a player assembler far away in chunks the force can't see.
const setupRaw = await sc(`
  local p = game.connected_players[1] local s = p.surface local f = p.force local out = { mine = {} }
  local function spot(name, dy)
    return s.find_non_colliding_position(name, { p.position.x + 16, p.position.y + dy }, 60, 1, true)
  end
  local function ref(e) return { name = e.name, x = e.position.x, y = e.position.y } end
  -- Machine 1 right next to the character (in reach) holding 20 plates; machine 2 out of reach holding 10.
  local c = p.character
  for i = 1, 2 do
    local pos = i == 1 and s.find_non_colliding_position("assembling-machine-2", { c.position.x + 3, c.position.y }, 6, 0.5, true) or spot("assembling-machine-2", 40)
    local e = s.create_entity({ name = "assembling-machine-2", position = pos, force = f })
    e.set_recipe("iron-gear-wheel")
    out.mine[#out.mine + 1] = ref(e)
    e.insert({ name = "iron-plate", count = i == 1 and 20 or 10 })
    out["reach" .. i] = c.can_reach_entity(e)
  end
  out.furnace = ref(s.create_entity({ name = "stone-furnace", position = spot("stone-furnace", 26), force = f }))
  out.neutral = ref(s.create_entity({ name = "assembling-machine-2", position = spot("assembling-machine-2", 30), force = "neutral" }))
  local far = { x = p.position.x + 3000, y = p.position.y + 3000 }
  s.request_to_generate_chunks(far, 0) s.force_generate_chunk_requests()
  local fe = s.create_entity({ name = "assembling-machine-2", position = s.find_non_colliding_position("assembling-machine-2", far, 20, 1) or far, force = f })
  out.far = fe and ref(fe) or nil
  out.plates = p.get_item_count("iron-plate")
  rcon.print(helpers.table_to_json(out))`);
if (!setupRaw.startsWith("{")) throw new Error(`setup failed: ${setupRaw}`);
const setup = JSON.parse(setupRaw) as { mine: Ref[]; furnace: Ref; neutral: Ref; far?: Ref; plates: number; reach1: boolean; reach2: boolean };

const recipeOf = async (refs: Ref[]) => JSON.parse(await sc(`local s = game.connected_players[1].surface local out = {} for _, r in pairs(helpers.json_to_table([=[${JSON.stringify(refs)}]=])) do local e = s.find_entity(r.name, r) out[#out + 1] = e and e.get_recipe() and e.get_recipe().name or "none" end rcon.print(helpers.table_to_json(out))`)) as string[];

try {
  const ok = await call("set_recipe", { entities: setup.mine, recipe: "copper-cable" });
  const now = await recipeOf(setup.mine);
  const plates = Number(await sc(`rcon.print(game.connected_players[1].get_item_count("iron-plate"))`));
  const ground = JSON.parse(await sc(`local s = game.connected_players[1].surface local n, marked = 0, 0
    for _, i in pairs(s.find_entities_filtered({ type = "item-entity", position = { ${setup.mine[1]!.x}, ${setup.mine[1]!.y} }, radius = 5 })) do
      if i.stack.name == "iron-plate" then n = n + i.stack.count if i.to_be_deconstructed() then marked = marked + i.stack.count end end
    end
    rcon.print(helpers.table_to_json({ n = n, marked = marked }))`)) as { n: number; marked: number };
  check("sets the recipe on the player's assemblers", ok.ok && ok.data.done === 2 && now.every((r) => r === "copper-cable"), `${JSON.stringify(ok.data)}; ${now.join(", ")}; ${ok.profile}`);
  check("leftovers from the machine in reach go to the character's inventory", setup.reach1 && ok.ok && ok.data.to_inventory === 20 && plates - setup.plates === 20, `in reach ${setup.reach1}; to inventory ${ok.data?.to_inventory}, player plates +${plates - setup.plates}`);
  check("leftovers out of reach spill next to their machine, marked for robots", !setup.reach2 && ok.ok && ok.data.spilled === 10 && ground.n === 10 && ground.marked === 10, `in reach ${setup.reach2}; spilled ${ok.data?.spilled}, on the ground ${ground.n}, marked ${ground.marked}`);

  const same = await call("set_recipe", { entities: setup.mine, recipe: "copper-cable" });
  check("refuses a machine that already has that recipe", same.ok && same.data.done === 0 && same.data.rejected.same_recipe === 2, JSON.stringify(same.data?.rejected));
  const wrong = await call("set_recipe", { entities: setup.mine, recipe: picks.wrong });
  check("refuses a recipe the machine can't craft", wrong.ok && wrong.data.done === 0 && wrong.data.rejected.wrong_category === 2, `${picks.wrong}: ${JSON.stringify(wrong.data?.rejected)}`);
  const locked = await call("set_recipe", { entities: setup.mine, recipe: picks.locked });
  check("refuses a recipe that isn't unlocked", !locked.ok && locked.error?.code === "not_unlocked", `${picks.locked}: ${locked.error?.code}`);
  const hidden = await call("set_recipe", { entities: setup.mine, recipe: picks.hidden });
  check("refuses a hidden recipe", !hidden.ok && hidden.error?.code === "hidden_recipe", `${picks.hidden}: ${hidden.error?.code}`);
  const unknown = await call("set_recipe", { entities: setup.mine, recipe: "quantum-widget" });
  check("refuses an unknown recipe", !unknown.ok && unknown.error?.code === "unknown_recipe");
  const furnace = await call("set_recipe", { entities: [setup.furnace], recipe: "iron-gear-wheel" });
  check("refuses a furnace (it picks its recipe from its input)", furnace.ok && furnace.data.rejected.not_an_assembler === 1, JSON.stringify(furnace.data?.rejected));
  const neutral = await call("set_recipe", { entities: [setup.neutral], recipe: "iron-gear-wheel" });
  check("refuses a machine that isn't the player's", neutral.ok && neutral.data.rejected.not_yours === 1, JSON.stringify(neutral.data?.rejected));
  if (setup.far) {
    const far = await call("set_recipe", { entities: [setup.far], recipe: "iron-gear-wheel" });
    check("refuses a machine the player can't see", far.ok && far.data.rejected.not_visible === 1, JSON.stringify(far.data?.rejected));
  } else check("refuses a machine the player can't see", false, "couldn't place the far machine");
  const gone = await call("set_recipe", { entities: [{ name: "assembling-machine-2", x: setup.mine[0]!.x + 0.25, y: setup.mine[0]!.y + 777 }], recipe: "iron-gear-wheel" });
  check("refuses a reference to nothing", gone.ok && gone.data.rejected.gone === 1, JSON.stringify(gone.data?.rejected));
} finally {
  await sc(`
    local p = game.connected_players[1] local s = p.surface
    for _, r in pairs(helpers.json_to_table([=[${JSON.stringify([...setup.mine, setup.furnace, setup.neutral, ...(setup.far ? [setup.far] : [])])}]=])) do local e = s.find_entity(r.name, r) if e then e.destroy() end end
    for _, item in pairs(s.find_entities_filtered({ type = "item-entity", position = p.position, radius = 60 })) do if item.stack.name == "iron-plate" then item.destroy() end end
    local extra = p.get_item_count("iron-plate") - ${setup.plates}
    if extra > 0 then p.remove_item({ name = "iron-plate", count = extra }) end
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
