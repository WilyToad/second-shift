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
local MAX_RESOURCE_RADIUS = 96
local MAX_CONTENTS = 40
-- Effects that aren't things in the world: the crash site's fires are on the enemy force and read as 34 enemies (S22 eval).
local TRANSIENT = { explosion = true, fire = true, ["smoke-with-trigger"] = true, sticker = true, projectile = true, beam = true, stream = true, ["particle-source"] = true, corpse = true }
local ENEMY_TYPES = { unit = true, ["unit-spawner"] = true, turret = true, ["spider-unit"] = true, ["segmented-unit"] = true }

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

-- The last entity each player hovered, and when (FC-151): a spoken question arrives ~2 s after the words, when the mouse
-- may have moved on. Module-local, not storage: it only feeds RCON replies, so a peer without it can't desync.
local last_hover = {}
local function on_selected_changed(e)
  local player = game.get_player(e.player_index)
  local selected = player and player.selected
  if selected then last_hover[e.player_index] = { entity = selected, tick = e.tick } end
end

-- An entity the way the player sees it: ghosts by what they'll become, whole-tile positions.
local function describe(player, entity)
  local ghost = entity.type == "entity-ghost"
  return {
    name = ghost and entity.ghost_name or entity.name,
    ghost = ghost,
    type = ghost and entity.ghost_type or entity.type,
    surface = entity.surface.name,
    x = math.floor(entity.position.x), y = math.floor(entity.position.y),
    own = entity.force == player.force,
  }
end

local function gui_type_name(t)
  for name, value in pairs(defines.gui_type) do
    if value == t then return name end
  end
  return "unknown"
end

local M = {}

