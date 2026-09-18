// S06 acceptance through the real server: review a real blueprint and a deliberately broken copy.
// Needs bun run start + the dev save hosted.
import { blueprintsIn, decodeBlueprintString, encodeBlueprintString } from "../server/src/blueprint";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { openConsole } from "./lib/console";
import type { ServerMessage } from "../server/src/messages";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
const original = await dev.exportBlueprintAround(12);
const importedCount = await dev.importBlueprintCount(encodeBlueprintString(decodeBlueprintString(original)));
dev.rcon.close();

const record = decodeBlueprintString(original) as { blueprint: { entities: any[] } };
const bp = blueprintsIn(record)[0]!.blueprint;
const counts: Record<string, number> = {};
for (const e of bp.entities) counts[e.name] = (counts[e.name] ?? 0) + 1;
const [topName, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;

// Broken copy: an unknown entity, an overlapping duplicate, and an assembler set to a recipe it can't craft.
const broken = structuredClone(record);
const ents = broken.blueprint.entities;
const next = Math.max(...ents.map((e: any) => e.entity_number)) + 1;
const assembler = ents.find((e: any) => e.name.startsWith("assembling-machine"));
if (assembler) assembler.recipe = "bioflux";
ents.push({ entity_number: next, name: "quantum-widget-assembler", position: { x: 50.5, y: 50.5 } });
const dup = ents.find((e: any) => e.name === "steel-chest") ?? ents.find((e: any) => !/rail|belt|inserter/.test(e.name));
ents.push({ ...dup, entity_number: next + 1 });
const brokenString = encodeBlueprintString(broken);

const { ws, got, until, check, results } = await openConsole();
const ask = async (text: string) => {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const user = got.slice(from).find((m) => m.type === "user") as Extract<ServerMessage, { type: "user" }> | undefined;
  return { answer: got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join(""), user: user?.text ?? "", done };
};
check("re-encoded blueprint imports in-game with the same entity count", importedCount === bp.entities.length, `${importedCount}/${bp.entities.length}`);


const good = await ask(`Review this blueprint: ${original}`);
check("original: the chat shows a placeholder, not the raw string", !good.user.includes(original.slice(0, 40)), good.user);
const sketch = got.find((m) => m.type === "blueprint" && m.blueprint.string === original);
check("original: the page gets a layout sketch with the original string to copy", sketch?.type === "blueprint" && sketch.blueprint.sketch.length === bp.entities.length, sketch?.type === "blueprint" ? `${sketch.blueprint.sketch.length} entities drawn, ${sketch.blueprint.width}×${sketch.blueprint.height} tiles` : "no card");
check(`original: answer has the entity total and the top count (${topName} ${topCount})`, good.answer.includes(String(bp.entities.length)) && good.answer.includes(String(topCount)), good.answer.trim().slice(0, 400));
check("original: no invented problems", !/quantum|can't craft|cannot craft|\b(overlap|overlaps) (at|on)\b|(?<!no )problems? (found|:)|(?<!no )issues?:/i.test(good.answer), good.answer.trim());

const bad = await ask(`Anything wrong with this one? ${brokenString}`);
check("broken: names the unknown entity", /quantum-widget-assembler|quantum widget/i.test(bad.answer), bad.answer.trim().slice(0, 500));
check("broken: names the uncraftable recipe", !assembler || /bioflux/i.test(bad.answer));
check("broken: names the overlap", /overlap/i.test(bad.answer));

const turns = (await Bun.file(new URL("../data/eval/turns.jsonl", import.meta.url)).text()).trim().split("\n").slice(-2).map((l) => JSON.parse(l));
check("the raw strings never reached the model prompt", turns.every((t) => t.chars.question < 4000), `question sizes ${turns.map((t) => t.chars.question).join(", ")} chars (strings were ${original.length} and ${brokenString.length})`);
ws.close();
await saveEvalRun("blueprint", asChecks(results), { original: good.answer, broken: bad.answer });
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
