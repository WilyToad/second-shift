// The helmet rule read straight off the mod's source (FC-051): the companion may only use inputs the player has,
// so the engine's shortcuts must not appear in the mod at all. The in-game suites check behaviour;
// this catches a cheat the moment someone types it. `destroy()` isn't scanned: rendering objects and the
// temporary script inventories the blueprint code uses have the same method name, and the in-game suite already
// proves no action deletes an entity ("no instant-delete action exists", scripts/test-helmet.ts).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../mods/second-shift/scripts/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".lua"));

test("the mod never writes the engine's shortcuts for moving or making things", () => {
  const banned: [RegExp, string][] = [
    [/\bteleport\s*\(/, "teleport"],
    [/\.speed\s*=[^=]/, "writing speed"],
    [/\.orientation\s*=[^=]/, "writing orientation"],
    [/\bstop_spider\s*\(/, "stop_spider (it writes speed)"],
    [/\bcreate_entity\s*\(/, "create_entity"],
    [/\bcheat_mode\b/, "cheat mode"],
    [/\bgame\.speed\b/, "game speed"],
    [/\bforce\.research_all_technologies\b/, "instant research"],
  ];
  const found: string[] = [];
  for (const file of files) {
    // Comments explain why these are banned, so only code counts.
    const code = readFileSync(`${dir}${file}`, "utf8").split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
    for (const [pattern, what] of banned) if (pattern.test(code)) found.push(`${file}: ${what}`);
  }
  expect(found).toEqual([]);
  expect(files.length).toBeGreaterThan(8); // the scan really read the mod
});
