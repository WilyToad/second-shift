-- The helmet rule: the companion may only do what its player could do, from where they are.
-- Every action re-checks these when it runs, because the game may have changed since the preview.
local helmet = {}

-- Conservative remote-view rule (PLAN §8 Q10, FC-028): planning actions and searches only in chunks
-- the force can see right now (near a character or inside radar coverage), not in fog of war.
function helmet.visible(force, surface, position)
  return force.is_chunk_visible(surface, { x = math.floor(position.x / 32), y = math.floor(position.y / 32) })
end

-- Things a deconstruction planner can't mark, or that aren't the player's to mark.
local NOT_MARKABLE_TYPES = {
  ["character"] = true, ["construction-robot"] = true, ["logistic-robot"] = true, ["cargo-pod"] = true,
  ["rocket-silo-rocket"] = true, ["entity-ghost"] = true, ["tile-ghost"] = true, ["item-request-proxy"] = true,
  ["resource"] = true, ["cliff"] = true, ["fish"] = true, ["unit"] = true, ["unit-spawner"] = true,
}
local NEUTRAL_MARKABLE_TYPES = { ["tree"] = true, ["simple-entity"] = true, ["item-entity"] = true }

--- Returns nil if the player could mark this entity for deconstruction, otherwise a short reason code.
function helmet.why_not_deconstruct(player, entity)
  if not (entity and entity.valid) then return "gone" end
  if entity.surface ~= player.surface then return "other_surface" end
  if NOT_MARKABLE_TYPES[entity.type] then return "not_deconstructable" end
  local flags = entity.prototype.flags or {}
  if flags["not-deconstructable"] or not entity.minable then return "not_deconstructable" end
  local own = entity.force == player.force
  if not own and not (entity.force.name == "neutral" and NEUTRAL_MARKABLE_TYPES[entity.type]) then return "not_yours" end
  if not helmet.visible(player.force, entity.surface, entity.position) then return "not_visible" end
  return nil
end

return helmet
