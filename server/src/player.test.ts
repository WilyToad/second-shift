import { expect, test } from "bun:test";
import { PlayerStatusSchema, SurroundingsSchema } from "@companion/interfaces";
import { acceptedOffer, bearing, claimCorrections, craftableRecipes, lootNote, formatPlayerStatus, formatSurroundings, wantsPlayerStatus, wantsStartAdvice, wantsSurroundings } from "./player";

test("a short yes takes up the question the last answer offered", () => {
  const last = "Start by mining iron.\n\nWant me to look around to see what you built?";
  expect(acceptedOffer("yeah", last)).toBe("Want me to look around to see what you built?");
  expect(acceptedOffer("yes please", last)).not.toBeNull();
  expect(acceptedOffer("sure, go ahead", last)).not.toBeNull();
  expect(acceptedOffer("yeah", "Do you want me to look around for ore? Wider, say 64 tiles?\n\nThe wreckage holds plates.")).toBe("Do you want me to look around for ore? Wider, say 64 tiles?");
  expect(acceptedOffer("yeah", "You're on nauvis.")).toBeNull(); // nothing was offered
  expect(acceptedOffer("what can I craft right now?", last)).toBeNull(); // a new question, not a yes
  expect(acceptedOffer("yeah", undefined)).toBeNull();
});

test("first-hour questions fetch what the player has and sees", () => {
  for (const q of ["help me... what do I do?", "what should I do next?", "how do I get started?", "what should I build next?"]) {
    expect(wantsStartAdvice(q)).toBe(true);
    expect(wantsPlayerStatus(q)).toBe(true);
    expect(wantsSurroundings(q)).toBe(true);
  }
  for (const q of ["what can I craft right now?", "what's in my inventory?", "I just picked up a bunch of debris from a crashed ship!"]) expect(wantsPlayerStatus(q)).toBe(true);
  for (const q of ["yeah, look around", "I think I found some ore", "where's the nearest coal?", "what do you see?", "Want me to scan wider for ore? yeah"]) expect(wantsSurroundings(q)).toBe(true);
  for (const q of ["I just built something", "what did I just place?"]) {
    expect(wantsPlayerStatus(q)).toBe(true);
    expect(wantsSurroundings(q)).toBe(true);
  }
  for (const q of ["How do I craft agricultural science packs?", "What makes bioflux, and where can it be crafted?", "What's the recipe for carbon fiber?", "How much iron plate am I making? Chart it.", "Give me a blueprint for 120 gears a minute."]) {
    expect(wantsPlayerStatus(q)).toBe(false);
    expect(wantsSurroundings(q)).toBe(false);
  }
});

