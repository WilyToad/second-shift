-- Player-equivalent actions: find, highlight, and mark/cancel deconstruction.
-- Entity references are {name, x, y} on the companion player's surface.
local util = require("scripts.util")
local helmet = require("scripts.helmet")
local companion_player, reject = util.companion_player, util.reject

local MAX_RADIUS = 128
local MAX_RESULTS = 1000
local MAX_TARGETS = 1000
local HIGHLIGHT_COLOR = { r = 0.92, g = 0.63, b = 0.24, a = 0.9 }

local function require_player()
  local player = companion_player()
  if not player then reject("no_player", "No player is connected.") end
  return player
end

-- "right" is east: the camera never rotates. The area is the half of a square around the player.
local function relative_area(position, direction, radius)
  local x, y, r = position.x, position.y, radius
  if direction == "right" then return { left_top = { x = x, y = y - r }, right_bottom = { x = x + r, y = y + r } } end
  if direction == "left" then return { left_top = { x = x - r, y = y - r }, right_bottom = { x = x, y = y + r } } end
  if direction == "up" then return { left_top = { x = x - r, y = y - r }, right_bottom = { x = x + r, y = y } } end
  if direction == "down" then return { left_top = { x = x - r, y = y }, right_bottom = { x = x + r, y = y + r } } end
  if direction == "around" then return { left_top = { x = x - r, y = y - r }, right_bottom = { x = x + r, y = y + r } } end
  reject("bad_args", "direction must be right, left, up, down or around")
end

local function resolve(player, ref)
  if type(ref) ~= "table" or type(ref.name) ~= "string" or type(ref.x) ~= "number" or type(ref.y) ~= "number" then return nil end
  return player.surface.find_entity(ref.name, { x = ref.x, y = ref.y })
end

