-- "Show the companion a build" (FC-046): the player drags the companion's selection tool over an area, and the
-- mod copies it like a blueprint tool would. The app is told through the event feed and fetches the string.
local util = require("scripts.util")
local feed = require("scripts.feed")
local reject = util.reject

local TOOL = "companion-selection-tool"
local MAX_STRING_BYTES = 4 * 1024 * 1024

-- The last capture, for the app to fetch. A module local on purpose: it only feeds an RCON reply and never
-- decides what goes into storage, so a peer that loads mid-game simply has nothing to fetch.
local last = nil

local function capture(player, surface, area)
  local inventory = game.create_inventory(1)
  inventory.insert({ name = "blueprint" })
  local stack = inventory[1]
  stack.create_blueprint({ surface = surface, force = player.force, area = area })
  local count = stack.is_blueprint_setup() and stack.get_blueprint_entity_count() or 0
  local text = count > 0 and stack.export_stack() or nil
  inventory.destroy()
  feed.push({ kind = "selection", severity = "info", count = count, surface = surface.name,
    position = { x = math.floor((area.left_top.x + area.right_bottom.x) / 2), y = math.floor((area.left_top.y + area.right_bottom.y) / 2) } })
  last = { seq = storage.events.seq, count = count, blueprint = text, surface = surface.name }
  return last
end

return function(handlers)
  local function on_selected(e)
    if e.item ~= TOOL then return end
    local player = game.get_player(e.player_index)
    if player then capture(player, e.surface, e.area) end
  end
  script.on_event(defines.events.on_player_selected_area, on_selected)
  script.on_event(defines.events.on_player_alt_selected_area, on_selected)

  -- Look: the blueprint string of a selection announced in the event feed.
  handlers.get_selection = function(args)
    if not last or last.seq ~= tonumber(args.seq) then reject("not_found", "That selection is no longer available.") end
    if not last.blueprint then return { seq = last.seq, count = 0, surface = last.surface } end
    if #last.blueprint > MAX_STRING_BYTES then reject("too_big", "That selection is too big to send; select a smaller area.") end
    return { seq = last.seq, count = last.count, surface = last.surface, blueprint = last.blueprint }
  end

  -- Test tooling: the same capture as dragging the tool, over an area around the companion player.
  handlers.debug_select_area = function(args)
    local player = util.companion_player()
    if not player then reject("no_player", "No player is connected.") end
    local r = tonumber(args.radius) or 8
    local x, y = tonumber(args.x) or player.position.x, tonumber(args.y) or player.position.y
    local result = capture(player, player.surface, { left_top = { x = x - r, y = y - r }, right_bottom = { x = x + r, y = y + r } })
    return { seq = result.seq, count = result.count, surface = result.surface }
  end
end
