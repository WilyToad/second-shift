-- Small helpers shared by the companion's modules.
local util = {}

-- Returns fn(...) or nil if it errors (some prototype properties only exist for certain types).
function util.try(fn, ...)
  local ok, value = pcall(fn, ...)
  if ok then return value end
  return nil
end

function util.sorted_keys(dict)
  local out = {}
  if dict then
    for key in pairs(dict) do out[#out + 1] = key end
    table.sort(out)
  end
  return out
end

-- The player the companion rides along with: the first connected player.
function util.companion_player()
  return game.connected_players[1]
end

-- script.on_nth_tick(n, f) replaces any earlier handler for the same n, so modules register here
-- and share one dispatcher per interval.
local nth_tick_handlers = {}
function util.on_nth_tick(n, fn)
  if not nth_tick_handlers[n] then
    nth_tick_handlers[n] = {}
    script.on_nth_tick(n, function(event)
      for _, handler in ipairs(nth_tick_handlers[n]) do handler(event) end
    end)
  end
  table.insert(nth_tick_handlers[n], fn)
end

--- Raises an error the dispatcher turns into {"ok":false,"error":{"code":code,"message":message}}.
function util.reject(code, message)
  error({ code = code, message = message }, 0)
end

return util
