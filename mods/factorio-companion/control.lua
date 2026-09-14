-- Factorio Companion: queries and player-equivalent actions for the companion app.
-- Everything goes through one RCON command: /companion {"id":..,"action":..,"args":{..}}.
-- The reply is one JSON line via rcon.print: {"id":..,"ok":true,"data":..} or {"id":..,"ok":false,"error":{..}}.

local PROTOCOL = 1

local handlers = {}

handlers.ping = function()
  return { tick = game.tick }
end

handlers.info = function()
  return {
    protocol = PROTOCOL,
    mod_version = script.active_mods["factorio-companion"],
    game_version = script.active_mods["base"],
    tick = game.tick,
    mods = script.active_mods,
    players = #game.connected_players,
  }
end

-- Returns fn(...) or nil if it errors (some prototype properties only exist for certain types).
local function try(fn, ...)
  local ok, value = pcall(fn, ...)
  if ok then return value end
  return nil
end

local function sorted_keys(dict)
  local out = {}
  if dict then
    for key in pairs(dict) do out[#out + 1] = key end
    table.sort(out)
  end
  return out
end

local MACHINE_TYPES = {
  "assembling-machine", "furnace", "rocket-silo", "mining-drill", "lab", "beacon",
  "transport-belt", "underground-belt", "splitter", "inserter",
  "boiler", "generator", "reactor", "agricultural-tower",
}

-- Runtime view of what is actually loaded in this save (modded), for grounding the agent.
handlers.dump_prototypes = function()
  local force = game.forces.player

  local recipes = {}
  for name, r in pairs(prototypes.recipe) do
    if not r.hidden then
      local fr = force.recipes[name]
      recipes[name] = {
        category = r.category,
        energy = r.energy,
        ingredients = r.ingredients,
        products = r.products,
        enabled = fr ~= nil and fr.enabled,
        surface_conditions = r.surface_conditions,
        maximum_productivity = r.maximum_productivity,
      }
    end
  end

  local items = {}
  for name, i in pairs(prototypes.item) do
    if not i.hidden then
      local spoil = try(function() return i.get_spoil_ticks() end) or 0
      items[name] = {
        type = i.type,
        stack_size = i.stack_size,
        fuel_value = i.fuel_value > 0 and i.fuel_value or nil,
        spoil_ticks = spoil > 0 and spoil or nil,
        spoil_result = i.spoil_result and i.spoil_result.name or nil,
        place_result = i.place_result and i.place_result.name or nil,
      }
    end
  end

  local fluids = {}
  for name, f in pairs(prototypes.fluid) do
    if not f.hidden then
      fluids[name] = { fuel_value = f.fuel_value > 0 and f.fuel_value or nil }
    end
  end

  local technologies = {}
  for name, t in pairs(prototypes.technology) do
    if not t.hidden then
      local unlocks = {}
      for _, effect in pairs(t.effects or {}) do
        if effect.type == "unlock-recipe" then unlocks[#unlocks + 1] = effect.recipe end
      end
      local ft = force.technologies[name]
      technologies[name] = {
        prerequisites = sorted_keys(t.prerequisites),
        unlocks = unlocks,
        count = try(function() return t.research_unit_count end),
        count_formula = try(function() return t.research_unit_count_formula end),
        ingredients = try(function() return t.research_unit_ingredients end),
        seconds_per_unit = try(function() return t.research_unit_energy / 60 end),
        trigger = try(function() return t.research_trigger end),
        researched = ft ~= nil and ft.researched,
      }
    end
  end

  local machines = {}
  for name, e in pairs(prototypes.get_entity_filtered({ { filter = "type", type = MACHINE_TYPES } })) do
    if not e.hidden then
      machines[name] = {
        type = e.type,
        size = { e.tile_width, e.tile_height },
        crafting_categories = e.crafting_categories and sorted_keys(e.crafting_categories) or nil,
        crafting_speed = try(function() return e.get_crafting_speed() end),
        module_slots = try(function() return e.module_inventory_size end),
        energy_usage = try(function() return e.energy_usage end),
        mining_speed = try(function() return e.mining_speed end),
        belt_speed = try(function() return e.belt_speed end),
      }
    end
  end

  return { recipes = recipes, items = items, fluids = fluids, technologies = technologies, machines = machines }
end

local function fail(id, code, message)
  return { id = id, ok = false, error = { code = code, message = message } }
end

local function dispatch(parameter)
  local parsed, req = pcall(helpers.json_to_table, parameter or "")
  if not parsed or type(req) ~= "table" then
    return fail(nil, "bad_request", "parameter must be a JSON object")
  end
  local handler = handlers[req.action]
  if not handler then
    return fail(req.id, "unknown_action", tostring(req.action))
  end
  local ok, result = pcall(handler, req.args or {})
  if not ok then
    return fail(req.id, "handler_error", tostring(result))
  end
  return { id = req.id, ok = true, data = result }
end

commands.add_command("companion", "Factorio Companion API (used by the companion app over RCON)", function(command)
  if command.player_index then
    -- Only the app may call the API; a player typing it gets a hint instead.
    local player = game.get_player(command.player_index)
    if player then player.print("/companion is used by the Factorio Companion app.") end
    return
  end
  rcon.print(helpers.table_to_json(dispatch(command.parameter)))
end)
