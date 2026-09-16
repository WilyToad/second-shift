// FC-164: the companion's list on a read-only panel in the game. Runs against the hosted dev save.
// Usage: bun scripts/test-panel.ts
import { actions, encodeCommand, parseReply, type ActionName } from "../interfaces/src/index";
import { asChecks, saveEvalRun } from "./lib/eval-log";
import { connectDevGame } from "./lib/devgame";

const dev = await connectDevGame();
let id = 1;
const call = async (action: string, args: Record<string, unknown> = {}) => {
  const { reply, profile } = parseReply(await dev.rcon.exec(encodeCommand({ id: id++, action, args, profile: true })));
  const data = reply.ok && action in actions ? actions[action as ActionName].data.parse(reply.data) : reply.data;
  return { ...reply, data: data as any, profile };
};
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
/** What the panel shows, read back out of the game's own GUI. */
const panel = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1]
  local frame = p.gui.left["second-shift-list"]
  if not frame then rcon.print(helpers.table_to_json({ exists = false })) return end
  local labels, clickable = {}, 0
  local function walk(element)
    for _, child in pairs(element.children) do
      if child.type == "label" then labels[#labels + 1] = child.caption
      elseif child.type == "button" or child.type == "sprite-button" or child.type == "checkbox" or child.type == "textfield" then clickable = clickable + 1 end
      walk(child)
    end
  end
  walk(frame)
  rcon.print(helpers.table_to_json({ exists = true, caption = frame.caption, labels = labels, clickable = clickable }))`));

try {
  const items = [
    { text: "20 stone furnace", done: true, note: "have 24" },
    { text: "200 transport belt", done: false, note: "0 of 200 in reach" },
    { text: "100 coal", done: false, note: "stone-furnace burns fuel" },
  ];
  const set = await call("set_list", { name: "smelting outpost", items });
  const shown = await panel();
  check("the panel shows the list the companion pushed", set.ok && shown.exists && shown.caption === "smelting outpost" && shown.labels.length === items.length + 1,
    `${set.data?.shown} items in ${set.profile}; labels ${JSON.stringify(shown.labels)}`);
  check("done items are ticked and dimmed, and the count is there", String(shown.labels[0]).includes("1 of 3 done") && String(shown.labels[1]).includes("✔") && String(shown.labels[1]).includes("color=0.55"),
    `${shown.labels[0]} | ${shown.labels[1]}`);
  check("nothing in the panel is clickable", shown.clickable === 0, `${shown.clickable} clickable elements`);

  const hidden = await call("debug_toggle_list");
  const afterHide = await panel();
  check("the key hides it", hidden.data.shown === false && afterHide.exists === false, JSON.stringify(hidden.data));
  const reshown = await call("debug_toggle_list");
  check("and shows it again", reshown.data.shown === true && (await panel()).exists === true, JSON.stringify(reshown.data));

  const emptied = await call("set_list", { name: "smelting outpost", items: [] });
  check("an empty list leaves nothing on screen", emptied.ok && (await panel()).exists === false, JSON.stringify(emptied.data));
  // Long lists are capped, so the panel can't fill the screen.
  const many = Array.from({ length: 40 }, (_, i) => ({ text: `item ${i + 1}`, done: false }));
  await call("set_list", { name: "long list", items: many });
  const capped = await panel();
  check("a long list is capped with a note", capped.exists && capped.labels.length <= 27 && String(capped.labels.at(-1)).includes("more"), `${capped.labels.length} labels, last "${capped.labels.at(-1)}"`);
} finally {
  await call("set_list", { name: "", items: [] });
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("test-panel", asChecks(results), {})}`);
process.exit(failed.length ? 1 : 0);