return function(handlers)
  -- Look: count and list entities near the player, only where the player's force can see.
  handlers.find_entities = function(args)
    local player = require_player()
    local radius = math.min(tonumber(args.radius) or 32, MAX_RADIUS)
    -- "near me" searches around the character, "here/on screen" around where the player is looking (FC-092).
    local center, surface = util.anchor(player, args.from)
    local area = relative_area(center, args.direction or "around", radius)
    local filter = { area = { area.left_top, area.right_bottom } }
    if args.types and #args.types > 0 then filter.type = args.types end
    if args.names and #args.names > 0 then filter.name = args.names end
    if args.mine then filter.force = player.force end

    local found = surface.find_entities_filtered(filter)
    local visible_chunk = {}
    local entities, by_name, hidden = {}, {}, 0
    local count = 0
    for _, e in ipairs(found) do
      if e.prototype.hidden then
        hidden = hidden + 1
      else
        local key = math.floor(e.position.x / 32) .. ":" .. math.floor(e.position.y / 32)
        if visible_chunk[key] == nil then visible_chunk[key] = helmet.visible(player.force, surface, e.position) end
        if visible_chunk[key] then
          count = count + 1
          by_name[e.name] = (by_name[e.name] or 0) + 1
          if #entities < MAX_RESULTS then entities[#entities + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
        end
        -- Entities in chunks the player can't see aren't counted at all: even a count tells the companion
        -- something the player couldn't know (FC-142).
      end
    end
    return {
      surface = surface.name,
      center = { x = center.x, y = center.y },
      from = args.from == "view" and "view" or "character",
      direction = args.direction or "around",
      radius = radius,
      area = area,
      count = count,
      by_name = by_name,
      entities = entities,
      truncated = count > #entities,
    }
  end

  -- Visual only, visible only to the player; expires on its own. Replaces any previous highlight.
  handlers.highlight = function(args)
    local player = require_player()
    storage.highlights = storage.highlights or {}
    for _, id in pairs(storage.highlights[player.index] or {}) do
      local obj = rendering.get_object_by_id(id)
      if obj then obj.destroy() end
    end
    local ids = {}
    local ttl = math.floor((tonumber(args.seconds) or 30) * 60)
    for i, ref in ipairs(args.entities or {}) do
      if i > MAX_TARGETS then break end
      local e = resolve(player, ref)
      if e then
        -- Tied to the entity: the game removes the box when the entity goes (FC-159), e.g. after deconstruction.
        local box, at = e.selection_box, e.position
        local obj = rendering.draw_rectangle({
          color = HIGHLIGHT_COLOR, width = 3, filled = false,
          left_top = { entity = e, offset = { box.left_top.x - at.x, box.left_top.y - at.y } },
          right_bottom = { entity = e, offset = { box.right_bottom.x - at.x, box.right_bottom.y - at.y } },
          surface = e.surface, players = { player }, time_to_live = ttl,
        })
        ids[#ids + 1] = obj.id
      end
    end
    storage.highlights[player.index] = ids
    return { drawn = #ids, seconds = ttl / 60 }
  end

  -- Look (FC-143): point the way to a spot the player can find on their map. An arrow circles the character and
  -- faces the spot (the engine turns it as they walk: no script per tick), and a marker shows on the map. Only
  -- this player sees them; they expire. Refused off the character's surface or where the map isn't charted.
  handlers.point_to = function(args)
    local player = require_player()
    local character = player.character
    if not character then reject("no_character", "The player has no character to point from.") end
    local surface = character.surface
    local x, y = tonumber(args.x), tonumber(args.y)
    if not (x and y) then reject("bad_args", "x and y are required") end
    if args.surface and args.surface ~= surface.name then reject("other_surface", "That spot is on " .. tostring(args.surface) .. ", not where the player's character is.") end
    if not player.force.is_chunk_charted(surface, { x = math.floor(x / 32), y = math.floor(y / 32) }) then
      reject("not_charted", "That spot isn't on the player's map.")
    end
    storage.pointers = storage.pointers or {}
    for _, id in pairs(storage.pointers[player.index] or {}) do
      local obj = rendering.get_object_by_id(id)
      if obj then obj.destroy() end
    end
    local ttl = math.floor(math.min(tonumber(args.seconds) or 30, 120) * 60)
    local spot = { x = x, y = y }
    local label = tostring(args.label or "")
    local ids = {}
    local function keep(obj) ids[#ids + 1] = obj.id end
    keep(rendering.draw_sprite({
      sprite = "utility/pin_arrow", surface = surface, target = character, orientation_target = spot,
      oriented_offset = { 0, -3 }, x_scale = 2, y_scale = 2,
      players = { player }, time_to_live = ttl,
    }))
    keep(rendering.draw_circle({ color = HIGHLIGHT_COLOR, radius = 1.5, width = 4, filled = false, target = spot, surface = surface, players = { player }, time_to_live = ttl }))
    keep(rendering.draw_circle({ color = HIGHLIGHT_COLOR, radius = 6, width = 6, filled = false, target = spot, surface = surface, players = { player }, time_to_live = ttl, render_mode = "chart" }))
    if label ~= "" then
      keep(rendering.draw_text({ text = label, color = HIGHLIGHT_COLOR, scale = 3, alignment = "center", target = { x = x, y = y - 3 }, surface = surface, players = { player }, time_to_live = ttl }))
      keep(rendering.draw_text({ text = label, color = HIGHLIGHT_COLOR, scale = 3, alignment = "center", target = { x = x, y = y - 10 }, surface = surface, players = { player }, time_to_live = ttl, render_mode = "chart" }))
    end
    storage.pointers[player.index] = ids
    local c = character.position
    return { surface = surface.name, x = x, y = y, distance = math.floor(math.sqrt((x - c.x) ^ 2 + (y - c.y) ^ 2)), seconds = ttl / 60 }
  end

  handlers.clear_highlight = function()
    local player = require_player()
    local cleared = 0
    for _, id in pairs((storage.highlights or {})[player.index] or {}) do
      local obj = rendering.get_object_by_id(id)
      if obj then obj.destroy(); cleared = cleared + 1 end
    end
    if storage.highlights then storage.highlights[player.index] = nil end
    return { cleared = cleared }
  end

  local function apply(args, mark)
    local player = require_player()
    local targets = args.entities or {}
    if #targets > MAX_TARGETS then reject("too_many", "At most " .. MAX_TARGETS .. " entities per action.") end
    local done, rejected = 0, {}
    for _, ref in ipairs(targets) do
      local e = resolve(player, ref)
      -- Not `e and why_not(...) or "gone"`: why_not returns nil when allowed, which that idiom turns into "gone".
      local reason = "gone"
      if e then reason = helmet.why_not_deconstruct(player, e) end
      if not reason and mark and e.to_be_deconstructed() then reason = "already_marked" end
      if not reason and not mark and not e.to_be_deconstructed() then reason = "not_marked" end
      if reason then
        rejected[reason] = (rejected[reason] or 0) + 1
      elseif mark then
        -- One undo item for the whole action: 0 starts it, 1 adds to it.
        e.order_deconstruction(player.force, player, done == 0 and 0 or 1)
        done = done + 1
      else
        e.cancel_deconstruction(player.force, player)
        done = done + 1
      end
    end
    return { done = done, rejected = rejected, undo_items = player.undo_redo_stack.get_undo_item_count() }
  end

  -- Map change (needs the player's approval in the app): same as a deconstruction planner drag.
  handlers.mark_deconstruction = function(args) return apply(args, true) end
  handlers.cancel_deconstruction = function(args) return apply(args, false) end
end
