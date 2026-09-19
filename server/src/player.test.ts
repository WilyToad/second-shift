import { expect, test } from "bun:test";
import { PlayerStatusSchema, SurroundingsSchema } from "@companion/interfaces";
import { acceptedOffer, contentsTarget, correctedRequest, formatContents, formatMachineOutput, formatNetwork, formatPointedAt, formatSpidertrons, formatStock, wantsBotsToFill, wantsMeasuredOutput, wantsRequestsCleared, wantsStock, wantsSpidertronSent, wantsStop, wantsContents, wantsPointedAt, bearing, claimCorrections, craftableRecipes, lootNote, formatPlayerStatus, formatSurroundings, wantsPlayerStatus, wantsStartAdvice, wantsSurroundings } from "./player";

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
  expect(text).toContain("iron-ore 300 tiles, 245k total (nearest 20 tiles north at (0, -20))");
  expect(text).toContain("crash-site-spaceship-wreck-big-1 1 (nearest 10 tiles west at (-10, 0))");
  expect(text).toContain("trees 120, rocks 3, water tiles 0, enemies 0");
  expect(text).toContain("wreckage and other containers here hold only: iron-plate 8 (in 1; still inside the wreckage, not in the player's inventory; mining one by hand takes those items and nothing else)");
});

test("FC-139: resources looked for further out say so; craftable recipes come with their lines", () => {
  const around = SurroundingsSchema.parse({
    surface: "nauvis", x: 0, y: 0, radius: 32, resource_radius: 96,
    mine: {}, other: {}, resources: [{ name: "iron-ore", count: 120, amount: 60000, x: 70, y: 0 }],
    trees: 0, rocks: 0, enemies: 0, water_tiles: 0,
  });
  expect(formatSurroundings(around).join("\n")).toContain("- resources (none within 32 tiles, so looked out to 96): iron-ore 120 tiles, 60k total (nearest 70 tiles east at (70, 0))");
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

test("FC-154: a short correction or retry keeps the last question's request", () => {
  const last = "Where is the rocket salad can you point it out to me";
  for (const q of ["I meant the rocket silo", "no, the rocket silo", "No I meant the silo", "actually the silo", "not that, the silo", "try that again", "the other one"]) {
    expect(correctedRequest(q, last)).toBe(last);
  }
  for (const q of ["How many radars are near me", "Actually, how many radars are near me?", "What do I use these for", "yes please"]) {
    expect(correctedRequest(q, last)).toBeNull();
  }
  expect(correctedRequest("I meant the rocket silo", undefined)).toBeNull();
  expect(correctedRequest("no, the one I meant is the big rocket silo over there past the lake to the north", last)).toBeNull(); // a new question
});

test("FC-157: the same thing gets the same direction whether positions come floored or not", () => {
  // The silo case: a character at (8.6, -2.4) and a silo centre on the west/north-west boundary.
  const character = { x: 8.6, y: -2.4 }, silo = { x: -4.5, y: -7.5 };
  const floored = bearing({ x: Math.floor(character.x), y: Math.floor(character.y) }, { x: Math.floor(silo.x), y: Math.floor(silo.y) });
  expect(bearing(character, silo)).toBe(floored);
  const lines = formatSurroundings(SurroundingsSchema.parse({ surface: "nauvis", x: 8, y: -3, radius: 32, mine: [{ name: "rocket-silo", count: 1, x: -5, y: -8 }], resources: [], other: [], trees: 0, rocks: 0, water_tiles: 0, enemies: 0, salvage: [], salvage_containers: 0 }));
  expect(lines[1]).toBe(`- the player's own (built or owned): rocket-silo 1 (nearest ${floored} at (-5, -8))`);
});

test("FC-151: questions about what the player points at, holds or has open", () => {
  for (const q of ["Can you see what I have highlighted what is this", "No I have something I have something else highlighted now", "what am I pointing at?", "what's this I'm holding?", "what is this building", "what do I have open?"]) {
    expect(wantsPointedAt(q)).toBe(true);
  }
  for (const q of ["What do I have in my inventory", "How many radars are near me", "where is the rocket silo?"]) expect(wantsPointedAt(q)).toBe(false);
});

test("FC-151: pointed-at lines say what's under the mouse, last hovered, in hand and open, and 'nothing' when nothing is", () => {
  const chest = { name: "iron-chest", ghost: false, type: "container", surface: "nauvis", x: 4, y: -2, own: true };
  expect(formatPointedAt({ selected: chest, hand: { name: "transport-belt", count: 50 }, opened: { kind: "controller" } })).toEqual([
    "under the mouse now: iron-chest at (4, -2)",
    "in hand: transport-belt 50",
    "open window: the player's inventory screen",
  ]);
  const lines = formatPointedAt({ last_hovered: { ...chest, still_there: true, ago_ticks: 180 } });
  expect(lines).toContain("under the mouse now: nothing");
  expect(lines).toContain("last hovered: iron-chest at (4, -2), 3 s ago");
  expect(lines.join("\n")).not.toContain("nothing is pointed at");
  const none = formatPointedAt({});
  expect(none.at(-1)).toContain("nothing is pointed at: if they ask what \"this\" is, say you can't tell");
  expect(formatPointedAt({ last_hovered: { still_there: false, ago_ticks: 60 } })).toContain("last hovered: something that's gone now, 1 s ago");
});

test("FC-152: contents questions, the entity they mean, and the contents line", () => {
  for (const q of ["There's a chest right here in front of me what is in this red chest", "what's inside that wagon?", "what does the chest hold", "how many plates are in it?"]) expect(wantsContents(q)).toBe(true);
  for (const q of ["What do I have in my inventory", "what is this?"]) expect(wantsContents(q)).toBe(false);
  const chest = { name: "red-chest", ghost: false, type: "logistic-container", surface: "nauvis", x: 1, y: 2, own: true };
  expect(contentsTarget({ selected: chest })).toEqual(chest);
  expect(contentsTarget({ opened: { kind: "entity", entity: chest } })).toEqual(chest);
  expect(contentsTarget({ last_hovered: { ...chest, still_there: true, ago_ticks: 30 * 60 } })).toEqual({ name: "red-chest", x: 1, y: 2 });
  expect(contentsTarget({ last_hovered: { ...chest, still_there: true, ago_ticks: 5 * 60 * 60 } })).toBeNull();
  expect(contentsTarget(null, { name: "wooden-chest", x: 0, y: 0 })).toEqual({ name: "wooden-chest", x: 0, y: 0 });
  expect(formatContents({ entity: chest, items: [{ name: "iron-plate", count: 400 }, { name: "gear", count: 7, quality: "rare" }], total_kinds: 3, fluids: [] }))
    .toBe("inside the red-chest at (1, 2): iron-plate 400, gear (rare) 7 and 1 more kinds");
  expect(formatContents({ entity: { ...chest, name: "storage-tank", type: "storage-tank" }, items: [], total_kinds: 0, fluids: [{ name: "water", amount: 25000 }] }))
    .toBe("inside the storage-tank at (1, 2): no items; fluids: water 25000");
});

test("FC-160: the save's own facts about what's pointed at go in the lines", () => {
  const chest = { name: "passive-provider-chest", ghost: false, type: "logistic-container", surface: "nauvis", x: 1, y: 2, own: true };
  const lines = formatPointedAt({ selected: chest, hand: { name: "storage-tank", count: 7 } }, (name) =>
    name === "passive-provider-chest" ? "passive-provider-chest: logistic container; logistic job: passive provider; holds 48 stacks" : name === "storage-tank" ? "storage-tank: storage tank; holds 25,000 fluid" : null);
  expect(lines).toContain("from the save: passive-provider-chest: logistic container; logistic job: passive provider; holds 48 stacks");
  expect(lines).toContain("from the save: storage-tank: storage tank; holds 25,000 fluid");
  // Nothing invented when the save has no facts for it.
  expect(formatPointedAt({ selected: chest }, () => null).some((l) => l.startsWith("from the save"))).toBe(false);
});

test("FC-162: measuring questions, and what the measured lines say", () => {
  for (const q of ["is this build hitting 150 a minute?", "what's it really making?", "how much is this actually producing", "can you measure it?"]) {
    expect(wantsMeasuredOutput(q)).toBe(true);
  }
  for (const q of ["what's in this chest?", "how many radars are near me"]) expect(wantsMeasuredOutput(q)).toBe(false);
  const started = formatMachineOutput({ tick: 100, window_ticks: 0, machines: 4, not_visible: 0, recipes: [{ recipe: "iron-gear-wheel", machines: 4, finished: 900, sampled: 0 }] }, "the 4 assemblers from the last search");
  expect(started).toContain("started measuring 4 machines");
  expect(started).toContain("ask again in about a minute");
  const done = formatMachineOutput({ tick: 3700, window_ticks: 3600, machines: 4, not_visible: 0, recipes: [{ recipe: "iron-gear-wheel", machines: 4, finished: 1500, sampled: 4, per_minute: 149.6 }] }, "the 4 assemblers from the last search");
  expect(done).toBe("measured in the player's game over the last 60 s from the machines' own craft counts: iron-gear-wheel 150/min from 4 machines");
  expect(formatMachineOutput({ tick: 1, window_ticks: 0, machines: 0, not_visible: 3, recipes: [] }, "32 tiles around the player")).toContain("3 are somewhere they can't see");
});

test("FC-144 FC-051: the words that send a spidertron and the words that stop it", () => {
  for (const q of ["send my spidertron to the copper patch", "walk the spider over here", "can you send the spidertron to (120, -40)?", "move my spidertron to the iron ore"]) {
    expect(wantsSpidertronSent(q)).toBe(true);
  }
  for (const q of ["where is my spidertron?", "how many spidertrons do I have", "what is this spider thing"]) expect(wantsSpidertronSent(q)).toBe(false);
  for (const q of ["stop", "stop it", "please stop", "cancel that", "halt", "stop the spidertron"]) expect(wantsStop(q)).toBe(true);
  for (const q of ["what's stopping my iron production?", "why did the train stop", "stop the deconstruction of every belt I own and then tell me what else is wrong"]) expect(wantsStop(q)).toBe(false);
});

test("FC-144: spidertron lines come from the game, including the remote the player carries", () => {
  const lines = formatSpidertrons({ spidertrons: [
    { name: "spidertron", unit_number: 7, x: 10, y: -4, distance: 11, driver: false },
    { name: "spidertron", unit_number: 9, x: 90, y: 0, distance: 80, driver: true, walking_to: { x: 100, y: 0 } },
  ], total: 2, has_remote: true, surface: "gleba" });
  expect(lines[0]).toBe("the player's spidertrons on gleba, nearest first: spidertron at (10, -4), 11 tiles away; spidertron at (90, 0), 80 tiles away, someone is driving it, already walking to (100, 0)");
  expect(lines[1]).toContain("carries a spidertron remote");
  expect(formatSpidertrons({ spidertrons: [], total: 0, has_remote: false, surface: "nauvis" })).toEqual(["the player has no spidertron on nauvis"]);
});

test("FC-165: stock questions, and lines that say what's carried and where the rest is", () => {
  for (const q of ["where are my 200 steel?", "how many belts do I have around here", "do I have enough iron plate?", "what's in my chests?"]) {
    expect(wantsStock(q)).toBe(true);
  }
  for (const q of ["what's this chest?", "send my spidertron to the copper"]) expect(wantsStock(q)).toBe(false);
  const stock = {
    surface: "nauvis", radius: 48, x: 10, y: -4, free_slots: 12, containers: 6, not_visible: 2, total_kinds: 9,
    items: [
      { name: "steel-plate", count: 240, carried: 40, x: 20, y: -4, distance: 10, container: "steel-chest" },
      { name: "transport-belt", count: 100, carried: 100 },
      { name: "iron-gear-wheel", count: 60, carried: 0, x: 4, y: 8, distance: 13, container: "wooden-chest" },
    ],
    total: 3,
  } as any;
  const lines = formatStock(stock);
  expect(lines[0]).toContain("from 6 containers they can see (2 more are somewhere they can't see)");
  expect(lines[0]).toContain("steel-plate 240 (40 carried, the rest nearest in a steel-chest 10 tiles away at (20, -4))");
  expect(lines[0]).toContain("transport-belt 100 (all carried)");
  expect(lines[0]).toContain("iron-gear-wheel 60 (none carried, nearest in a wooden-chest 13 tiles away at (4, 8))");
  expect(lines[1]).toBe("9 kinds in reach in all; 12 free slots in the player's inventory");
  // Asking about one item narrows the line to it.
  expect(formatStock(stock, ["steel-plate"])[0]).not.toContain("transport-belt");
  expect(formatStock({ ...stock, items: [] }, ["steel-plate"])[0]).toContain("nothing the player can reach");
});

test("FC-168: the words that hand the list to the bots, and the network lines", () => {
  for (const q of ["get the bots to bring the rest", "can the robots fill it?", "fill the list", "request the missing items"]) {
    expect(wantsBotsToFill(q)).toBe(true);
  }
  for (const q of ["stop requesting", "clear the requests", "cancel the request"]) {
    expect(wantsRequestsCleared(q)).toBe(true);
    expect(wantsBotsToFill(q)).toBe(false);
  }
  expect(formatNetwork({ in_range: false, robots: 0, available_robots: 0, items: [], total_kinds: 0, trash_unrequested: false }))
    .toEqual(["the player isn't in range of their logistic network, so bots can't bring anything: say so rather than offering"]);
  const lines = formatNetwork({ in_range: true, network_id: 3, robots: 42, available_robots: 12, items: [{ name: "transport-belt", count: 900 }], total_kinds: 88, trash_unrequested: true });
  expect(lines[0]).toBe("the player's logistic network is in range: 12 of 42 logistic robots free, 88 item kinds in it");
  expect(lines[1]).toContain('"trash unrequested" on');
});

test("FC-222: standing among drills, the answer says they can't be counted rather than that they aren't there", async () => {
  const { formatMachineOutput } = await import("./player");
  const none = { tick: 1, window_ticks: 0, machines: 0, not_visible: 0, recipes: [], unmeasurable: { "mining-drill": 33 } };
  const line = formatMachineOutput(none, "32 tiles around the player");
  expect(line).toContain("no assemblers, furnaces or silos");
  expect(line).toContain("33 mining drills are there");
  expect(line).toContain("no per-machine craft count");
  // Nothing at all nearby reads as before.
  expect(formatMachineOutput({ ...none, unmeasurable: {} }, "32 tiles around the player")).not.toContain("are there");
});
