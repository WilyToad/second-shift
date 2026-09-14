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
    local area = relative_area(player.position, args.direction or "around", radius)
    local filter = { area = { area.left_top, area.right_bottom } }
    if args.types and #args.types > 0 then filter.type = args.types end
    if args.names and #args.names > 0 then filter.name = args.names end
    if args.mine then filter.force = player.force end

    local found = player.surface.find_entities_filtered(filter)
    local visible_chunk = {}
    local entities, by_name, hidden = {}, {}, 0
    local count, not_visible = 0, 0
    for _, e in ipairs(found) do
      if e.prototype.hidden then
        hidden = hidden + 1
      else
        local key = math.floor(e.position.x / 32) .. ":" .. math.floor(e.position.y / 32)
        if visible_chunk[key] == nil then visible_chunk[key] = helmet.visible(player.force, player.surface, e.position) end
        if visible_chunk[key] then
          count = count + 1
          by_name[e.name] = (by_name[e.name] or 0) + 1
          if #entities < MAX_RESULTS then entities[#entities + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
        else
          not_visible = not_visible + 1
        end
      end
    end
    return {
      surface = player.surface.name,
      center = { x = player.position.x, y = player.position.y },
      direction = args.direction or "around",
      radius = radius,
      area = area,
      count = count,
      by_name = by_name,
      not_visible = not_visible,
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
        local box = e.selection_box
        local obj = rendering.draw_rectangle({
          color = HIGHLIGHT_COLOR, width = 3, filled = false,
          left_top = box.left_top, right_bottom = box.right_bottom,
          surface = e.surface, players = { player }, time_to_live = ttl,
        })
        ids[#ids + 1] = obj.id
      end
    end
    storage.highlights[player.index] = ids
    return { drawn = #ids, seconds = ttl / 60 }
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
      local reason = e and helmet.why_not_deconstruct(player, e) or "gone"
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
