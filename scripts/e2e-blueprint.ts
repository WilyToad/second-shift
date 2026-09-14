// S06 acceptance through the real server: review a real blueprint and a deliberately broken copy.
// Needs bun run start + the dev save hosted.
import { blueprintsIn, decodeBlueprintString, encodeBlueprintString } from "../server/src/blueprint";
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

const ws = new WebSocket("ws://127.0.0.1:5170/ws");
const got: ServerMessage[] = [];
ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const until = async (pred: (m: ServerMessage) => boolean, ms: number, from = 0) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { const hit = got.slice(from).find(pred); if (hit) return hit; await Bun.sleep(50); }
  return null;
};
await until((m) => m.type === "status" && m.model.state === "ready", 120_000);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
check("re-encoded blueprint imports in-game with the same entity count", importedCount === bp.entities.length, `${importedCount}/${bp.entities.length}`);

const ask = async (text: string) => {
  ws.send(JSON.stringify({ type: "reset" }));
  await until((m) => m.type === "reset", 5000, got.length);
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text }));
  const done = await until((m) => m.type === "done" || m.type === "error", 120_000, from);
  const user = got.slice(from).find((m) => m.type === "user") as Extract<ServerMessage, { type: "user" }> | undefined;
  return { answer: got.slice(from).filter((m) => m.type === "token").map((m: any) => m.text).join(""), user: user?.text ?? "", done };
};

const good = await ask(`Review this blueprint: ${original}`);
check("original: the chat shows a placeholder, not the raw string", !good.user.includes(original.slice(0, 40)), good.user);
check(`original: answer has the entity total and the top count (${topName} ${topCount})`, good.answer.includes(String(bp.entities.length)) && good.answer.includes(String(topCount)), good.answer.trim().slice(0, 400));
check("original: no invented problems", !/quantum|can't craft|cannot craft|\b(overlap|overlaps) (at|on)\b|problems? (found|:)|issues?:/i.test(good.answer), good.answer.trim().slice(0, 200));

const bad = await ask(`Anything wrong with this one? ${brokenString}`);
check("broken: names the unknown entity", /quantum-widget-assembler|quantum widget/i.test(bad.answer), bad.answer.trim().slice(0, 500));
check("broken: names the uncraftable recipe", !assembler || /bioflux/i.test(bad.answer));
check("broken: names the overlap", /overlap/i.test(bad.answer));

const turns = (await Bun.file(new URL("../data/eval/turns.jsonl", import.meta.url)).text()).trim().split("\n").slice(-2).map((l) => JSON.parse(l));
check("the raw strings never reached the model prompt", turns.every((t) => t.chars.question < 4000), `question sizes ${turns.map((t) => t.chars.question).join(", ")} chars (strings were ${original.length} and ${brokenString.length})`);
ws.close();
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
