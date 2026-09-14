// Pasted blueprint strings are replaced by compact, checked summaries before the model sees them (FC-032).
import type { Prototypes } from "@companion/interfaces";
import { blueprintsIn, BlueprintStringError, decodeBlueprintString } from "./blueprint";
import { checkBlueprint, describeIssue } from "./blueprint-check";

const PASTED = /0[A-Za-z0-9+/]{60,}={0,2}/g;
const MAX_BLUEPRINTS = 5;

const top = (counts: Record<string, number>, n: number) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");

export function summarizePasted(question: string, prototypes: Prototypes | null): { question: string; display: string; summaries: string[]; raws: string[] } {
  const summaries: string[] = [];
  let index = 0;
  const replace = (label: string) => (text: string) => text.replace(PASTED, () => `[${label} ${++index}]`);
  const matches = question.match(PASTED) ?? [];
  if (matches.length === 0) return { question, display: question, summaries, raws: [] };

  matches.forEach((raw, i) => {
    const n = i + 1;
    try {
      const record = decodeBlueprintString(raw);
      const all = blueprintsIn(record);
      if (all.length === 0) { summaries.push(`[pasted blueprint ${n}: a planner or empty book, no blueprints to review]`); return; }
      const lines = all.slice(0, MAX_BLUEPRINTS).map(({ path, blueprint }) => {
        if (!prototypes) return `${path}: ${blueprint.entities.length} entities (save data not loaded, so it wasn't checked)`;
        const r = checkBlueprint(blueprint, prototypes);
        const recipes = Object.keys(r.recipes).length ? ` | recipes: ${top(r.recipes, 8)}` : "";
        const checks = r.issues.length ? ` | problems: ${r.issues.map(describeIssue).join("; ")}` : " | checks: no problems found";
        const skipped = r.skippedOverlap ? ` (${r.skippedOverlap} rails/signals not overlap-checked)` : "";
        return `${path}: ${r.size.width}×${r.size.height} tiles, ${r.entities} entities: ${top(r.counts, 12)}${recipes}${checks}${skipped}`;
      });
      const more = all.length > MAX_BLUEPRINTS ? ` (+${all.length - MAX_BLUEPRINTS} more blueprints in the book)` : "";
      summaries.push(`[pasted blueprint ${n}, checked against this save]\n${lines.join("\n")}${more}`);
    } catch (e) {
      summaries.push(`[pasted text ${n} looks like a blueprint string but couldn't be read: ${e instanceof BlueprintStringError ? e.message : "decode failed"}]`);
    }
  });
  index = 0;
  const cleaned = replace("pasted blueprint")(question);
  index = 0;
  return { question: cleaned, display: replace("blueprint")(question), summaries, raws: matches };
}
