-- The first thing the companion moves in the world: the player's own spidertron, walking there with the engine's
-- own autopilot (FC-144), and the rules that make that safe (FC-051).
--
-- Helmet rule: sending a spidertron across the map is something the player does with a spidertron remote, so the
-- mod asks for the same things — their own spidertron, on their surface, a spot on their map, a remote in their
-- inventory — and uses the same engine autopilot. Stopping clears `autopilot_destination`, which is what dropping
-- the order looks like; `stop_spider` writes `speed` and would be a cheat.
--
-- Player input always wins: one order at a time, the stop key cancels it inside a tick, and anything the player
-- does to the spidertron (driving it, sending it themselves with their remote, it being destroyed) ends the order.
local util = require("scripts.util")
local feed = require("scripts.feed")
local companion_player, reject = util.companion_player, util.reject

local MAX_DISTANCE = 1000
local MAX_LISTED = 10

local function require_player()
  local player = companion_player()
  if not player then reject("no_player", "No player is connected.") end
  return player
end

--- Does the player carry a spidertron remote? Sending one across the map needs it (their own tool, their own reach).
local function has_remote(player)
  local inventory = player.get_main_inventory()
  if not inventory then return false end
  for _, stack in pairs(inventory.get_contents()) do
    local proto = prototypes.item[stack.name]
    if proto and proto.type == "spidertron-remote" then return true end
  end
  return false
end

-- On demand only. A type-filtered sweep of a whole big surface costs ~4 ms, so look near the player first
-- (0.1 ms) and only sweep when nothing is close by.
local MAX_FOUND = 20
local NEARBY = 256
local function spiders_of(player)
  local surface, at = player.surface, player.physical_position
  local near = surface.find_entities_filtered({
    type = "spider-vehicle", force = player.force, limit = MAX_FOUND,
    area = { { at.x - NEARBY, at.y - NEARBY }, { at.x + NEARBY, at.y + NEARBY } },
  })
  if #near > 0 then return near end
  return surface.find_entities_filtered({ type = "spider-vehicle", force = player.force, limit = MAX_FOUND })
end

local function described(player, spider)
  local at = player.physical_position
  local dx, dy = spider.position.x - at.x, spider.position.y - at.y
  return {
    name = spider.name,
    unit_number = spider.unit_number,
    x = math.floor(spider.position.x), y = math.floor(spider.position.y),
    distance = math.floor(math.sqrt(dx * dx + dy * dy)),
    driver = spider.get_driver() ~= nil,
    walking_to = spider.autopilot_destination and { x = math.floor(spider.autopilot_destination.x), y = math.floor(spider.autopilot_destination.y) } or nil,
  }
end

--- The order the companion started, if any. Lives in storage: it decides what the stop key and the events do.
local function order()
  return storage.control
end

local function clear_order(reason)
  local control = storage.control
  storage.control = nil
  if not control then return nil end
  local player = companion_player()
  local spider = control.entity -- the entity reference is kept in storage with the order
  if spider and spider.valid and reason ~= "arrived" then
    spider.autopilot_destination = nil -- dropping the order, as the player would
  end
  feed.push({ kind = "control_stopped", severity = "info", control = control.kind, reason = reason, entity = control.name })
  if player and reason ~= "arrived" then
    player.print({ "", "[Ballast] stopped: ", control.name, " (", reason, ")" })
  end
  return control
end

local M = {}

