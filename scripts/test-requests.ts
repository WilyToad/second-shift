// FC-168: handing a packing list to the player's own bots. The companion keeps its requests in its own named
// section, so the player's own requests must come back untouched. Runs against the hosted dev save.
// Usage: bun scripts/test-requests.ts
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
/** Every section on the character's requester point, as the game sees it. */
const sections = async () => JSON.parse(await dev.sc(`local p = game.connected_players[1]
  local point = p.character and p.character.get_requester_point()
  if not point then rcon.print(helpers.table_to_json({ point = false })) return end
  local out = {}
  for _, section in pairs(point.sections) do
    local slots = {}
    for i = 1, section.filters_count do
      local slot = section.get_slot(i)
      if slot and slot.value then slots[#slots + 1] = { name = slot.value.name, min = slot.min, max = slot.max } end
    end
    out[#out + 1] = { group = section.group, active = section.active, manual = section.is_manual, slots = slots }
  end
  rcon.print(helpers.table_to_json({ point = true, sections = out, trash = point.trash_not_requested }))`));

await dev.leaveRemoteView();
// The player's own request, to prove it survives: a section of their own with one slot.
await dev.sc(`local p = game.connected_players[1] local point = p.character.get_requester_point()
  local mine = nil
  for _, section in pairs(point.sections) do if section.group == "player test" then mine = section end end
  mine = mine or point.add_section("player test")
  mine.set_slot(1, { value = { type = "item", name = "iron-plate", quality = "normal", comparator = "=" }, min = 7, max = 7 })
  rcon.print("set")`);
const before = await sections();

try {
  const network = await call("logistic_network");
  check("the network look says whether the player is in range", network.ok && typeof network.data.in_range === "boolean",
    `in range ${network.data?.in_range}, ${network.data?.available_robots}/${network.data?.robots} robots free, ${network.data?.total_kinds} kinds, trash-unrequested ${network.data?.trash_unrequested}; ${network.profile}`);
  if (!network.data?.in_range) {
    check("the player is in range of a network for the rest of this test", false, "stand inside roboport coverage and run it again");
  } else {
    const set = await call("set_requests", { items: [{ name: "transport-belt", count: 200 }, { name: "iron-gear-wheel", count: 50 }] });
    const after = await sections();
    const ours = (after.sections as any[]).find((s) => s.group === "Second Shift");
    const theirs = (after.sections as any[]).find((s) => s.group === "player test");
    check("the requests land in the companion's own section", set.ok && ours?.slots.length === 2 && ours.active === true,
      `${JSON.stringify(ours?.slots)}; ${set.profile}`);
    check("the player's own section is untouched", theirs?.slots.length === 1 && theirs.slots[0].name === "iron-plate" && theirs.slots[0].min === 7,
      JSON.stringify(theirs));
    check("it says what the network can and can't cover", set.ok && Array.isArray(set.data.set) && set.data.set.every((x: any) => typeof x.in_network === "number"),
      `${JSON.stringify(set.data?.set)}; short: ${JSON.stringify(set.data?.short)}`);
    check("trash-unrequested is only read, never set", after.trash === before.trash, `${before.trash} before, ${after.trash} after`);

    // A second list replaces our slots instead of piling up.
    await call("set_requests", { items: [{ name: "transport-belt", count: 50 }] });
    const replaced = (await sections()).sections.find((s: any) => s.group === "Second Shift");
    check("a new list replaces the old requests", replaced?.slots.length === 1 && replaced.slots[0].min === 50, JSON.stringify(replaced?.slots));

    const off = await call("clear_requests");
    const afterOff = (await sections()).sections.find((s: any) => s.group === "Second Shift");
    check("stopping switches the section off and leaves it in place", off.data.found === true && off.data.removed === false && afterOff?.active === false && afterOff?.slots.length === 1,
      JSON.stringify({ off: off.data, section: afterOff }));
    const removed = await call("clear_requests", { remove: true });
    const afterRemove = (await sections()).sections.find((s: any) => s.group === "Second Shift");
    check("clearing the list removes the section", removed.data.removed === true && afterRemove === undefined, JSON.stringify(removed.data));
    const nothing = await call("clear_requests");
    check("stopping with nothing set says so", nothing.ok && nothing.data.found === false, JSON.stringify(nothing.data));
  }
} finally {
  await dev.sc(`local p = game.connected_players[1] local point = p.character.get_requester_point()
    for _, section in pairs(point.sections) do
      if section.group == "player test" or section.group == "Second Shift" then point.remove_section(section.index) end
    end
    rcon.print("cleaned")`);
  dev.rcon.close();
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`Saved to ${await saveEvalRun("test-requests", asChecks(results), {})}`);
process.exit(failed.length ? 1 : 0);