test("bearings use map directions: y grows southward", () => {
  expect(bearing({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe("10 tiles east");
  expect(bearing({ x: 0, y: 0 }, { x: 0, y: -12 })).toBe("12 tiles north");
  expect(bearing({ x: 0, y: 0 }, { x: -7, y: 7 })).toBe("10 tiles south-west");
  expect(bearing({ x: 3, y: 3 }, { x: 3, y: 4 })).toBe("right here");
});

test("player status lines: inventory, hand crafting and recent builds", () => {
  const status = PlayerStatusSchema.parse({
    character: true, surface: "nauvis", x: 0, y: 0,
    items: [{ name: "iron-plate", count: 8 }, { name: "wood", count: 4 }], total_items: 2,
    craftable: [{ name: "wooden-chest", count: 2 }, { name: "iron-gear-wheel", count: 4 }], more_craftable: false,
    crafting_queue: {},
    recent_builds: [{ name: "stone-furnace", ghost: false, surface: "nauvis", x: 5, y: 0, age_ticks: 600, still_there: true }],
  });
  const text = formatPlayerStatus(status).join("\n");
  expect(text).toContain("inventory (2 kinds): iron-plate 8, wood 4");
  expect(text).toContain("hand-craftable now from the inventory (most you could make): wooden-chest 2, iron-gear-wheel 4");
  expect(text).toContain("player's recent builds, newest first: stone-furnace 5 tiles east, 10 s ago");
  expect(formatPlayerStatus(status, { builds: false }).join("\n")).not.toContain("recent builds");
  const empty = formatPlayerStatus({ ...status, items: [], total_items: 0, craftable: [], more_craftable: false, recent_builds: [] }).join("\n");
  expect(empty).toContain("inventory (0 kinds): empty");
  expect(empty).toContain("hand-craftable now: nothing");
  expect(empty).toContain("recent builds: none recorded yet");
  expect(formatPlayerStatus({ ...status, character: false })[0]).toContain("no character");
});

test("surroundings lines name resources with amounts and where the nearest is", () => {
  const around = SurroundingsSchema.parse({
    surface: "nauvis", x: 0, y: 0, radius: 32,
    mine: {}, other: [{ name: "crash-site-spaceship-wreck-big-1", count: 1, x: -10, y: 0 }],
    resources: [{ name: "iron-ore", count: 300, amount: 245000, x: 0, y: -20 }],
    trees: 120, rocks: 3, enemies: 0, water_tiles: 0,
    salvage: [{ name: "iron-plate", count: 8 }], salvage_containers: 1,
  });
  const text = formatSurroundings(around).join("\n");
  expect(text).toContain("within 32 tiles of their character on nauvis");
  expect(text).toContain("- the player's own (built or owned): nothing");
  expect(text).toContain("iron-ore 300 tiles, 245k total (nearest 20 tiles north)");
  expect(text).toContain("crash-site-spaceship-wreck-big-1 1 (nearest 10 tiles west)");
  expect(text).toContain("trees 120, rocks 3, water tiles 0, enemies 0");
  expect(text).toContain("wreckage and other containers here hold only: iron-plate 8 (in 1; still inside the wreckage, not in the player's inventory; mining one by hand takes those items and nothing else)");
});

test("FC-139: resources looked for further out say so; craftable recipes come with their lines", () => {
  const around = SurroundingsSchema.parse({
    surface: "nauvis", x: 0, y: 0, radius: 32, resource_radius: 96,
    mine: {}, other: {}, resources: [{ name: "iron-ore", count: 120, amount: 60000, x: 70, y: 0 }],
    trees: 0, rocks: 0, enemies: 0, water_tiles: 0,
  });
  expect(formatSurroundings(around).join("\n")).toContain("- resources (none within 32 tiles, so looked out to 96): iron-ore 120 tiles, 60k total (nearest 70 tiles east)");
  const status = PlayerStatusSchema.parse({ character: true, surface: "nauvis", x: 0, y: 0, items: [], total_items: 0, craftable: [{ name: "iron-gear-wheel", count: 2 }], more_craftable: false, crafting_queue: [], recent_builds: [] });
  expect(craftableRecipes(status)).toEqual(["iron-gear-wheel"]);
  expect(craftableRecipes({ ...status, character: false })).toEqual([]);
  expect(craftableRecipes(null)).toEqual([]);
});

test("FC-141: wreckage loot gets a 'not scrap' note, unless the data really has scrap (Fulgora)", () => {
  const base = { surface: "nauvis", x: 0, y: 0, radius: 32, mine: [], other: [{ name: "crash-site-spaceship-wreck-big-1", count: 1, x: -20, y: 0 }], resources: [], trees: 0, rocks: 0, enemies: 0, water_tiles: 0 };
  const wreck = SurroundingsSchema.parse({ ...base, salvage: [{ name: "iron-plate", count: 8 }], salvage_containers: 1 });
  expect(lootNote(null, wreck)).toBe("wreckage loot is iron-plate: use those item names and never call it scrap");
  const fulgora = SurroundingsSchema.parse({ ...base, surface: "fulgora", salvage: [{ name: "iron-plate", count: 8 }], salvage_containers: 1, resources: [{ name: "scrap", count: 200, amount: 90000, x: 5, y: 5 }] });
  expect(lootNote(null, fulgora)).toBe("");
  expect(lootNote(null, SurroundingsSchema.parse({ ...base, salvage: [], salvage_containers: 0 }))).toBe("");
  expect(wantsSurroundings("I just picked up a bunch of debris from a crashed ship!")).toBe(true);
});

test("FC-140: counts and builds an answer gets wrong are corrected from the player's data", () => {
  const status = PlayerStatusSchema.parse({
    character: true, surface: "nauvis", x: 0, y: 0,
    items: [{ name: "iron-plate", count: 2 }, { name: "wood", count: 1 }, { name: "burner-mining-drill", count: 1 }], total_items: 3,
    craftable: [], more_craftable: false, crafting_queue: [],
    recent_builds: [{ name: "stone-furnace", ghost: false, surface: "nauvis", x: 3, y: 3, age_ticks: 60, still_there: true }],
  });
  const known = new Set(["iron-plate", "wood", "burner-mining-drill", "stone-furnace", "iron-gear-wheel", "burner-inserter", "transport-belt", "coal", "iron-ore"]);
  // Wrong: explicit statements about the pockets.
  expect(claimCorrections("You picked up 6 iron-plate — you now have 7 total.\n\nYour inventory: burner-mining-drill 1, wood 1, stone-furnace 1, iron-plate 7.", status, known)).toEqual(["Correction: your inventory has stone-furnace 0, iron-plate 2."]);
  expect(claimCorrections("You now have 5 iron plates and 2 iron gear wheels.", status, known)).toEqual(["Correction: your inventory has iron-plate 2, iron-gear-wheel 0."]);
  expect(claimCorrections("That leaves 9 wood in your inventory.", status, known)).toEqual(["Correction: your inventory has wood 1."]);
  expect(claimCorrections("You've built a burner-mining-drill 2 tiles east, right on the copper.", status, known)).toEqual(["Correction: no burner-mining-drill was built recently; your latest builds are stone-furnace."]);
  // Right, or not claims about the pockets (all seen in S25 eval answers).
  const fine = [
    "You have 2 iron plates and 1 wood. You placed a stone-furnace 4 tiles south-east.",
    "Once you have 50 iron plates, steam power unlocks. The wrecks hold 6 iron-plate.",
    "Craft your 1 iron-gear-wheel from the 2 iron-plate you have, then mine the wreckage west for the 4 iron-plate still inside.",
    "Nice haul — that's iron-plate 7 still sitting in the wreckage around you, plus the 1 already in your inventory.",
    "You have 3 plates, so 1 gear-wheel plus 1 transport-belt or burner-inserter.",
    "With 1 burner-mining-drill in your inventory, place the drill on the coal 73 tiles north or the iron-ore 97 tiles east.",
  ];
  for (const t of fine) expect([t, claimCorrections(t, status, known)]).toEqual([t, []]);
  // On a turn that isn't about the inventory, "you have 47 labs" is the factory.
  expect(claimCorrections("You have 47 labs idle on Gleba.", status, new Set([...known, "lab"]), { inventoryTurn: false })).toEqual([]);
  expect(claimCorrections("Your inventory has wood 9.", status, known, { inventoryTurn: false })).toEqual(["Correction: your inventory has wood 1."]);
});
