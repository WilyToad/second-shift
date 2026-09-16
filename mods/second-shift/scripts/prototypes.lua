-- Runtime view of what is actually loaded in this save (modded), for grounding the agent.
local util = require("scripts.util")
local try, sorted_keys = util.try, util.sorted_keys

return function(handlers)
  local MACHINE_TYPES = {
    "assembling-machine", "furnace", "rocket-silo", "mining-drill", "lab", "beacon",
    "transport-belt", "underground-belt", "splitter", "inserter",
    "boiler", "generator", "reactor", "agricultural-tower", "character",
  }

  -- Researched hand size bonuses: `stack` for ordinary inserters, `bulk` for bulk-type ones.
  local function inserter_bonuses(force)
    return { stack = force.inserter_stack_size_bonus, bulk = force.bulk_inserter_capacity_bonus }
  end

  -- What research can change: enabled recipes, recipe productivity bonuses and researched technologies.
  -- The server patches its cached dump with this instead of dumping everything again (~26 ms).
  -- With `technologies`, only those technologies and the recipes their effects touch (~0.05 ms; used
  -- after research completes). Without, the whole force (~1.3 ms, 1,404 recipes; used on connect,
  -- where it also catches recipes other mods enabled from scripts).
  handlers.research_state = function(args)
    local force = game.forces.player
    local bonuses = inserter_bonuses(force)
    -- Compact on purpose: a table per recipe made the whole-force reply 5.4 ms instead of 1.3 ms.
    local enabled, bonus, researched = {}, {}, {}
    local function recipe(name, fr)
      if fr.enabled then enabled[#enabled + 1] = name end
      local b = fr.productivity_bonus
      if b > 0 then bonus[name] = b end
    end
    local function technology(name, ft)
      if ft.researched then researched[#researched + 1] = name end
    end
    if not args.technologies then
      for name, fr in pairs(force.recipes) do recipe(name, fr) end
      for name, ft in pairs(force.technologies) do technology(name, ft) end
      return { enabled_recipes = enabled, productivity_bonus = bonus, researched_technologies = researched, inserter_bonuses = bonuses }
    end
    local recipes, technologies = {}, {}
    for _, name in ipairs(args.technologies) do
      local ft = force.technologies[name]
      if ft then
        technologies[#technologies + 1] = name
        technology(name, ft)
        for _, effect in pairs(ft.prototype.effects or {}) do
          local fr = (effect.type == "unlock-recipe" or effect.type == "change-recipe-productivity") and force.recipes[effect.recipe] or nil
          if fr then
            recipes[#recipes + 1] = effect.recipe
            recipe(effect.recipe, fr)
          end
        end
      end
    end
    return { recipes = recipes, technologies = technologies, enabled_recipes = enabled, productivity_bonus = bonus, researched_technologies = researched, inserter_bonuses = bonuses }
  end

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
          -- Explicit boolean: `x and true or nil` would turn false into nil.
          allows_productivity = (r.allowed_effects ~= nil and r.allowed_effects.productivity == true),
          productivity_bonus = (fr ~= nil and fr.productivity_bonus > 0) and fr.productivity_bonus or nil,
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
          -- Runs on fuel (biochamber, burner machines) rather than electricity. Explicit boolean.
          burner = e.burner_prototype ~= nil,
          base_productivity = try(function()
            local p = e.effect_receiver and e.effect_receiver.base_effect and e.effect_receiver.base_effect.productivity
            return (p and p > 0) and p or nil
          end),
        }
        if e.type == "inserter" then
          -- Swing speed, hand size and reach, for blueprint throughput. Positions are for facing north.
          local m = machines[name]
          m.rotation_speed = e.get_inserter_rotation_speed()
          m.bulk = e.bulk
          m.hand_bonus = e.inserter_stack_size_bonus
          m.pickup = { e.inserter_pickup_position[1] or e.inserter_pickup_position.x, e.inserter_pickup_position[2] or e.inserter_pickup_position.y }
          m.drop = { e.inserter_drop_position[1] or e.inserter_drop_position.x, e.inserter_drop_position[2] or e.inserter_drop_position.y }
        end
      end
    end

    -- Footprints of everything a player can build, for blueprint checks: tile size and collision box.
    local entities = {}
    for name, e in pairs(prototypes.entity) do
      if not e.hidden and e.items_to_place_this and #e.items_to_place_this > 0 then
        local box = e.collision_box
        -- A few facts the model would otherwise state from memory, which modded saves change (FC-160):
        -- how much a chest holds, which logistic job it does, how much fluid a tank takes.
        local inventory = e.get_inventory_size(defines.inventory.chest)
        local fluid = e.fluid_capacity
        -- Poles and beacons: how far they reach, so answers don't state base-game numbers on a modded save.
        local supply = e.type == "electric-pole" or e.type == "beacon"
        local supply_area = supply and e.get_supply_area_distance() or nil
        local wire_reach = e.type == "electric-pole" and e.get_max_wire_distance() or nil
        entities[name] = {
          type = e.type,
          size = { e.tile_width, e.tile_height },
          collision = { box.left_top.x, box.left_top.y, box.right_bottom.x, box.right_bottom.y },
          inventory_size = inventory and inventory > 0 and inventory or nil,
          logistic_mode = e.logistic_mode,
          fluid_capacity = fluid and fluid > 0 and math.floor(fluid) or nil,
          supply_area = supply_area,
          wire_reach = wire_reach,
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

    return {
      recipes = recipes, items = items, fluids = fluids, technologies = technologies, machines = machines, entities = entities, raw_resources = raw_resources,
      inserter_bonuses = inserter_bonuses(force),
    }
  end
end
