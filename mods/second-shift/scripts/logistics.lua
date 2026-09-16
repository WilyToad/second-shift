-- Handing a packing list to the player's own bots (FC-168). The companion keeps its requests in its own named
-- section of the player's requester point, so their own requests are never touched: switching the section off
-- stops the deliveries and leaves everything else exactly as it was.
--
-- Helmet rule: setting personal logistic requests is something the player does themselves, and the bots do the
-- carrying either way. What the mod must not do is decide for them — so `trash_not_requested` is only read, never
-- written (their choice, 2026-09-15), and a request is refused outright when they're not in a network.
local util = require("scripts.util")
local companion_player, reject = util.companion_player, util.reject

local GROUP = "Second Shift"
local MAX_SLOTS = 20
local MAX_LISTED = 40

local function require_player()
  local player = companion_player()
  if not player then reject("no_player", "No player is connected.") end
  return player
end

local function requester_point(player)
  local character = player.character
  if not character then reject("no_character", "The player has no character, so they have no logistic requests.") end
  local point = character.get_requester_point()
  if not point then reject("no_requests", "This character can't make logistic requests (no logistic slots).") end
  return point
end

--- Our own section, found by its group name. Never returns one of the player's.
local function own_section(point, create)
  for _, section in pairs(point.sections) do
    if section.group == GROUP then return section end
  end
  if not create then return nil end
  local section = point.add_section(GROUP)
  if not section then reject("no_room", "The character has no room for another logistic section.") end
  return section
end

local M = {}

function M.register(handlers)
  -- Look: what the player's own network holds and whether they're in range of it, so a promise can be honest.
  handlers.logistic_network = function()
    local player = require_player()
    local point = player.character and player.character.get_requester_point()
    local network = point and point.logistic_network
    if not network then
      return { in_range = false, robots = 0, available_robots = 0, items = {}, total_kinds = 0, trash_unrequested = point and point.trash_not_requested or false }
    end
    local items, kinds = {}, 0
    for _, entry in pairs(network.get_contents()) do
      kinds = kinds + 1
      if #items < MAX_LISTED then
        items[#items + 1] = { name = entry.name, count = entry.count, quality = entry.quality ~= "normal" and entry.quality or nil }
      end
    end
    table.sort(items, function(a, b) return a.count > b.count end)
    return {
      in_range = true,
      network_id = network.network_id,
      robots = network.all_logistic_robots,
      available_robots = network.available_logistic_robots,
      items = items,
      total_kinds = kinds,
      trash_unrequested = point.trash_not_requested,
    }
  end

  -- Character control (the player confirms it in a card): put the list's shortfall in our own section.
  handlers.set_requests = function(args)
    local player = require_player()
    local point = requester_point(player)
    local network = point.logistic_network
    if not network then reject("no_network", "The player isn't in range of a logistic network, so bots can't deliver.") end
    local wanted = {}
    for _, item in pairs(args.items or {}) do
      if type(item) == "table" and type(item.name) == "string" and tonumber(item.count) and #wanted < MAX_SLOTS then
        wanted[#wanted + 1] = { name = item.name, count = math.max(0, math.floor(tonumber(item.count))) }
      end
    end
    if #wanted == 0 then reject("bad_args", "No items to request.") end
    local section = own_section(point, true)
    -- Clear our old slots first, so a new list replaces the last one instead of piling up.
    for i = 1, math.max(section.filters_count, #wanted) do section.clear_slot(i) end
    local set, unavailable = {}, {}
    for i, item in ipairs(wanted) do
      if not prototypes.item[item.name] then
        unavailable[#unavailable + 1] = { name = item.name, reason = "not an item in this save" }
      else
        section.set_slot(i, { value = { type = "item", name = item.name, quality = "normal", comparator = "=" }, min = item.count, max = item.count })
        local held = network.get_item_count({ name = item.name, quality = "normal" })
        set[#set + 1] = { name = item.name, count = item.count, in_network = held }
        if held < item.count then unavailable[#unavailable + 1] = { name = item.name, reason = "the network has " .. held } end
      end
    end
    section.active = true
    storage.requests = { group = GROUP, at = game.tick, items = set }
    return {
      group = GROUP, set = set, short = unavailable,
      robots = network.available_logistic_robots,
      sections = point.sections_count,
      trash_unrequested = point.trash_not_requested,
    }
  end

  -- Small request: stop the deliveries. Switched off by default (the player's choice), removed when they clear it.
  handlers.clear_requests = function(args)
    local player = require_player()
    local point = requester_point(player)
    local section = own_section(point, false)
    if not section then return { found = false, removed = false, active = false } end
    if args.remove == true then
      point.remove_section(section.index)
      storage.requests = nil
      return { found = true, removed = true, active = false }
    end
    section.active = false
    if storage.requests then storage.requests.active = false end
    return { found = true, removed = false, active = false, slots = section.filters_count }
  end
end

return M
