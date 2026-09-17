import { expect, test } from "bun:test";
import { DigestSchema, PrototypesSchema } from "@companion/interfaces";
import { grounded, namesIn, planetOf, stageFor, stageLines } from "./stages";

/** The dev save's own dump: the rows have to be true of a real modded save, not of a fixture. */
const real = PrototypesSchema.parse(await Bun.file(new URL("../../data/captures/prototypes.json", import.meta.url)).json());

const tech = (names: Record<string, boolean>) =>
  Object.fromEntries(Object.entries(names).map(([name, researched]) => [name, { researched, prerequisites: [], unlocks: [], count: 1, ingredients: [], seconds_per_unit: 5 }]));
const protos = (researched: Record<string, boolean>) => ({ ...real, technologies: { ...real.technologies, ...tech(researched) } });
const digest = (player?: { surface: string; character_surface?: string }, surfaces: string[] = [], machines = 0) =>
  DigestSchema.parse({
    tick: 1, research: { progress: 0, queue: [] }, alerts: [],
    ...(player ? { player: { name: "p", surface: player.surface, position: { x: 0, y: 0 }, ...(player.character_surface ? { character_surface: player.character_surface } : {}) } } : {}),
    machines: { progress: { machines, scanned: true, refresh_ticks: 60 }, stuck: [] },
    surfaces: surfaces.map((name) => ({ name, produced: [], consumed: [], science: [], age_ticks: 0 })),
  });

/** The gates in the order a real save researches them: everything up to `upto` is done, nothing after it. */
const GATES = ["automation-science-pack", "logistic-science-pack", "oil-gathering", "chemical-science-pack", "construction-robotics", "rocket-silo", "space-platform"];
const chain = (upto: number) => Object.fromEntries(GATES.map((gate, i) => [gate, i < upto])) as Record<string, boolean>;

test("FC-181: the technology axis picks one row, from the most advanced down", () => {
  const rows = ["before power", "first electricity", "green science", "oil", "blue science and rail", "bots", "rocket", "orbit"];
  rows.forEach((id, upto) => {
    expect(stageFor(protos({ ...chain(upto), "logistic-robotics": false }), digest()).row.id).toBe(id);
  });
  // Either robotics tech is the bots line, because either one unlocks a roboport.
  expect(stageFor(protos({ ...chain(4), "logistic-robotics": true }), digest()).row.id).toBe("bots");
});

test("FC-181: the surface wins over the technology, and a modded planet asks instead of guessing", () => {
  const late = { ...chain(GATES.length), "logistic-robotics": true };
  // Standing on Gleba with a silo at home is a Gleba question.
  expect(stageFor(protos(late), digest({ surface: "gleba" })).row.id).toBe("gleba");
  // Remote view doesn't move the player: the character's surface decides.
  expect(stageFor(protos(late), digest({ surface: "vulcanus", character_surface: "nauvis" })).row.id).toBe("orbit");
  // factorissimo's inner surface is still Nauvis, so the technology axis decides.
  expect(stageFor(protos(late), digest({ surface: "nauvis-factory-floor" })).row.id).toBe("orbit");
  expect(stageFor(protos(late), digest({ surface: "platform-1" })).row.id).toBe("platform");
  // maraxsis and cerys have no row of their own: it asks rather than giving Nauvis advice underwater.
  expect(stageFor(protos(late), digest({ surface: "maraxsis" })).row.id).toBe("unknown");
  expect(stageFor(protos(late), digest({ surface: "cerys" })).row.id).toBe("unknown");
  // Two planets producing, and the player on neither: interplanetary.
  expect(stageFor(protos(late), digest({ surface: "nauvis" }, ["gleba", "vulcanus"])).row.id).toBe("between planets");
  // One planet producing isn't a fleet yet.
  expect(stageFor(protos(late), digest({ surface: "nauvis" }, ["gleba"])).row.id).toBe("orbit");
});

test("FC-181: a save whose tree isn't this one falls through instead of claiming early game", () => {
  const conversion = { ...real, technologies: {} };
  expect(stageFor(conversion, digest({ surface: "nauvis" })).row.id).toBe("unknown");
  expect(stageFor(null, digest()).row.id).toBe("unknown");
  // The fallback says what it can still answer from, and claims no classic miss.
  expect(stageLines(stageFor(null, null)).join(" ")).toContain("ask what they're working towards");
});

test("FC-181: every name in every shipped row is in this save's own dump", () => {
  // The FC-171 lesson at load time: a row mentioning something this save doesn't have is withheld, not fixed up,
  // and "unknown" appearing here would be that withholding.
  const seen: string[] = [];
  for (let upto = 0; upto <= GATES.length; upto++) {
    const row = stageFor(protos({ ...chain(upto), "logistic-robotics": false }), digest({ surface: "nauvis" })).row;
    expect(row.id).not.toBe("unknown");
    seen.push(row.id);
  }
  for (const surface of ["platform-2", "vulcanus", "fulgora", "gleba", "aquilo"]) {
    const row = stageFor(protos(chain(GATES.length)), digest({ surface })).row;
    expect(row.id).not.toBe("unknown");
    seen.push(row.id);
  }
  const fleet = stageFor(protos(chain(GATES.length)), digest({ surface: "nauvis" }, ["gleba", "vulcanus"])).row;
  expect(fleet.id).toBe("between planets");
  seen.push(fleet.id);
  // Every authored row has now been selected once and survived the name check.
  expect(new Set(seen).size).toBe(14);
});

test("FC-181: name extraction, planet resolution and the scale overlay", () => {
  expect(namesIn("craft 50 iron-plate and steam-power unlocks itself")).toEqual(["iron-plate", "steam-power"]);
  expect(namesIn("hand-carrying coal is the classic miss")).toEqual([]); // English, not a prototype
  expect(planetOf("gleba")).toBe("gleba");
  expect(planetOf("nauvis-factory-floor")).toBe("nauvis");
  expect(planetOf("maraxsis")).toBeNull();
  // A row is only used when the save has everything it names.
  expect(grounded({ id: "x", lines: ["next: build a flux-capacitor"], register: "" }, real)).toBe(false);
  expect(grounded({ id: "x", lines: ["next: build a stone-furnace"], register: "" }, real)).toBe(true);
  // The overlay rides along with whichever row won, once, at megabase size.
  const big = stageFor(protos({ "space-platform": true }), digest({ surface: "gleba" }, [], 6000));
  expect(big.scale).toBe(true);
  expect(stageLines(big).filter((l) => l.startsWith("scale note:"))).toHaveLength(1);
  expect(stageLines(stageFor(protos({ "space-platform": true }), digest({ surface: "gleba" }, [], 2746))).some((l) => l.startsWith("scale note:"))).toBe(false);
});