function M.register(handlers)
  script.on_init(ensure_map_id)
  script.on_configuration_changed(ensure_map_id)
  util.on_event(defines.events.on_built_entity, on_player_built)
  util.on_event(defines.events.on_selected_entity_changed, on_selected_changed)

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
    -- Containers the player didn't build (the crash site's wreckage): hovering one shows what's inside.
    local salvage, salvage_containers = {}, 0
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
      elseif e.type == "character" or TRANSIENT[e.type] or not e.prototype.selectable_in_game then
        -- the player themselves, and what can't be pointed at (fire, smoke). Not prototype.hidden: the
        -- crash site's wrecks are hidden from menus but are the first thing a new player mines (S22).
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
      elseif ENEMY_TYPES[e.type] and e.force.name == "enemy" then
        enemies = enemies + 1
      elseif e.type == "simple-entity" then
        rocks = rocks + 1
      else
        if e.type == "container" and salvage_containers < MAX_NAMES then
          local inv = e.get_inventory(defines.inventory.chest)
          if inv and not inv.is_empty() then
            salvage_containers = salvage_containers + 1
            for _, stack in pairs(inv.get_contents()) do salvage[stack.name] = (salvage[stack.name] or 0) + stack.count end
          end
        end
        local entry = groups.other[e.name] or { name = e.name, count = 0 }
        entry.count = entry.count + 1
        nearer(entry, e)
        groups.other[e.name] = entry
      end
    end
    -- No ore close by (a new map's crash site): look for resources further out, still only where the player can see.
    -- Answers otherwise sent players to "the iron patch near the wreck" that wasn't there (FC-139).
    local resource_radius = radius
    local wide = math.min(tonumber(args.resource_radius) or radius, MAX_RESOURCE_RADIUS)
    if next(groups.resources) == nil and wide > radius then
      resource_radius = wide
      local wide_area = { { center.x - wide, center.y - wide }, { center.x + wide, center.y + wide } }
      for _, e in ipairs(surface.find_entities_filtered({ area = wide_area, type = "resource" })) do
        local key = math.floor(e.position.x / 32) .. ":" .. math.floor(e.position.y / 32)
        if visible_chunk[key] == nil then visible_chunk[key] = helmet.visible(player.force, surface, e.position) end
        if visible_chunk[key] then
          local entry = groups.resources[e.name] or { name = e.name, count = 0, amount = 0 }
          entry.count = entry.count + 1
          entry.amount = entry.amount + e.amount
          nearer(entry, e)
          groups.resources[e.name] = entry
        end
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
      resource_radius = resource_radius,
      mine = listed(groups.mine),
      resources = listed(groups.resources),
      other = listed(groups.other),
      trees = trees, rocks = rocks, enemies = enemies, water_tiles = water,
      salvage = (function() local out = {} for name, count in pairs(salvage) do out[#out + 1] = { name = name, count = count } end return out end)(),
      salvage_containers = salvage_containers,
    }
  end

  -- Look (FC-151): what the player is pointing at, last hovered, holds and has open. All on their own screen.
  handlers.pointed_at = function()
    local player = require_player()
    local selected = player.selected
    local hover = last_hover[player.index]
    local last = nil
    if hover then
      if hover.entity.valid then
        last = describe(player, hover.entity)
        last.still_there = true
      else
        last = { still_there = false }
      end
      last.ago_ticks = game.tick - hover.tick
    end
    local cursor = player.cursor_stack
    local hand = nil
    if cursor and cursor.valid_for_read then hand = { name = cursor.name, count = cursor.count } end
    local hand_ghost = nil
    local ghost = player.cursor_ghost
    if ghost and not hand then
      local n = ghost.name
      hand_ghost = type(n) == "string" and n or n.name
    end
    local opened = nil
    local t = player.opened_gui_type
    if t and t ~= defines.gui_type.none then
      opened = { kind = gui_type_name(t) }
      local o = player.opened
      if t == defines.gui_type.entity and o and o.object_name == "LuaEntity" and o.valid then
        opened.entity = describe(player, o)
      elseif t == defines.gui_type.item and o and o.object_name == "LuaItemStack" and o.valid_for_read then
        opened.item = o.name
      end
    end
    return {
      selected = selected and describe(player, selected) or nil,
      last_hovered = last,
      hand = hand, hand_ghost = hand_ghost,
      opened = opened,
    }
  end

  -- Look (FC-152): what's inside a container or machine, as hovering it shows. Only where the player's force can see,
  -- and only their own, an ally's or neutral ones (the crash site's wreckage).
  handlers.container_contents = function(args)
    local player = require_player()
    local x, y = tonumber(args.x), tonumber(args.y)
    if type(args.name) ~= "string" or not (x and y) then reject("bad_args", "name, x and y are required") end
    local entity = player.surface.find_entity(args.name, { x = x, y = y })
    if not entity then
      -- Whole-tile positions from other looks: take the named entity covering that tile.
      local found = player.surface.find_entities_filtered({ name = args.name, area = { { x, y }, { x + 1, y + 1 } }, limit = 1 })
      entity = found[1]
    end
    if not (entity and entity.valid) then reject("gone", "Nothing called " .. args.name .. " is at that spot.") end
    if not helmet.visible(player.force, entity.surface, entity.position) then reject("not_visible", "The player can't see that spot right now.") end
    local force = entity.force
    if not (force == player.force or force.name == "neutral" or player.force.get_friend(force)) then
      reject("not_yours", "That belongs to another force.")
    end
    local by_key, items = {}, {}
    local inventories = 0
    for i = 1, entity.get_max_inventory_index() do
      local inv = entity.get_inventory(i)
      if inv then
        inventories = inventories + 1
        for _, stack in pairs(inv.get_contents()) do
          local key = stack.name .. "/" .. (stack.quality or "normal")
          local entry = by_key[key]
          if not entry then
            entry = { name = stack.name, count = 0, quality = stack.quality ~= "normal" and stack.quality or nil }
            by_key[key] = entry
            items[#items + 1] = entry
          end
          entry.count = entry.count + stack.count
        end
      end
    end
    local fluids = {}
    for name, amount in pairs(entity.get_fluid_contents()) do fluids[#fluids + 1] = { name = name, amount = math.floor(amount + 0.5) } end
    if inventories == 0 and #fluids == 0 then reject("no_inventory", "That has no inventory to look into.") end
    table.sort(items, function(a, b) return a.count > b.count end)
    local kinds = #items
    for i = #items, MAX_CONTENTS + 1, -1 do items[i] = nil end
    return { entity = describe(player, entity), items = items, total_kinds = kinds, fluids = fluids }
  end

  -- Test tooling: point the mouse at an entity (nil clears), as hovering does, and record it as the event would.
  handlers.debug_select_entity = function(args)
    local player = require_player()
    local entity = nil
    if type(args.name) == "string" then entity = player.surface.find_entity(args.name, { x = tonumber(args.x) or 0, y = tonumber(args.y) or 0 }) end
    player.selected = entity
    if player.selected then last_hover[player.index] = { entity = player.selected, tick = game.tick } end
    return { selected = player.selected ~= nil }
  end

end

return M