function M.register(handlers)
  -- The stop key (FC-051): cancels whatever the companion started, inside the tick it's pressed.
  script.on_event("second-shift-stop", function(e)
    local player = companion_player()
    if not (player and player.index == e.player_index) then return end
    if order() then clear_order("stop_key") else player.print({ "", "[Ballast] nothing to stop" }) end
  end)

  -- The player taking the spidertron back, any way they can: driving it, sending it with their own remote, or
  -- losing it. Each ends the order without the companion doing anything else.
  util.on_event(defines.events.on_player_driving_changed_state, function(e)
    local control = order()
    if control and control.entity and control.entity.valid and e.entity == control.entity then clear_order("player_driving") end
  end)
  util.on_event(defines.events.on_player_used_spidertron_remote, function()
    if order() then clear_order("player_remote") end
  end)
  util.on_event(defines.events.on_spider_command_completed, function(e)
    local control = order()
    if not (control and control.entity and control.entity.valid and e.vehicle == control.entity) then return end
    -- Arrived: nothing left to cancel, so say so and forget the order.
    feed.push({ kind = "control_arrived", severity = "info", control = control.kind, entity = control.name,
      position = { x = math.floor(e.vehicle.position.x), y = math.floor(e.vehicle.position.y) } })
    storage.control = nil
  end)
  -- Filtered: on_entity_died is a hot event, and only spidertrons matter here.
  util.on_event(defines.events.on_entity_died, function(e)
    local control = order()
    if control and control.entity == e.entity then clear_order("destroyed") end
  end, { { filter = "type", type = "spider-vehicle" } })

  -- Look: the player's spidertrons on their surface, nearest first, with what they're already doing.
  handlers.spidertrons = function()
    local player = require_player()
    local list = {}
    for _, spider in pairs(spiders_of(player)) do list[#list + 1] = described(player, spider) end
    table.sort(list, function(a, b) return a.distance < b.distance end)
    local total = #list
    for i = #list, MAX_LISTED + 1, -1 do list[i] = nil end
    return { spidertrons = list, total = total, has_remote = has_remote(player), surface = player.surface.name }
  end

  -- Character control (needs the player's confirmation): send one spidertron to a spot on their map.
  handlers.send_spidertron = function(args)
    local player = require_player()
    local x, y = tonumber(args.x), tonumber(args.y)
    if not (x and y) then reject("bad_args", "x and y are required") end
    local surface = player.surface
    if args.surface and args.surface ~= surface.name then
      reject("other_surface", "That spot is on " .. tostring(args.surface) .. ", not where the player is.")
    end
    if not has_remote(player) then
      reject("no_remote", "The player has no spidertron remote, so they couldn't send it themselves.")
    end
    local spider = nil
    if args.unit_number then
      for _, candidate in pairs(spiders_of(player)) do
        if candidate.unit_number == tonumber(args.unit_number) then spider = candidate end
      end
    else
      local best
      for _, candidate in pairs(spiders_of(player)) do
        local at = player.physical_position
        local d = (candidate.position.x - at.x) ^ 2 + (candidate.position.y - at.y) ^ 2
        if not best or d < best then best, spider = d, candidate end
      end
    end
    if not (spider and spider.valid) then reject("no_spidertron", "The player has no spidertron on this surface.") end
    if spider.get_driver() then reject("someone_driving", "Someone is driving that spidertron.") end
    if not player.force.is_chunk_charted(surface, { x = math.floor(x / 32), y = math.floor(y / 32) }) then
      reject("not_charted", "That spot isn't on the player's map.")
    end
    local dx, dy = x - spider.position.x, y - spider.position.y
    local distance = math.floor(math.sqrt(dx * dx + dy * dy))
    if distance > MAX_DISTANCE then
      reject("too_far", "That's " .. distance .. " tiles away, more than the " .. MAX_DISTANCE .. "-tile limit for one order.")
    end
    -- One order at a time: a new one replaces the old, as a second click of the remote would.
    if order() then clear_order("replaced") end
    spider.autopilot_destination = { x = x, y = y }
    storage.control = { kind = "spidertron", entity = spider, unit = spider.unit_number, name = spider.name, goal = { x = x, y = y }, started = game.tick }
    return { name = spider.name, unit_number = spider.unit_number, x = math.floor(x), y = math.floor(y), distance = distance, surface = surface.name }
  end

  -- Small request: stop what the companion started, the same as the stop key.
  handlers.stop_control = function()
    local player = require_player()
    local control = clear_order("asked")
    return { stopped = control ~= nil, control = control and control.kind or nil, entity = control and control.name or nil, surface = player.surface.name }
  end

  -- Test tooling: the same event the stop key makes (custom inputs can't be raised from script).
  handlers.debug_press_stop = function()
    local control = order()
    if control then clear_order("stop_key") end
    return { stopped = control ~= nil }
  end
end

return M
