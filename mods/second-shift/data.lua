-- Prototypes for the companion's in-game pieces: a selection tool (from a shortcut) to show it a build.
local icon = "__base__/graphics/icons/blueprint.png"

data:extend({
  -- Push to talk from the game (FC-147): the console on the second monitor starts listening. Rebindable under
  -- Controls → Mods. Alt+V matches the console's own shortcut.
  {
    type = "custom-input",
    name = "second-shift-talk",
    key_sequence = "ALT + V",
    consuming = "none",
    order = "a",
  },
  -- Stop key (FC-051): cancels anything the companion started moving. Rebindable under Controls → Mods.
  {
    type = "custom-input",
    name = "second-shift-stop",
    key_sequence = "ALT + X",
    consuming = "none",
    order = "b",
  },
  {
    type = "selection-tool",
    name = "companion-selection-tool",
    icon = icon,
    icon_size = 64,
    flags = { "only-in-cursor", "not-stackable", "spawnable" },
    hidden = true,
    stack_size = 1,
    select = { border_color = { 0.49, 0.77, 0.85 }, cursor_box_type = "copy", mode = { "any-entity" } },
    alt_select = { border_color = { 0.49, 0.77, 0.85 }, cursor_box_type = "copy", mode = { "any-entity" } },
  },
  {
    type = "shortcut",
    name = "companion-select-build",
    order = "z[companion]",
    action = "spawn-item",
    item_to_spawn = "companion-selection-tool",
    icon = icon,
    icon_size = 64,
    small_icon = icon,
    small_icon_size = 64,
  },
})
