-- Planning actions (S08): research queue, map tags, camera, upgrade marks and blueprint placement.
-- Each re-checks what the player could do right now (helmet rule) when it runs.
local util = require("scripts.util")
local helmet = require("scripts.helmet")
local reject = util.reject

local MAX_TARGETS = 1000

local function require_player()
  local player = util.companion_player()
  if not player then reject("no_player", "No player is connected.") end
  return player
end

local function chunk_of(position)
  return { x = math.floor(position.x / 32), y = math.floor(position.y / 32) }
end

local function resolve(player, ref)
  if type(ref) ~= "table" or type(ref.name) ~= "string" or type(ref.x) ~= "number" or type(ref.y) ~= "number" then return nil end
  return player.surface.find_entity(ref.name, { x = ref.x, y = ref.y })
end

return function(handlers)
  -- Small request: add a technology to the research queue, as the research screen would allow.
  handlers.queue_research = function(args)
    local player = require_player()
    local force = player.force
    local tech = force.technologies[args.technology or ""]
    if not tech then reject("unknown_technology", "No technology named " .. tostring(args.technology) .. ".") end
    if tech.researched then reject("already_researched", tech.name .. " is already researched.") end
    if not tech.enabled then reject("not_available", tech.name .. " can't be researched in this save.") end
    if tech.prototype.research_trigger then
      reject("trigger_technology", tech.name .. " unlocks by doing something in the game (" .. tech.prototype.research_trigger.type .. "), not by labs.")
    end
    local missing = {}
    for name, pre in pairs(tech.prerequisites) do
      if not pre.researched then missing[#missing + 1] = name end
    end
    if #missing > 0 then
      table.sort(missing)
      error({ code = "missing_prerequisites", message = tech.name .. " needs " .. table.concat(missing, ", ") .. " first.", missing = missing }, 0)
    end
    for _, queued in pairs(force.research_queue or {}) do
      if queued.name == tech.name then reject("already_queued", tech.name .. " is already in the research queue.") end
    end
    local ok = force.add_research(tech)
    if not ok then reject("queue_refused", "The game didn't accept " .. tech.name .. " into the queue.") end
    local queue = {}
    for _, t in pairs(force.research_queue or {}) do queue[#queue + 1] = t.name end
    return { queued = tech.name, queue = queue }
  end

  -- Look: technologies the player could queue right now (prerequisites done, researched by labs), cheapest first.
  handlers.research_options = function()
    local player = require_player()
    local out = {}
    for name, tech in pairs(player.force.technologies) do
      if tech.enabled and not tech.researched and not tech.prototype.hidden and not tech.prototype.research_trigger then
        local ready = true
        for _, pre in pairs(tech.prerequisites) do if not pre.researched then ready = false; break end end
        if ready then
          local packs = {}
          for _, ing in pairs(tech.research_unit_ingredients) do packs[#packs + 1] = ing.name end
          out[#out + 1] = { name = name, count = tech.research_unit_count, packs = packs }
        end
      end
    end
    table.sort(out, function(a, b) return a.count * #a.packs < b.count * #b.packs end)
    local top = {}
    for i = 1, math.min(25, #out) do top[i] = out[i] end
    local queue = {}
    for _, t in pairs(player.force.research_queue or {}) do queue[#queue + 1] = t.name end
    return { options = top, available = #out, queue = queue }
  end

  -- Small request: a map tag where the player could place one (charted map on their surface).
  handlers.add_map_tag = function(args)
    local player = require_player()
    local position = { x = tonumber(args.x) or player.position.x, y = tonumber(args.y) or player.position.y }
    if not player.force.is_chunk_charted(player.surface, chunk_of(position)) then reject("not_charted", "That spot isn't on the player's map yet.") end
    local tag = player.force.add_chart_tag(player.surface, { position = position, text = tostring(args.text or ""), last_user = player })
    if not tag then reject("tag_refused", "The game didn't accept a tag there.") end
    return { x = math.floor(position.x), y = math.floor(position.y), text = tag.text }
  end

  -- Small request: open remote view at a charted position, as the map would.
  handlers.camera_to = function(args)
    local player = require_player()
    local surface = args.surface and game.get_surface(args.surface) or player.surface
    if not surface then reject("unknown_surface", "No surface named " .. tostring(args.surface) .. ".") end
    local position = { x = tonumber(args.x) or 0, y = tonumber(args.y) or 0 }
    if not player.force.is_chunk_charted(surface, chunk_of(position)) then reject("not_charted", "That spot isn't on the player's map.") end
    player.set_controller({ type = defines.controllers.remote, position = position, surface = surface })
    return { surface = surface.name, x = math.floor(position.x), y = math.floor(position.y) }
  end

  -- Map change (approval in the app): same rules as an upgrade planner.
  handlers.mark_upgrade = function(args)
    local player = require_player()
    local targets = args.entities or {}
    if #targets > MAX_TARGETS then reject("too_many", "At most " .. MAX_TARGETS .. " entities per action.") end
    local wanted = args.target and prototypes.entity[args.target] or nil
    if args.target and not wanted then reject("unknown_target", "No entity named " .. tostring(args.target) .. ".") end
    local done, rejected, first = 0, {}, true
    for _, ref in ipairs(targets) do
      local e = resolve(player, ref)
      local reason = "gone"
      if e then reason = helmet.why_not_deconstruct(player, e) end
      local target = wanted or (e and e.valid and e.prototype.next_upgrade) or nil
      if not reason then
        if not target then reason = "no_upgrade"
        elseif target.name == e.name then reason = "same_entity"
        elseif target.fast_replaceable_group ~= e.prototype.fast_replaceable_group or target.tile_width ~= e.prototype.tile_width or target.tile_height ~= e.prototype.tile_height then reason = "not_compatible"
        elseif e.to_be_upgraded() then reason = "already_marked" end
      end
      if reason then
        rejected[reason] = (rejected[reason] or 0) + 1
      else
        e.order_upgrade({ force = player.force, target = target, player = player, undo_index = first and 0 or 1 })
        first = false
        done = done + 1
      end
    end
    return { done = done, rejected = rejected, undo_items = player.undo_redo_stack.get_undo_item_count() }
  end

  -- Look: a picture of a spot the player can see right now (not fog of war), written to script-output by the
  -- player's own game client. Measured in the dev game: ~0.1 ms in Lua, the JPEG lands 40–60 ms later, no UPS drop.
  local shots = 0
  handlers.screenshot = function(args)
    local player = require_player()
    local position = { x = tonumber(args.x) or player.position.x, y = tonumber(args.y) or player.position.y }
    if not helmet.visible(player.force, player.surface, position) then reject("not_visible", "The player can't see that spot right now.") end
    local size = math.max(256, math.min(2048, math.floor(tonumber(args.size) or 1024)))
    local zoom = math.max(0.1, math.min(2, tonumber(args.zoom) or 0.5))
    -- The counter only names files in the reply; nothing in storage depends on it.
    shots = shots + 1
    local path = "companion/shot-" .. game.tick .. "-" .. shots .. ".jpg"
    game.take_screenshot({
      player = player, by_player = player, surface = player.surface, position = position,
      resolution = { size, size }, zoom = zoom, path = path, quality = 80,
      show_gui = false, show_entity_info = true, anti_alias = false,
    })
    -- At zoom 1 a tile is 32 px.
    return { path = path, surface = player.surface.name, x = position.x, y = position.y, size = size, zoom = zoom, tiles = size / (32 * zoom) }
  end

  -- Map change (approval in the app): set the recipe of assembling machines, as the player could in the
  -- machine's window (in reach or through remote view where they can see). What the machine held goes to
  -- the player's inventory, and anything that doesn't fit spills at the machine, so no items appear or vanish.
  handlers.set_recipe = function(args)
    local player = require_player()
    local targets = args.entities or {}
    if #targets > MAX_TARGETS then reject("too_many", "At most " .. MAX_TARGETS .. " entities per action.") end
    local recipe = player.force.recipes[args.recipe or ""]
    if not recipe then reject("unknown_recipe", "No recipe named " .. tostring(args.recipe) .. ".") end
    if recipe.hidden then reject("hidden_recipe", recipe.name .. " can't be chosen in a machine.") end
    if not recipe.enabled then reject("not_unlocked", recipe.name .. " isn't unlocked yet.") end
    local done, rejected, returned, spilled = 0, {}, 0, 0
    for _, ref in ipairs(targets) do
      local e = resolve(player, ref)
      local reason = nil
      if not (e and e.valid) then reason = "gone"
      elseif e.force ~= player.force then reason = "not_yours"
      elseif e.type ~= "assembling-machine" then reason = "not_an_assembler"
      elseif e.prototype.fixed_recipe then reason = "fixed_recipe"
      elseif not helmet.visible(player.force, e.surface, e.position) then reason = "not_visible"
      elseif not (e.prototype.crafting_categories or {})[recipe.category] then reason = "wrong_category"
      else
        local current = e.get_recipe()
        if current and current.name == recipe.name then reason = "same_recipe" end
      end
      if reason then
        rejected[reason] = (rejected[reason] or 0) + 1
      else
        for _, item in pairs(e.set_recipe(recipe)) do
          local stack = { name = item.name, count = item.count, quality = item.quality }
          local moved = player.insert(stack)
          returned = returned + moved
          if moved < item.count then
            stack.count = item.count - moved
            e.surface.spill_item_stack({ position = e.position, stack = stack, enable_looted = true, force = player.force, allow_belts = false })
            spilled = spilled + stack.count
          end
        end
        done = done + 1
      end
    end
    return { done = done, rejected = rejected, returned = returned, spilled = spilled }
  end

  -- Map change (approval in the app): paste a blueprint as ghosts, like the player would.
  handlers.place_blueprint = function(args)
    local player = require_player()
    local position = { x = tonumber(args.x) or player.position.x, y = tonumber(args.y) or player.position.y }
    if not helmet.visible(player.force, player.surface, position) then reject("not_visible", "The player can't see that spot right now.") end
    local inventory = game.create_inventory(1)
    local stack = inventory[1]
    local result = stack.import_stack(tostring(args.blueprint or ""))
    if result == -1 or not (stack.valid_for_read and stack.is_blueprint and stack.is_blueprint_setup()) then
      inventory.destroy()
      reject("bad_blueprint", "That isn't a single blueprint the game can import.")
    end
    local expected = stack.get_blueprint_entity_count()
    local ghosts = stack.build_blueprint({
      surface = player.surface, force = player.force, position = position,
      direction = tonumber(args.direction) or defines.direction.north,
      build_mode = defines.build_mode.normal, by_player = player, skip_fog_of_war = true,
    })
    inventory.destroy()
    return { placed = #ghosts, expected = expected, x = math.floor(position.x), y = math.floor(position.y), undo_items = player.undo_redo_stack.get_undo_item_count() }
  end
end
