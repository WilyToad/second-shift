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

    return { recipes = recipes, items = items, fluids = fluids, technologies = technologies, machines = machines }
  end
end
