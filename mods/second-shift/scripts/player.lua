-- What the player carries, can craft by hand, just built and can see around them (S22).
-- All looks: the player sees each of these in their own inventory, crafting menu and screen.
local util = require("scripts.util")
local helmet = require("scripts.helmet")
local companion_player, reject = util.companion_player, util.reject

local MAX_BUILDS = 20
local MAX_ITEMS = 40
local MAX_CRAFTABLE = 40
local MAX_RADIUS = 64
local MAX_NAMES = 25

local function require_player()
  local player = companion_player()
  if not player then reject("no_player", "No player is connected.") end
  return player
end

-- A map id made once per map, so the app keeps one conversation per map (FC-137). The seed differs
-- between new maps; the tick tells apart a mod added to two saves of the same seed.
local function ensure_map_id()
  if storage.map_id then return end
  local surface = game.surfaces[1]
  local seed = surface and surface.map_gen_settings.seed or 0
  storage.map_id = string.format("%x-%x", seed, game.tick)
end

-- The player's own builds, newest last, capped. Kept in storage: it decides what's saved.
local function on_player_built(e)
  local entity = e.entity
  if not (entity and entity.valid and e.player_index) then return end
  storage.recent_builds = storage.recent_builds or {}
  local list = storage.recent_builds[e.player_index] or {}
  local ghost = entity.type == "entity-ghost"
  list[#list + 1] = {
    entity = entity,
    name = ghost and entity.ghost_name or entity.name,
    ghost = ghost,
    surface = entity.surface.name,
    x = entity.position.x,
    y = entity.position.y,
    tick = game.tick,
  }
  if #list > MAX_BUILDS then table.remove(list, 1) end
  storage.recent_builds[e.player_index] = list
end

