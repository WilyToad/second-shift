-- The event ring buffer behind the alert feed, shared by the modules that report events.
local MAX_EVENTS = 200

local feed = {}

function feed.state()
  storage.events = storage.events or { seq = 0, list = {}, counts = {} }
  return storage.events
end

function feed.push(event)
  local s = feed.state()
  s.seq = s.seq + 1
  event.seq = s.seq
  event.tick = game.tick
  s.list[#s.list + 1] = event
  if #s.list > MAX_EVENTS then table.remove(s.list, 1) end
end

return feed
