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

local TOP_ITEMS = 12
local REFRESH_EVERY_TICKS = 30

-- Alert types worth surfacing. Fetched one type at a time with a filter: an unfiltered
-- get_alerts on a big base returns every alert (measured 1,149 alerts, ~0.6 ms).
local URGENT_ALERTS = {
  "entity_under_attack", "entity_destroyed", "turret_out_of_ammo", "train_no_path",
  "train_out_of_fuel", "not_enough_repair_packs", "collector_path_blocked",
  "unclaimed_cargo", "no_platform_storage", "platform_tile_building_blocked",
}

-- The player the companion rides along with: the first connected player.
local function companion_player()
  return game.connected_players[1]
end

local function top_rates(stats, category, limit)
  local counts = category == "input" and stats.input_counts or stats.output_counts
  local rates = {}
  for name in pairs(counts) do
    local rate = stats.get_flow_count({ name = name, category = category, precision_index = defines.flow_precision_index.one_minute })
    if rate > 0 then rates[#rates + 1] = { name = name, per_minute = rate } end
  end
  table.sort(rates, function(a, b) return a.per_minute > b.per_minute end)
  local out, science = {}, {}
  for i, entry in ipairs(rates) do
    if i <= limit then out[#out + 1] = entry
    elseif entry.name:find("science%-pack$") then science[#science + 1] = entry end
  end
  for _, entry in ipairs(science) do out[#out + 1] = entry end -- science packs always included
  return out
end

-- Production rates are refreshed one (surface, category) at a time so no single tick pays for
-- the whole factory (all surfaces at once measured ~0.5 ms). The cache is derived from game
-- state only, so it's the same on every peer; it isn't saved and rebuilds after load.
local rate_cache = {}
local refresh_queue = {}

local function refresh_step()
  if #refresh_queue == 0 then
    for _, surface in pairs(game.surfaces) do
      refresh_queue[#refresh_queue + 1] = { surface = surface, category = "input" }
      refresh_queue[#refresh_queue + 1] = { surface = surface, category = "output" }
    end
    return
  end
  local job = table.remove(refresh_queue)
  if not job.surface.valid then return end
  local stats = game.forces.player.get_item_production_statistics(job.surface)
  local entry = rate_cache[job.surface.name] or {}
  entry[job.category] = top_rates(stats, job.category, TOP_ITEMS)
  entry.tick = game.tick
  rate_cache[job.surface.name] = entry
end

script.on_nth_tick(REFRESH_EVERY_TICKS, refresh_step)

-- Small summary built from engine aggregates only: no entity scans.
handlers.digest = function()
  local force = game.forces.player
  local player = companion_player()

  local queue = {}
  for _, tech in pairs(force.research_queue or {}) do queue[#queue + 1] = tech.name end

  local surfaces = {}
  for _, surface in pairs(game.surfaces) do
    local cached = rate_cache[surface.name]
    if cached and cached.input and #cached.input > 0 then
      surfaces[#surfaces + 1] = {
        name = surface.name,
        platform = surface.platform and surface.platform.name or nil,
        produced = cached.input,
        consumed = cached.output or {},
        age_ticks = game.tick - cached.tick,
      }
    end
  end

  local alerts = {}
  if player then
    for _, type_name in ipairs(URGENT_ALERTS) do
      for surface_index, by_type in pairs(player.get_alerts({ type = defines.alert_type[type_name] })) do
        local count = 0
        for _, list in pairs(by_type) do count = count + #list end
        if count > 0 then
          local surface = game.get_surface(surface_index)
          alerts[#alerts + 1] = { surface = surface and surface.name, type = type_name, count = count }
        end
      end
    end
  end

  return {
    tick = game.tick,
    player = player and {
      name = player.name,
      surface = player.surface.name,
      position = { x = math.floor(player.position.x), y = math.floor(player.position.y) },
    } or nil,
    research = {
      current = force.current_research and force.current_research.name or nil,
      progress = force.research_progress,
      queue = queue,
    },
    surfaces = surfaces,
    alerts = alerts,
  }
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
  -- {"profile":true} appends a second line with the handler's Lua time (LuaProfiler can't be read as a number).
  local profiler = command.parameter and command.parameter:find('"profile"%s*:%s*true') and helpers.create_profiler() or nil
  local reply = helpers.table_to_json(dispatch(command.parameter))
  rcon.print(reply)
  if profiler then
    profiler.stop()
    rcon.print({ "", "profile ", profiler })
  end
end)
