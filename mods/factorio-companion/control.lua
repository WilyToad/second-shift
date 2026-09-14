-- Factorio Companion: queries and player-equivalent actions for the companion app.
-- Everything goes through one RCON command: /companion {"id":..,"action":..,"args":{..}}.
-- The reply is one JSON line via rcon.print: {"id":..,"ok":true,"data":..} or {"id":..,"ok":false,"error":{..}}.

local PROTOCOL = 1
-- Bump when dump_prototypes changes shape, so the server's prototype cache refreshes.
local DUMP_VERSION = 6

local handlers = {}

handlers.ping = function()
  return { tick = game.tick }
end

handlers.info = function()
  return {
    protocol = PROTOCOL,
    dump_version = DUMP_VERSION,
    mod_version = script.active_mods["factorio-companion"],
    game_version = script.active_mods["base"],
    tick = game.tick,
    mods = script.active_mods,
    players = #game.connected_players,
  }
end

require("scripts.prototypes")(handlers)
require("scripts.digest")(handlers)
require("scripts.actions")(handlers)
require("scripts.events")(handlers)
require("scripts.machines").register(handlers)
require("scripts.planning")(handlers)

local function fail(id, code, message)
  return { id = id, ok = false, error = { code = code, message = message } }
end

local function dispatch(parameter)
  local parsed, req = pcall(helpers.json_to_table, parameter or "")
  if not parsed or type(req) ~= "table" then
    return fail(nil, "bad_request", "parameter must be a JSON object")
  end
  local handler = handlers[req.action]
  if not handler then
    return fail(req.id, "unknown_action", tostring(req.action))
  end
  local ok, result = pcall(handler, req.args or {})
  if not ok then
    if type(result) == "table" and result.code then return fail(req.id, result.code, result.message) end
    return fail(req.id, "handler_error", tostring(result))
  end
  return { id = req.id, ok = true, data = result }
end

commands.add_command("companion", "Factorio Companion API (used by the companion app over RCON)", function(command)
  if command.player_index then
    -- Only the app may call the API; a player typing it gets a hint instead.
    local player = game.get_player(command.player_index)
    if player then player.print("/companion is used by the Factorio Companion app.") end
    return
  end
  -- {"profile":true} appends a second line with the handler's Lua time (LuaProfiler can't be read as a number).
  local profiler = command.parameter and command.parameter:find('"profile"%s*:%s*true') and helpers.create_profiler() or nil
  local reply = helpers.table_to_json(dispatch(command.parameter))
  rcon.print(reply)
  if profiler then
    profiler.stop()
    rcon.print({ "", "profile ", profiler })
  end
end)
