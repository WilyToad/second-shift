-- Machine status for bottleneck diagnosis (PLAN §5 rules 3–4): a registry kept by build/remove
-- events, status polled round-robin with a fixed per-tick budget, and running counts per
-- surface, recipe and status. Cost stays flat as the base grows; only the refresh period grows.
local util = require("scripts.util")
local helmet = require("scripts.helmet")

local TYPES = { "assembling-machine", "furnace", "rocket-silo", "lab", "mining-drill" }
local TYPE_SET = {}
for _, t in ipairs(TYPES) do TYPE_SET[t] = true end
local POLL_PER_TICK = 20
local SCAN_CHUNKS_PER_TICK = 16
local SCAN_ENTITIES_PER_TICK = 100 -- dense chunks hold ~60 machines; this caps a scan tick near 0.3 ms

local STATUS_NAME = {}
for name, value in pairs(defines.entity_status) do STATUS_NAME[value] = name end

local function state()
  storage.machines = storage.machines or {
    entries = {},   -- unit_number -> { entity, surface, recipe, status }
    order = {},     -- unit numbers, for round-robin polling
    index = {},     -- unit_number -> position in order
    cursor = 1,
    counts = {},    -- surface -> recipe -> status -> count
    members_version = 2,
    members = {},   -- surface -> recipe -> chunk key -> { units = {unit = true}, statuses = {status = n} }
    scan = nil,     -- { surfaces = {names}, surface_i, xs, ys, chunk_i } while scanning
    scanned = false,
  }
  local s = storage.machines
  if not s.members or s.members_version ~= 2 then
    -- Saves from before the membership index: build it once from the registry.
    s.members, s.members_version = {}, 2
    s.rebuild_members = true
  end
  return s
end

-- Machines grouped by surface, recipe label and chunk, with status counts per chunk. A lookup
-- visits chunks instead of machines: visibility is one check per chunk and counts come for free.
local function chunk_key(entry)
  return math.floor(entry.x / 32) * 65536 + math.floor(entry.y / 32)
end

local function membership(s, entry, delta)
  if not (entry.recipe and entry.status) then return end
  local by_surface = s.members[entry.surface]
  if not by_surface then by_surface = {}; s.members[entry.surface] = by_surface end
  local by_chunk = by_surface[entry.recipe]
  if not by_chunk then by_chunk = {}; by_surface[entry.recipe] = by_chunk end
  local key = chunk_key(entry)
  local group = by_chunk[key]
  if not group then
    if delta < 0 then return end
    group = { units = {}, statuses = {}, x = entry.x, y = entry.y }
    by_chunk[key] = group
  end
  local n = (group.statuses[entry.status] or 0) + delta
  group.statuses[entry.status] = n > 0 and n or nil
  if delta > 0 then
    group.units[entry.unit] = true
  else
    group.units[entry.unit] = nil
    if next(group.units) == nil then by_chunk[key] = nil end
  end
end

local function bucket(s, surface, recipe)
  local by_surface = s.counts[surface]
  if not by_surface then by_surface = {}; s.counts[surface] = by_surface end
  local by_recipe = by_surface[recipe]
  if not by_recipe then by_recipe = {}; by_surface[recipe] = by_recipe end
  return by_recipe
end

local function count(s, entry, delta)
  if not entry.status then return end
  local b = bucket(s, entry.surface, entry.recipe)
  b[entry.status] = (b[entry.status] or 0) + delta
  if b[entry.status] <= 0 then b[entry.status] = nil end
end

-- What a machine is making, as a label for grouping.
local function recipe_of(entity)
  local t = entity.type
  if t == "lab" then return "(research)" end
  if t == "mining-drill" then
    local target = entity.mining_target
    return "mining " .. (target and target.valid and target.name or "(nothing)")
  end
  local recipe = entity.get_recipe()
  if not recipe and t == "furnace" and entity.previous_recipe then return entity.previous_recipe.name.name or "(none)" end
  return recipe and recipe.name or "(no recipe)"
end

