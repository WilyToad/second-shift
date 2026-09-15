import { expect, test } from "bun:test";
import { PlayerStatusSchema, SurroundingsSchema } from "@companion/interfaces";
import { acceptedOffer, bearing, craftableRecipes, formatPlayerStatus, formatSurroundings, wantsPlayerStatus, wantsStartAdvice, wantsSurroundings } from "./player";

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
  for (const q of ["yeah, look around", "I think I found some ore", "where's the nearest coal?", "what do you see?"]) expect(wantsSurroundings(q)).toBe(true);
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
  expect(text).toContain("wreckage and other containers here hold only: iron-plate 8 (in 1; mining one by hand takes those items and nothing else: call them by these names, not scrap)");
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
