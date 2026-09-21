-- The companion's list on a panel in the game (FC-164). Read-only by the player's choice: they show or hide it with
-- a key, and only the companion changes what's on it, so there are no buttons and no GUI events to handle.
--
-- Redrawn only when the list changes or the player toggles it: no per-tick work. Factorio's labels have no
-- strike-through, so a done item gets a tick and grey text instead.
local util = require("scripts.util")
local companion_player = util.companion_player

local FRAME = "second-shift-list"
local MAX_SHOWN = 25
local DONE_COLOUR = "[color=0.55,0.55,0.55]"
local TICK = "[color=0.35,0.75,0.45]✔[/color] "

local function state()
  storage.panel = storage.panel or { shown = true, name = "", items = {} }
  return storage.panel
end

local function destroy(player)
  local existing = player.gui.left[FRAME]
  if existing then existing.destroy() end
end

--- Draws the list as it stands. Nothing to show means nothing on screen.
local function draw(player)
  local s = state()
  destroy(player)
  if not s.shown or not s.name or s.name == "" or #s.items == 0 then return end
  -- An untracked item can never be ticked, so it is not part of the count: the panel has to say the same number
  -- the companion says (FC-246).
  local done, tracked = 0, 0
  for _, item in pairs(s.items) do
    if not item.untracked then
      tracked = tracked + 1
      if item.done then done = done + 1 end
    end
  end
  local frame = player.gui.left.add({ type = "frame", name = FRAME, direction = "vertical", caption = s.name })
  frame.add({ type = "label", caption = done .. " of " .. tracked .. " done", style = "bold_label" })
  local list = frame.add({ type = "flow", direction = "vertical" })
  for i, item in ipairs(s.items) do
    if i > MAX_SHOWN then break end
    local text = item.text
    if item.note and item.note ~= "" then text = text .. "  (" .. item.note .. ")" end
    if item.untracked then
      list.add({ type = "label", caption = "? " .. text })
    elseif item.done then
      list.add({ type = "label", caption = TICK .. DONE_COLOUR .. text .. "[/color]" })
    else
      list.add({ type = "label", caption = "○ " .. text })
    end
  end
  if #s.items > MAX_SHOWN then
    list.add({ type = "label", caption = "[color=0.55,0.55,0.55]+" .. (#s.items - MAX_SHOWN) .. " more[/color]" })
  end
end

local M = {}

function M.register(handlers)
  -- The key the player shows and hides it with; nothing else in the panel responds to them.
  script.on_event("second-shift-list", function(e)
    local player = companion_player()
    if not (player and player.index == e.player_index) then return end
    local s = state()
    s.shown = not s.shown
    draw(player)
    if not s.shown then player.print({ "", "[Ballast] list hidden (press again to show it)" }) end
  end)

  -- The server pushes the active list here whenever it changes (FC-163).
  handlers.set_list = function(args)
    local player = companion_player()
    local s = state()
    s.name = type(args.name) == "string" and args.name or ""
    s.items = {}
    for _, item in pairs(args.items or {}) do
      if type(item) == "table" and type(item.text) == "string" then
        s.items[#s.items + 1] = { text = item.text, done = item.done == true, note = type(item.note) == "string" and item.note or nil }
      end
    end
    if player then draw(player) end
    return { shown = #s.items, name = s.name }
  end

  -- Test tooling: the same toggle the key does (custom inputs can't be raised from script).
  handlers.debug_toggle_list = function()
    local player = companion_player()
    local s = state()
    s.shown = not s.shown
    if player then draw(player) end
    return { shown = s.shown }
  end
end

return M
