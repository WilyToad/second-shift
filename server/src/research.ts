// Patch cached prototype data with what research changed, instead of dumping every prototype again.
import type { ActionData, Prototypes } from "@companion/interfaces";

export type ResearchState = ActionData<"research_state">;

/** Returns data with enabled flags, productivity bonuses and researched flags taken from `state`, or the
 * same object when nothing changed. A state without `recipes`/`technologies` covers the whole force. */
export function applyResearchState(data: Prototypes, state: ResearchState): { data: Prototypes; changed: string[] } {
  const enabled = new Set(state.enabled_recipes);
  const researched = new Set(state.researched_technologies);
  const changed: string[] = [];
  let recipes = data.recipes;
  for (const name of state.recipes ?? Object.keys(data.recipes)) {
    const recipe = data.recipes[name];
    if (!recipe) continue; // hidden recipes aren't in the dump
    const bonus = state.productivity_bonus[name];
    if (recipe.enabled === enabled.has(name) && recipe.productivity_bonus === bonus) continue;
    if (recipes === data.recipes) recipes = { ...data.recipes };
    const next = { ...recipe, enabled: enabled.has(name) };
    if (bonus === undefined) delete next.productivity_bonus;
    else next.productivity_bonus = bonus;
    recipes[name] = next;
    changed.push(`recipe ${name}`);
  }
  let technologies = data.technologies;
  for (const name of state.technologies ?? Object.keys(data.technologies)) {
    const tech = data.technologies[name];
    if (!tech || tech.researched === researched.has(name)) continue;
    if (technologies === data.technologies) technologies = { ...data.technologies };
    technologies[name] = { ...tech, researched: researched.has(name) };
    changed.push(`technology ${name}`);
  }
  let inserter_bonuses = data.inserter_bonuses;
  const b = state.inserter_bonuses;
  if (b && (b.stack !== inserter_bonuses.stack || b.bulk !== inserter_bonuses.bulk)) {
    inserter_bonuses = b;
    changed.push("inserter bonuses");
  }
  return { data: changed.length ? { ...data, recipes, technologies, inserter_bonuses } : data, changed };
}