local function add(entity)
  if not (entity and entity.valid and TYPE_SET[entity.type] and entity.unit_number) then return end
  local s = state()
  local unit = entity.unit_number
  if s.entries[unit] then return end
  -- Machines never move, so name and position are kept to answer lookups without API calls.
  local position = entity.position
  s.entries[unit] = { entity = entity, surface = entity.surface.name, unit = unit, name = entity.name, x = position.x, y = position.y }
  s.order[#s.order + 1] = unit
  s.index[unit] = #s.order
  script.register_on_object_destroyed(entity)
end

local function remove(unit)
  local s = state()
  local entry = s.entries[unit]
  if not entry then return end
  count(s, entry, -1)
  membership(s, entry, -1)
  s.entries[unit] = nil
  -- Swap-remove from the polling order.
  local i, last = s.index[unit], #s.order
  local moved = s.order[last]
  s.order[i] = moved
  s.index[moved] = i
  s.order[last] = nil
  s.index[unit] = nil
  if s.cursor > #s.order then s.cursor = 1 end
end

local function poll(entry)
  local entity = entry.entity
  if not entity.valid then return false end
  local recipe = recipe_of(entity)
  local status = STATUS_NAME[entity.status] or "unknown"
  if recipe ~= entry.recipe or status ~= entry.status then
    local s = state()
    count(s, entry, -1)
    membership(s, entry, -1)
    entry.recipe, entry.status = recipe, status
    count(s, entry, 1)
    membership(s, entry, 1)
  end
  return true
end

-- Initial registry for a save that already has machines: a few chunks per tick, never a full sweep.
-- Scan progress lives entirely in storage, including the surface's chunk iterator (a LuaObject, which
-- storage can hold). A local iterator would survive on the host but not on a peer that just loaded the
-- map, and their registries would drift apart (desync). Listing a big surface's chunks up front cost one
-- 6–8 ms tick (FC-104); walking the stored iterator spreads that over the scan.
local function scan_step(s)
  local scan = s.scan
  if scan and scan.xs then scan = nil end -- a scan saved before FC-104: start over with the iterator
  if not scan then
    local names = {}
    for _, surface in pairs(game.surfaces) do names[#names + 1] = surface.name end
    scan = { surfaces = names, surface_i = 0 }
    s.scan = scan
  end
  local done, found = 0, 0
  while done < SCAN_CHUNKS_PER_TICK and found < SCAN_ENTITIES_PER_TICK do
    local surface = scan.surface_i > 0 and game.get_surface(scan.surfaces[scan.surface_i]) or nil
    if not (surface and scan.chunks and scan.chunks.valid) then
      scan.surface_i = scan.surface_i + 1
      local name = scan.surfaces[scan.surface_i]
      if not name then
        s.scan, s.scanned = nil, true
        return
      end
      local next_surface = game.get_surface(name)
      scan.chunks = next_surface and next_surface.get_chunks() or nil
    else
      local chunk = scan.chunks()
      if not chunk then
        scan.chunks = nil
      else
        done = done + 1
        local entities = surface.find_entities_filtered({ area = chunk.area, type = TYPES })
        found = found + #entities
        for _, entity in pairs(entities) do
          -- An entity overlapping two chunks is found twice; add() ignores the repeat.
          add(entity)
        end
      end
    end
  end
end

local function tick()
  local s = state()
  if s.rebuild_members then
    -- One-off for registries saved before the chunk index: forget statuses so polling re-adds them.
    s.rebuild_members = nil
    for unit, entry in pairs(s.entries) do
      entry.unit = unit
      if entry.entity.valid then
        local position = entry.entity.position
        entry.name, entry.x, entry.y = entry.entity.name, position.x, position.y
      end
      count(s, entry, -1)
      entry.recipe, entry.status = nil, nil
    end
  end
  if not s.scanned then scan_step(s) end
  local n = #s.order
  for _ = 1, math.min(POLL_PER_TICK, n) do
    if s.cursor > #s.order then s.cursor = 1 end
    local unit = s.order[s.cursor]
    local entry = s.entries[unit]
    if entry and not poll(entry) then remove(unit) else s.cursor = s.cursor + 1 end
  end
end

local function on_built(e)
  add(e.entity or e.destination)
end

local M = {}

--- Status counts per surface and recipe, with only non-empty buckets.
function M.counts()
  return state().counts
end

function M.progress()
  local s = state()
  return { machines = #s.order, scanned = s.scanned, refresh_ticks = math.max(1, math.ceil(#s.order / POLL_PER_TICK)) }
end

--- Calls fn(group) for each chunk group on a surface, for one recipe label or all of them.
--- A group is { units, statuses = {status = n}, x, y } (x, y: one machine in the chunk).
function M.each_group(surface_name, recipe, fn)
  local by_recipe = state().members[surface_name]
  if not by_recipe then return end
  if recipe then
    for _, group in pairs(by_recipe[recipe] or {}) do fn(group) end
  else
    for _, by_chunk in pairs(by_recipe) do
      for _, group in pairs(by_chunk) do fn(group) end
    end
  end
end

function M.register(handlers)
  -- Event filters take one type per entry (entries are OR'ed).
  local filter = {}
  for _, t in ipairs(TYPES) do filter[#filter + 1] = { filter = "type", type = t } end
  -- The player's own builds are shared with the recent-builds record (player.lua), so no filter; add() checks the type.
  util.on_event(defines.events.on_built_entity, on_built)
  script.on_event(defines.events.on_robot_built_entity, on_built, filter)
  script.on_event(defines.events.on_space_platform_built_entity, on_built, filter)
  script.on_event(defines.events.script_raised_built, on_built, filter)
  script.on_event(defines.events.script_raised_revive, on_built, filter)
  script.on_event(defines.events.on_entity_cloned, on_built, filter)
  script.on_event(defines.events.on_object_destroyed, function(e) if e.useful_id then remove(e.useful_id) end end)
  util.on_nth_tick(1, tick)

  handlers.machine_stats = function()
    return { progress = M.progress(), counts = M.counts() }
  end

  -- Look: registered machines for a recipe label that aren't working, where the player can see them.
  -- Uses the last polled status (at most one refresh period old) instead of asking every machine.
  handlers.find_machines = function(args)
    local player = util.companion_player()
    if not player then util.reject("no_player", "No player is connected.") end
    local surface = args.surface or player.surface.name
    local same_surface = surface == player.surface.name
    local wanted = nil
    if args.statuses and #args.statuses > 0 then
      wanted = {}
      for _, st in ipairs(args.statuses) do wanted[st] = true end
    end
    local refs, by_status, count, not_visible = {}, {}, 0, 0
    local visible_chunk = {}
    local force, player_surface = player.force, player.surface
    local entries = state().entries
    local function counted(status)
      if wanted then return wanted[status] end
      return status ~= "working" and status ~= "normal"
    end
    M.each_group(surface, args.recipe, function(group)
      local matched = 0
      for status, n in pairs(group.statuses) do
        if counted(status) then matched = matched + n end
      end
      if matched == 0 then return end
      -- A chunk group is visible or not as a whole (one recipe's groups share the cache by chunk).
      local visible = true
      if same_surface then
        local key = math.floor(group.x / 32) * 65536 + math.floor(group.y / 32)
        visible = visible_chunk[key]
        if visible == nil then
          visible = helmet.visible(force, player_surface, { x = group.x, y = group.y })
          visible_chunk[key] = visible
        end
      end
      if not visible then
        not_visible = not_visible + matched
        return
      end
      count = count + matched
      for status, n in pairs(group.statuses) do
        if counted(status) then by_status[status] = (by_status[status] or 0) + n end
      end
      if #refs >= 200 then return end
      for unit in pairs(group.units) do
        local entry = entries[unit]
        if entry and counted(entry.status) and entry.entity.valid then
          refs[#refs + 1] = { name = entry.name, x = entry.x, y = entry.y }
          if #refs >= 200 then break end
        end
      end
    end)
    return { surface = surface, recipe = args.recipe, count = count, by_status = by_status, not_visible = not_visible, entities = refs, same_surface = same_surface }
  end

  -- Look (FC-162): what the machines the player asked about have really made. Every machine counts its own finished
  -- crafts, so two reads some seconds apart give the real rate from the player's own game, with no guessing. The
  -- first read starts the clock; the next one reports. Only machines the player can see, and only their own force's.
  -- Capped: reading a machine costs ~5 µs (a position lookup), so 200 keeps one read near a millisecond.
  local MAX_SAMPLE = 200
  local CRAFTING_TYPES = { "assembling-machine", "furnace", "rocket-silo" }
  -- `products_finished` exists only on crafting machines; these run, but the game doesn't count what they make.
  local UNMEASURABLE_TYPES = { "mining-drill", "lab", "agricultural-tower", "offshore-pump" }
  handlers.machine_output = function(args)
    local unmeasurable = nil
    local player = util.companion_player()
    if not player then util.reject("no_player", "No player is connected.") end
    local surface = player.surface
    local found = {}
    if args.entities and #args.entities > 0 then
      for _, ref in pairs(args.entities) do
        if #found >= MAX_SAMPLE then break end
        local e = type(ref) == "table" and ref.name and surface.find_entity(ref.name, { x = ref.x, y = ref.y })
        if e and e.valid then found[#found + 1] = e end
      end
    else
      local radius = math.min(tonumber(args.radius) or 32, 64)
      local at = player.physical_position
      local area = { { at.x - radius, at.y - radius }, { at.x + radius, at.y + radius } }
      found = surface.find_entities_filtered({ area = area, type = CRAFTING_TYPES, force = player.force, limit = MAX_SAMPLE })
      -- Machines the game keeps no craft counter for (FC-222): the player stood among 33 drills and was told "no
      -- drills around you". Counted, not read, so the answer can say what it can't measure and why. On demand only.
      unmeasurable = {}
      for _, t in ipairs(UNMEASURABLE_TYPES) do
        local n = surface.count_entities_filtered({ area = area, type = t, force = player.force })
        if n > 0 then unmeasurable[t] = n end
      end
    end
    local now = game.tick
    local sample, groups, machines, not_visible = {}, {}, 0, 0
    local function crafting(e)
      return e.type == "assembling-machine" or e.type == "furnace" or e.type == "rocket-silo"
    end
    local function recipe_name(e)
      local recipe = e.get_recipe()
      if recipe then return recipe.name end
      return "no recipe set"
    end
    for _, e in pairs(found) do
      if e.valid and crafting(e) and e.force == player.force then
        if not helmet.visible(player.force, e.surface, e.position) then
          not_visible = not_visible + 1
        else
          machines = machines + 1
          local key = recipe_name(e)
          local group = groups[key] or { recipe = key, machines = 0, finished = 0, before = 0, sampled = 0 }
          groups[key] = group
          group.machines = group.machines + 1
          group.finished = group.finished + e.products_finished
          sample[e.unit_number] = e.products_finished
        end
      end
    end
    -- Rates against the last read, for the machines in both reads.
    local previous = not args.restart and (storage.output_samples or {})[player.index] or nil
    local window = previous and now - previous.tick or 0
    if previous and window > 0 then
      for _, e in pairs(found) do
        local was = e.valid and previous.counts[e.unit_number]
        if was and sample[e.unit_number] then
          local group = groups[recipe_name(e)]
          if group then
            group.before = group.before + was
            group.sampled = group.sampled + 1
          end
        end
      end
    end
    storage.output_samples = storage.output_samples or {}
    storage.output_samples[player.index] = { tick = now, counts = sample }
    local out = {}
    for _, g in pairs(groups) do
      local entry = { recipe = g.recipe, machines = g.machines, finished = g.finished, sampled = g.sampled }
      if g.sampled > 0 and window > 0 then entry.per_minute = (g.finished - g.before) * 3600 / window end
      out[#out + 1] = entry
    end
    return { tick = now, window_ticks = window, machines = machines, not_visible = not_visible, unmeasurable = unmeasurable, recipes = out }
  end

  -- Test tooling: forget the registry so the initial scan runs again (its cost can then be profiled).
  handlers.debug_reset_machines = function()
    storage.machines = nil
    return M.progress()
  end

  -- Test tooling: runs one extra tick of scanning/polling so its cost can be profiled over RCON.
  handlers.debug_machine_tick = function()
    tick()
    return M.progress()
  end
end

return M
