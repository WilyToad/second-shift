-- Machine status for bottleneck diagnosis (PLAN §5 rules 3–4): a registry kept by build/remove
-- events, status polled round-robin with a fixed per-tick budget, and running counts per
-- surface, recipe and status. Cost stays flat as the base grows; only the refresh period grows.
local util = require("scripts.util")

local TYPES = { "assembling-machine", "furnace", "rocket-silo", "lab", "mining-drill" }
local TYPE_SET = {}
for _, t in ipairs(TYPES) do TYPE_SET[t] = true end
local POLL_PER_TICK = 20
local SCAN_CHUNKS_PER_TICK = 16

local STATUS_NAME = {}
for name, value in pairs(defines.entity_status) do STATUS_NAME[value] = name end

local function state()
  storage.machines = storage.machines or {
    entries = {},   -- unit_number -> { entity, surface, recipe, status }
    order = {},     -- unit numbers, for round-robin polling
    index = {},     -- unit_number -> position in order
    cursor = 1,
    counts = {},    -- surface -> recipe -> status -> count
    scan = nil,     -- { surfaces = {names}, surface_i, chunks = {positions}, chunk_i } while scanning
    scanned = false,
  }
  return storage.machines
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
  s.entries[unit] = { entity = entity, surface = entity.surface.name }
  s.order[#s.order + 1] = unit
  s.index[unit] = #s.order
  script.register_on_object_destroyed(entity)
end

local function remove(unit)
  local s = state()
  local entry = s.entries[unit]
  if not entry then return end
  count(s, entry, -1)
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
    entry.recipe, entry.status = recipe, status
    count(s, entry, 1)
  end
  return true
end

-- Initial registry for a save that already has machines: a few chunks per tick, never a full sweep.
local function scan_step(s)
  local scan = s.scan
  if not scan then
    local names = {}
    for _, surface in pairs(game.surfaces) do names[#names + 1] = surface.name end
    scan = { surfaces = names, surface_i = 0, chunks = {}, chunk_i = 1 }
    s.scan = scan
  end
  for _ = 1, SCAN_CHUNKS_PER_TICK do
    if scan.chunk_i > #scan.chunks then
      scan.surface_i = scan.surface_i + 1
      local name = scan.surfaces[scan.surface_i]
      if not name then
        s.scan, s.scanned = nil, true
        return
      end
      scan.chunks = {}
      scan.chunk_i = 1
      local surface = game.get_surface(name)
      if surface then for chunk in surface.get_chunks() do scan.chunks[#scan.chunks + 1] = { chunk.x, chunk.y } end end
    else
      local surface = game.get_surface(scan.surfaces[scan.surface_i])
      local c = scan.chunks[scan.chunk_i]
      scan.chunk_i = scan.chunk_i + 1
      if surface then
        local area = { { c[1] * 32, c[2] * 32 }, { c[1] * 32 + 32, c[2] * 32 + 32 } }
        for _, entity in pairs(surface.find_entities_filtered({ area = area, type = TYPES })) do
          -- An entity overlapping two chunks is found twice; add() ignores the repeat.
          add(entity)
        end
      end
    end
  end
end

local function tick()
  local s = state()
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

--- Registered machines on a surface, optionally filtered by recipe and status (for find_stuck).
function M.matching(surface_name, recipe, statuses)
  local out = {}
  for _, entry in pairs(state().entries) do
    if entry.surface == surface_name and (not recipe or entry.recipe == recipe) and entry.status and (not statuses or statuses[entry.status]) and entry.entity.valid then
      out[#out + 1] = entry.entity
    end
  end
  return out
end

function M.register(handlers)
  -- Event filters take one type per entry (entries are OR'ed).
  local filter = {}
  for _, t in ipairs(TYPES) do filter[#filter + 1] = { filter = "type", type = t } end
  script.on_event(defines.events.on_built_entity, on_built, filter)
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

  -- Test tooling: runs one extra tick of scanning/polling so its cost can be profiled over RCON.
  handlers.debug_machine_tick = function()
    tick()
    return M.progress()
  end
end

return M
