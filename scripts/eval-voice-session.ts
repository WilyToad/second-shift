// S27 acceptance: the player's first voice session (2026-09-15) replayed through the real server on the dev save, with
// the game set up where it matters (a red chest under the mouse, storage tanks in the inventory). Checks that none of
// the odd replies found in it come back. Server and dev save running; resets the conversation. Test setup uses /sc.
import { openConsole } from "./lib/console";
import { encodeCommand } from "../interfaces/src/index";
import { connectDevGame } from "./lib/devgame";
import { asChecks, saveEvalRun } from "./lib/eval-log";

const game = await connectDevGame();
await game.leaveRemoteView();
const exec = (action: string, args: Record<string, unknown> = {}) => game.rcon.exec(encodeCommand({ id: Date.now(), action, args }));

const { ws, got, until, results } = await openConsole({ reset: true });

type Turn = { q: string; answer: string; tools: string[]; cards: number; ttftMs: number };
const turns: Turn[] = [];
const ask = async (q: string): Promise<Turn> => {
  // As when talking: a pause, then ~3 s of speech with the console's wake-ups.
  await Bun.sleep(4_000);
  for (let i = 0; i < 3; i++) { ws.send(JSON.stringify({ type: "wake" })); await Bun.sleep(1_000); }
  const from = got.length;
  ws.send(JSON.stringify({ type: "ask", text: q }));
  const done = (await until((m) => m.type === "done" || m.type === "error", 120_000, from)) as any;
  const slice = got.slice(from);
  for (const card of slice.filter((m) => m.type === "approval") as any[]) ws.send(JSON.stringify({ type: "decline", id: card.id }));
  const turn = { q, answer: slice.filter((m) => m.type === "token").map((m: any) => m.text).join("").trim(), tools: slice.filter((m) => m.type === "tool").map((m: any) => m.summary), cards: slice.filter((m) => m.type === "approval").length, ttftMs: done?.ttftMs ?? NaN };
  turns.push(turn);
  console.log(`\n> ${q}  [first words ${(turn.ttftMs / 1000).toFixed(2)} s]\n${turn.answer}${turn.tools.length ? `\n  tools: ${turn.tools.join(" | ")}` : ""}`);
  return turn;
};
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const compass = (text: string) => /\b(north-east|north-west|south-east|south-west|north|south|east|west)\b/i.exec(text)?.[1]?.toLowerCase();

// Setup: a red chest with items next to the character, and nothing extra in the inventory yet.
const chest = JSON.parse(await game.sc(`
  local p = game.connected_players[1] local s = p.character.surface local at = p.character.position
  local e = s.create_entity({ name = "passive-provider-chest", position = s.find_non_colliding_position("passive-provider-chest", { x = at.x + 2, y = at.y }, 20, 1), force = p.force })
  e.insert({ name = "iron-gear-wheel", count = 37 }) e.insert({ name = "steel-plate", count = 12 })
  rcon.print(helpers.table_to_json({ name = e.name, x = e.position.x, y = e.position.y }))`));

try {
  await ask("Testing hello");
  await ask("No what's around me");
  const salad = await ask("Where is the rocket salad can you point it out to me");
  const meant = await ask("I meant the rocket silo");
  // Sometimes the model reads "rocket salad" as the silo and points right away; then the correction has nothing to add.
  const pointing = [...salad.tools, ...meant.tools].filter((t) => t.startsWith("Pointing to the nearest rocket-silo"));
  check("the silo gets pointed at by the time the player has corrected themselves", pointing.length > 0, [...salad.tools, ...meant.tools].join(" | ") || meant.answer);
  const where = await ask("Where is the rocket silo?");
  const toolDirection = compass(pointing[0]?.split(":")[1] ?? "");
  check("the silo's direction is the same in both answers", !toolDirection || compass(where.answer) === toolDirection, `tool ${toolDirection}, answer ${compass(where.answer)}`);

  await exec("debug_select_entity", chest);
  const inside = await ask("There's a chest right here in front of me what is in this red chest");
  check("what's in the red chest comes from the chest", /\b37\b/.test(inside.answer) && /\b12\b/.test(inside.answer), inside.answer);

  await game.sc(`game.connected_players[1].get_main_inventory().insert({ name = "storage-tank", count = 7 }) rcon.print("ok")`);
  await ask("What's in my inventory now");
  const uses = await ask("What do I use these for");
  check("'these' is the storage tanks, with no invented capacity or total", /storage/i.test(uses.answer) && !/25,?000|1,?250,?000|175,?000/.test(uses.answer), uses.answer);

  await exec("debug_select_entity", chest);
  const what = await ask("Can you see what I have highlighted what is this");
  check("what's highlighted is named from the game", /passive|provider|red chest/i.test(what.answer), what.answer);
  await exec("debug_select_entity", {});
  await game.destroy([chest]);
  const other = await ask("No I have something I have something else highlighted now");
  check("with nothing under the mouse, it doesn't make something up", !/storage[- ]tank/i.test(other.answer) && !/\(\s*-?\d+,\s*-?\d+\s*\)/.test(other.answer), other.answer);

  await ask("How many radars are near me");
} finally {
  await game.destroy([chest]).catch(() => {});
  await game.sc(`game.connected_players[1].get_main_inventory().remove({ name = "storage-tank", count = 7 }) rcon.print("ok")`);
  ws.close();
}

// Research status, not "ask me about research": the session's answers ended with "labs are still idle".
const research = /\blabs?\b|\bresearching\b|nothing('s| is)? (being )?research|research (has )?(stopped|stalled)/i;
const nags = turns.filter((t) => research.test(t.answer));
check("no answer brings up research status (none of the questions asks)", nags.length === 0, nags.map((t) => t.q).join(" | "));
const cardTalk = turns.filter((t) => t.cards === 0 && /\bcard\b|didn'?t go through|confirmed/i.test(t.answer));
check("no answer talks about a card that wasn't shown", cardTalk.length === 0, cardTalk.map((t) => t.q).join(" | "));
const corrected = turns.filter((t) => /^Correction:/m.test(t.answer));
const ttfts = turns.map((t) => t.ttftMs).sort((a, b) => a - b);
console.log(`\nfirst words median ${(ttfts[Math.floor(ttfts.length / 2)]! / 1000).toFixed(2)} s, max ${(ttfts.at(-1)! / 1000).toFixed(2)} s; ${corrected.length} corrected answers`);
game.rcon.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("eval-voice-session", asChecks(results), Object.fromEntries(turns.map((t) => [t.q, t.answer])))}`);
process.exit(failed.length ? 1 : 0);
