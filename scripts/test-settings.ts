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
const extraCleanup: Ref[] = [];

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
  // --- FC-109: train stop settings
  const stopsRaw = await sc(`
    local p = game.connected_players[1] local s = p.surface local f = p.force local out = {}
    local function stop_at(dx, dy, force)
      local pos = s.find_non_colliding_position("train-stop", { p.position.x + dx, p.position.y + dy }, 40, 2, true)
      local e = pos and s.create_entity({ name = "train-stop", position = pos, force = force, direction = defines.direction.north })
      return e and { name = e.name, x = e.position.x, y = e.position.y } or nil
    end
    out.mine = stop_at(-12, 8, f)
    out.circuit = stop_at(-12, 14, f)
    out.neutral = stop_at(-12, 20, "neutral")
    if out.circuit then
      local e = s.find_entity("train-stop", out.circuit)
      local cb = e.get_or_create_control_behavior() cb.set_trains_limit = true cb.set_priority = true
    end
    local far = { x = p.position.x + 3001, y = p.position.y }
    s.request_to_generate_chunks(far, 0) s.force_generate_chunk_requests()
    local fp = s.find_non_colliding_position("train-stop", far, 40, 2, true)
    local fe = fp and s.create_entity({ name = "train-stop", position = fp, force = f })
    out.far = fe and { name = fe.name, x = fe.position.x, y = fe.position.y } or nil
    out.far_visible = fe and f.is_chunk_visible(s, { x = math.floor(fe.position.x / 32), y = math.floor(fe.position.y / 32) }) or false
    rcon.print(helpers.table_to_json(out))`);
  const stops = JSON.parse(stopsRaw) as { mine?: Ref; circuit?: Ref; neutral?: Ref; far?: Ref; far_visible: boolean };
  extraCleanup.push(...[stops.mine, stops.circuit, stops.neutral, stops.far].filter((r): r is Ref => !!r));
  check("setup: train stops placed", !!(stops.mine && stops.circuit && stops.neutral), stopsRaw.slice(0, 200));
  const stopState = async (r: Ref) => JSON.parse(await sc(`local e = game.connected_players[1].surface.find_entity("train-stop", { ${r.x}, ${r.y} }) rcon.print(helpers.table_to_json({ limit = e.trains_limit, priority = e.train_stop_priority, name = e.backer_name }))`));
  const setStop = await call("set_train_stop", { entities: [stops.mine], limit: 2, priority: 80, name: "Companion Test Stop" });
  const state = await stopState(stops.mine!);
  check("sets a train stop's limit, priority and name", setStop.ok && setStop.data.done === 1 && state.limit === 2 && state.priority === 80 && state.name === "Companion Test Stop", `${JSON.stringify(setStop.data)}; ${JSON.stringify(state)}; ${setStop.profile}`);
  const noLimit = await call("set_train_stop", { entities: [stops.mine], limit: -1 });
  const cleared = await stopState(stops.mine!);
  check("-1 turns the train limit off", noLimit.ok && noLimit.data.done === 1 && cleared.limit > 1_000_000, JSON.stringify(cleared));
  const circuit = await call("set_train_stop", { entities: [stops.circuit], limit: 3, priority: 10 });
  check("refuses a limit or priority a circuit signal sets", circuit.ok && circuit.data.done === 0 && circuit.data.rejected.limit_set_by_circuit === 1, JSON.stringify(circuit.data?.rejected));
  const circuitName = await call("set_train_stop", { entities: [stops.circuit], name: "Renamed" });
  check("still renames a circuit-controlled stop (the window allows it)", circuitName.ok && circuitName.data.done === 1, JSON.stringify(circuitName.data));
  const neutralStop = await call("set_train_stop", { entities: [stops.neutral], limit: 1 });
  check("refuses a train stop that isn't the player's", neutralStop.ok && neutralStop.data.rejected.not_yours === 1, JSON.stringify(neutralStop.data?.rejected));
  const notStop = await call("set_train_stop", { entities: [setup.mine[0]], limit: 1 });
  check("refuses something that isn't a train stop", notStop.ok && notStop.data.rejected.not_a_train_stop === 1, JSON.stringify(notStop.data?.rejected));
  if (stops.far && !stops.far_visible) {
    const farStop = await call("set_train_stop", { entities: [stops.far], limit: 1 });
    check("refuses a train stop the player can't see", farStop.ok && farStop.data.rejected.not_visible === 1, JSON.stringify(farStop.data?.rejected));
  } else check("refuses a train stop the player can't see", false, "couldn't place an unseen stop");
  const badArgs = await call("set_train_stop", { entities: [stops.mine], priority: 300 });
  check("refuses a priority outside 0-255", !badArgs.ok && badArgs.error?.code === "bad_args", badArgs.error?.code ?? "");
} finally {
  await sc(`
    local p = game.connected_players[1] local s = p.surface
    for _, r in pairs(helpers.json_to_table([=[${JSON.stringify([...setup.mine, setup.furnace, setup.neutral, ...(setup.far ? [setup.far] : []), ...extraCleanup])}]=])) do local e = s.find_entity(r.name, r) if e then e.destroy() end end
    for _, item in pairs(s.find_entities_filtered({ type = "item-entity", position = p.position, radius = 60 })) do if item.stack.name == "iron-plate" then item.destroy() end end
    local extra = p.get_item_count("iron-plate") - ${setup.plates}
    if extra > 0 then p.remove_item({ name = "iron-plate", count = extra }) end
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
