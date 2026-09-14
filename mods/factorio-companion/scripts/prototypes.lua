-- Runtime view of what is actually loaded in this save (modded), for grounding the agent.
local util = require("scripts.util")
local try, sorted_keys = util.try, util.sorted_keys

return function(handlers)
  local MACHINE_TYPES = {
    "assembling-machine", "furnace", "rocket-silo", "mining-drill", "lab", "beacon",
    "transport-belt", "underground-belt", "splitter", "inserter",
    "boiler", "generator", "reactor", "agricultural-tower", "character",
  }

  handlers.dump_prototypes = function()
    local force = game.forces.player

    local recipes = {}
    for name, r in pairs(prototypes.recipe) do
      if not r.hidden then
        local fr = force.recipes[name]
        recipes[name] = {
          category = r.category,
          energy = r.energy,
          ingredients = r.ingredients,
          products = r.products,
          enabled = fr ~= nil and fr.enabled,
          surface_conditions = r.surface_conditions,
          maximum_productivity = r.maximum_productivity,
        }
      end
    end

    local items = {}
    for name, i in pairs(prototypes.item) do
      if not i.hidden then
        local spoil = try(function() return i.get_spoil_ticks() end) or 0
        items[name] = {
          type = i.type,
          stack_size = i.stack_size,
          fuel_value = i.fuel_value > 0 and i.fuel_value or nil,
          spoil_ticks = spoil > 0 and spoil or nil,
          spoil_result = i.spoil_result and i.spoil_result.name or nil,
          place_result = i.place_result and i.place_result.name or nil,
        }
      end
    end

    local fluids = {}
    for name, f in pairs(prototypes.fluid) do
      if not f.hidden then
        fluids[name] = { fuel_value = f.fuel_value > 0 and f.fuel_value or nil }
      end
    end

    local technologies = {}
    for name, t in pairs(prototypes.technology) do
      if not t.hidden then
        local unlocks = {}
        for _, effect in pairs(t.effects or {}) do
          if effect.type == "unlock-recipe" then unlocks[#unlocks + 1] = effect.recipe end
        end
        local ft = force.technologies[name]
        technologies[name] = {
          prerequisites = sorted_keys(t.prerequisites),
          unlocks = unlocks,
          count = try(function() return t.research_unit_count end),
          count_formula = try(function() return t.research_unit_count_formula end),
          ingredients = try(function() return t.research_unit_ingredients end),
          seconds_per_unit = try(function() return t.research_unit_energy / 60 end),
          trigger = try(function() return t.research_trigger end),
          researched = ft ~= nil and ft.researched,
        }
      end
    end

    local machines = {}
    for name, e in pairs(prototypes.get_entity_filtered({ { filter = "type", type = MACHINE_TYPES } })) do
      if not e.hidden then
        machines[name] = {
          type = e.type,
          size = { e.tile_width, e.tile_height },
          crafting_categories = e.crafting_categories and sorted_keys(e.crafting_categories) or nil,
          crafting_speed = try(function() return e.get_crafting_speed() end),
          module_slots = try(function() return e.module_inventory_size end),
          energy_usage = try(function() return e.energy_usage end),
          mining_speed = try(function() return e.mining_speed end),
          belt_speed = try(function() return e.belt_speed end),
        }
      end
    end

    -- Footprints of everything a player can build, for blueprint checks: tile size and collision box.
    local entities = {}
    for name, e in pairs(prototypes.entity) do
      if not e.hidden and e.items_to_place_this and #e.items_to_place_this > 0 then
        local box = e.collision_box
        entities[name] = {
          type = e.type,
          size = { e.tile_width, e.tile_height },
          collision = { box.left_top.x, box.left_top.y, box.right_bottom.x, box.right_bottom.y },
        }
      end
    end

    -- Things a player gathers rather than crafts: mined resources, harvested plants and fish, pumped tile
    -- fluids and asteroid chunks. Production planning stops expanding at these.
    local raw_set = {}
    local function add_products(props)
      if props and props.minable and props.products then
        for _, product in pairs(props.products) do raw_set[product.name] = true end
      end
    end
    for _, e in pairs(prototypes.get_entity_filtered({ { filter = "type", type = { "resource", "plant", "fish", "tree" } } })) do
      add_products(e.mineable_properties)
    end
    for _, tile in pairs(prototypes.tile) do
      if tile.fluid then raw_set[tile.fluid.name] = true end
    end
    for name in pairs(prototypes.asteroid_chunk) do raw_set[name] = true end
    local raw_resources = sorted_keys(raw_set)

    return { recipes = recipes, items = items, fluids = fluids, technologies = technologies, machines = machines, entities = entities, raw_resources = raw_resources }
  end
end