-- Hand recipes without fluids, from prototypes (fixed while the game runs), in crafting-menu order.
-- A module-local cache is fine here: it only feeds RCON replies.
local hand_recipes = {}
local function hand_recipe_list(character)
  local key = character.name
  if hand_recipes[key] then return hand_recipes[key] end
  local categories = character.prototype.crafting_categories or {}
  local list = {}
  for name, r in pairs(prototypes.recipe) do
    if categories[r.category] and not r.hidden then
      local ins, fluid = {}, false
      for _, i in pairs(r.ingredients) do
        if i.type == "fluid" then fluid = true else ins[#ins + 1] = i.name end
      end
      if not fluid then
        local outs = {}
        for _, pr in pairs(r.products) do if pr.type == "item" then outs[#outs + 1] = pr.name end end
        list[#list + 1] = { name = name, ins = ins, outs = outs, order = r.group.order .. r.subgroup.order .. r.order }
      end
    end
  end
  table.sort(list, function(a, b) return a.order < b.order end)
  hand_recipes[key] = list
  return list
end

local M = {}

function M.register(handlers)
  script.on_init(ensure_map_id)
  script.on_configuration_changed(ensure_map_id)
  util.on_event(defines.events.on_built_entity, on_player_built)

  handlers.map_id = function()
    return { map_id = storage.map_id }
  end

  handlers.player_status = function()
    local player = require_player()
    local character = player.character

    local items, total_items = {}, 0
    local by_name_all = {}
    local inventory = player.get_main_inventory()
    if inventory then
      local by_name = by_name_all
      for _, stack in pairs(inventory.get_contents()) do by_name[stack.name] = (by_name[stack.name] or 0) + stack.count end
      for name, count in pairs(by_name) do items[#items + 1] = { name = name, count = count } end
      table.sort(items, function(a, b) return a.count > b.count end)
      total_items = #items
      for i = #items, MAX_ITEMS + 1, -1 do items[i] = nil end
    end
    local cursor = player.cursor_stack
    local hand = cursor and cursor.valid_for_read and { name = cursor.name, count = cursor.count } or nil

    -- Hand-craftable now, in crafting-menu order. get_craftable_count costs ~30 µs a call (233 hand recipes
    -- on the dev save: 6.8 ms), so it's only asked for recipes whose ingredients the inventory has or
    -- could hand-craft, and only until the list is full.
    local craftable, more = {}, false
    if character then
      local list = hand_recipe_list(character)
      local can = {}
      for name in pairs(by_name_all) do can[name] = true end
      local recipes = player.force.recipes
      local candidate = {}
      local changed, passes = true, 0
      while changed and passes < 4 do
        changed, passes = false, passes + 1
        for i, r in ipairs(list) do
          if not candidate[i] then
            local ok = true
            for _, n in ipairs(r.ins) do if not can[n] then ok = false; break end end
            if ok and recipes[r.name].enabled then
              candidate[i] = true
              for _, o in ipairs(r.outs) do if not can[o] then can[o] = true; changed = true end end
            end
          end
        end
      end
      for i, r in ipairs(list) do
        if candidate[i] then
          if #craftable >= MAX_CRAFTABLE then more = true; break end
          local n = player.get_craftable_count(r.name)
          if n > 0 then craftable[#craftable + 1] = { name = r.name, count = n } end
        end
      end
    end

    local queue = {}
    for _, q in pairs(player.crafting_queue or {}) do queue[#queue + 1] = { name = q.recipe, count = q.count } end

    local builds = {}
    local list = (storage.recent_builds or {})[player.index] or {}
    for i = #list, 1, -1 do
      local b = list[i]
      builds[#builds + 1] = { name = b.name, ghost = b.ghost, surface = b.surface, x = b.x, y = b.y, age_ticks = game.tick - b.tick, still_there = b.entity.valid }
    end

    local position = player.physical_position
    return {
      character = character ~= nil,
      surface = player.physical_surface.name,
      x = math.floor(position.x), y = math.floor(position.y),
      items = items, total_items = total_items, hand = hand,
      craftable = craftable, more_craftable = more,
      crafting_queue = queue,
      recent_builds = builds,
    }
  end

  -- Look around the character: what's built, resources, trees, rocks, enemies and other things,
  -- only in chunks the player can see. On demand only; the area is capped.
  handlers.surroundings = function(args)
    local player = require_player()
    local radius = math.min(tonumber(args.radius) or 32, MAX_RADIUS)
    local center, surface = player.physical_position, player.physical_surface
    local area = { { center.x - radius, center.y - radius }, { center.x + radius, center.y + radius } }
    local visible_chunk = {}
    local groups = { mine = {}, resources = {}, other = {} }
    local trees, rocks, enemies = 0, 0, 0
    local function nearer(entry, e)
      local dx, dy = e.position.x - center.x, e.position.y - center.y
      local d = dx * dx + dy * dy
      if not entry.d or d < entry.d then entry.d, entry.x, entry.y = d, math.floor(e.position.x), math.floor(e.position.y) end
    end
    for _, e in ipairs(surface.find_entities_filtered({ area = area })) do
      local key = math.floor(e.position.x / 32) .. ":" .. math.floor(e.position.y / 32)
      if visible_chunk[key] == nil then visible_chunk[key] = helmet.visible(player.force, surface, e.position) end
      if not visible_chunk[key] then
        -- not counted: the player can't see there
      elseif e.type == "character" or e.prototype.hidden then
        -- the player themselves, and engine-internal entities
      elseif e.type == "tree" then
        trees = trees + 1
      elseif e.type == "resource" then
        local entry = groups.resources[e.name] or { name = e.name, count = 0, amount = 0 }
        entry.count = entry.count + 1
        entry.amount = entry.amount + e.amount
        nearer(entry, e)
        groups.resources[e.name] = entry
      elseif e.force.index == player.force.index then
        local entry = groups.mine[e.name] or { name = e.name, count = 0 }
        entry.count = entry.count + 1
        nearer(entry, e)
        groups.mine[e.name] = entry
      elseif e.force.name == "enemy" then
        enemies = enemies + 1
      elseif e.type == "simple-entity" then
        rocks = rocks + 1
      else
        local entry = groups.other[e.name] or { name = e.name, count = 0 }
        entry.count = entry.count + 1
        nearer(entry, e)
        groups.other[e.name] = entry
      end
    end
    local function listed(dict)
      local out = {}
      for _, entry in pairs(dict) do entry.d = nil; out[#out + 1] = entry end
      table.sort(out, function(a, b) return a.count > b.count end)
      for i = #out, MAX_NAMES + 1, -1 do out[i] = nil end
      return out
    end
    -- Water is counted chunk by chunk, skipping chunks the player can't see.
    local water = 0
    for cx = math.floor(area[1][1] / 32), math.floor((area[2][1] - 1) / 32) do
      for cy = math.floor(area[1][2] / 32), math.floor((area[2][2] - 1) / 32) do
        if player.force.is_chunk_visible(surface, { x = cx, y = cy }) then
          local box = { { math.max(cx * 32, area[1][1]), math.max(cy * 32, area[1][2]) }, { math.min((cx + 1) * 32, area[2][1]), math.min((cy + 1) * 32, area[2][2]) } }
          water = water + surface.count_tiles_filtered({ area = box, collision_mask = "water_tile" })
        end
      end
    end
    return {
      surface = surface.name,
      x = math.floor(center.x), y = math.floor(center.y),
      radius = radius,
      mine = listed(groups.mine),
      resources = listed(groups.resources),
      other = listed(groups.other),
      trees = trees, rocks = rocks, enemies = enemies, water_tiles = water,
    }
  end
end

return M
