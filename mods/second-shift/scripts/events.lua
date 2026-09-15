-- Urgent events for the app's alert feed, kept in a small ring buffer and read with "since N".
-- Alerts are sampled on a timer with per-type filters (an unfiltered get_alerts is ~0.6 ms on a big
-- base); research completion comes straight from the game event.
local util = require("scripts.util")
local companion_player = util.companion_player

local SAMPLE_EVERY_TICKS = 30

-- Alert types and how urgent they are for the feed.
local WATCHED = {
  entity_under_attack = "critical", entity_destroyed = "critical", turret_out_of_ammo = "critical",
  train_no_path = "warning", train_out_of_fuel = "warning", not_enough_repair_packs = "warning",
  collector_path_blocked = "warning", unclaimed_cargo = "info", no_platform_storage = "warning",
  platform_tile_building_blocked = "warning",
}

local feed = require("scripts.feed")
local state, push = feed.state, feed.push

local function sample_alerts()
  local player = companion_player()
  if not player then return end
  local s = state()
  local seen = {}
  for type_name, severity in pairs(WATCHED) do
    for surface_index, by_type in pairs(player.get_alerts({ type = defines.alert_type[type_name] })) do
      local count, first = 0, nil
      for _, list in pairs(by_type) do
        count = count + #list
        first = first or list[1]
      end
      local key = type_name .. "@" .. surface_index
      seen[key] = count
      -- Only a rise is news; a steady count was already reported.
      if count > (s.counts[key] or 0) then
        local surface = game.get_surface(surface_index)
        local where = first and ((first.target and first.target.valid and first.target.position) or first.position)
        push({
          kind = "alert", type = type_name, severity = severity, count = count,
          surface = surface and surface.name or nil,
          entity = first and ((first.target and first.target.valid and first.target.name) or (first.prototype and first.prototype.name)) or nil,
          position = where and { x = math.floor(where.x), y = math.floor(where.y) } or nil,
        })
      end
    end
  end
  s.counts = seen
end

return function(handlers)
  util.on_nth_tick(SAMPLE_EVERY_TICKS, sample_alerts)

  -- The player's push-to-talk key (FC-147): one event per press, read by the console. Only the player the
  -- companion rides with can start it.
  script.on_event("second-shift-talk", function(e)
    local player = companion_player()
    if not (player and player.index == e.player_index) then return end
    push({ kind = "talk", severity = "info" })
  end)

  -- Test tooling: the same event a key press makes (custom inputs can't be raised from script).
  handlers.debug_push_talk = function()
    push({ kind = "talk", severity = "info" })
    return { seq = state().seq }
  end

  script.on_event(defines.events.on_research_finished, function(e)
    if e.research.force.name ~= "player" then return end
    push({ kind = "research_finished", severity = "info", research = e.research.name })
  end)

  -- Events after `since`. `seq` is the newest sequence number; a gap means events were dropped.
  handlers.events = function(args)
    local s = state()
    local since = tonumber(args.since) or 0
    local out = {}
    for _, event in ipairs(s.list) do
      if event.seq > since then out[#out + 1] = event end
    end
    return { seq = s.seq, oldest = s.list[1] and s.list[1].seq or s.seq + 1, events = out }
  end
end
