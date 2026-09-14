-- Small, frequently polled summary built from engine aggregates only: no entity scans.
local util = require("scripts.util")
local companion_player = util.companion_player

return function(handlers)
  local TOP_ITEMS = 12
  local REFRESH_EVERY_TICKS = 30

  -- Alert types worth surfacing. Fetched one type at a time with a filter: an unfiltered
  -- get_alerts on a big base returns every alert (measured 1,149 alerts, ~0.6 ms).
  local URGENT_ALERTS = {
    "entity_under_attack", "entity_destroyed", "turret_out_of_ammo", "train_no_path",
    "train_out_of_fuel", "not_enough_repair_packs", "collector_path_blocked",
    "unclaimed_cargo", "no_platform_storage", "platform_tile_building_blocked",
  }

  local function top_rates(stats, category, limit)
    local counts = category == "input" and stats.input_counts or stats.output_counts
    local rates = {}
    for name in pairs(counts) do
      local rate = stats.get_flow_count({ name = name, category = category, precision_index = defines.flow_precision_index.one_minute })
      if rate > 0 then rates[#rates + 1] = { name = name, per_minute = rate } end
    end
    table.sort(rates, function(a, b) return a.per_minute > b.per_minute end)
    local out = {}
    for i = 1, math.min(limit, #rates) do out[i] = rates[i] end
    return out
  end

  -- Every science pack this surface has ever produced, with the current and 10-hour rates, so a
  -- stall (0 now, >0 over 10 h) is visible. Science is listed separately from the top items.
  local function science_rates(stats)
    local out = {}
    for name in pairs(stats.input_counts) do
      if name:find("science%-pack$") then
        out[#out + 1] = {
          name = name,
          per_minute = stats.get_flow_count({ name = name, category = "input", precision_index = defines.flow_precision_index.one_minute }),
          per_minute_10h = stats.get_flow_count({ name = name, category = "input", precision_index = defines.flow_precision_index.ten_hours }),
        }
      end
    end
    table.sort(out, function(a, b) return a.name < b.name end)
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
    if job.category == "input" then entry.science = science_rates(stats) end
    entry.tick = game.tick
    rate_cache[job.surface.name] = entry
  end

  script.on_nth_tick(REFRESH_EVERY_TICKS, refresh_step)

  handlers.digest = function()
    local force = game.forces.player
    local player = companion_player()

    local queue = {}
    for _, tech in pairs(force.research_queue or {}) do queue[#queue + 1] = tech.name end

    local surfaces = {}
    for _, surface in pairs(game.surfaces) do
      local cached = rate_cache[surface.name]
      if cached and cached.input and (#cached.input > 0 or #(cached.science or {}) > 0) then
        surfaces[#surfaces + 1] = {
          name = surface.name,
          platform = surface.platform and surface.platform.name or nil,
          produced = cached.input,
          consumed = cached.output or {},
          science = cached.science or {},
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
end
