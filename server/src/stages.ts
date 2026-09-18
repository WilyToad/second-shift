// Where the player is in the game, and what to push for there (FC-180's table, FC-181's selection).
//
// Every goal below is text a human wrote. None of it is generated, because the model's Factorio memory is vanilla
// 1.1 and this save isn't: `basic-oil-processing` here makes petroleum gas and nothing else, so the famous
// heavy-oil stall belongs a row later than memory would put it. The row is chosen by conditions the save can prove
// — which technologies are researched, which surface the character stands on, which surfaces are producing — and a
// row whose own names aren't in this save's dump is withheld rather than shipped wrong (the FC-171 lesson).
//
// Only the matched row rides in the turn's tail, and only on a "what should I do" turn: the whole table is ~2,650
// tokens and the stable prefix has no room for it (PLAN §6 measured what overshooting a cache block costs).
import type { Digest, Prototypes } from "@companion/interfaces";
import { ENGLISH, triggerName } from "./names";

export type StageRow = { id: string; lines: string[]; register: string };

const ROWS: Record<string, StageRow> = {
  N1: {
    id: "before power",
    lines: [
      "next: two burner-mining-drill feeding a pair of stone-furnace, coal on a belt, not in your hands; craft 50 iron-plate and steam-power unlocks itself; craft 10 copper-plate and electronics does",
      "classic miss: mining by hand long after two drills would have paid for themselves",
    ],
    register: "it has flown starships and is counting rocks: dry, unhurried",
  },
  N2: {
    id: "first electricity",
    lines: [
      "next: offshore-pump, boiler, steam-engine, in that order, before anything else electric; electric-mining-drill on iron and copper; feed the labs with an inserter, not by hand — automation-science-pack is 1 copper-plate + 1 iron-gear-wheel and an assembling-machine-1 can make it",
      "classic miss: hand-carrying coal, when the boiler, the drills and the furnaces all want it on the same belt",
    ],
    register: "mildly surprised the arithmetic worked",
  },
  N3: {
    id: "green science",
    lines: [
      "next: steel-processing, then a second smelter column — steel-plate is 5 iron-plate, so it doubles your iron demand; automation-2 and logistics-2 for the machine and belt tier; logistic-science-pack is 1 transport-belt + 1 inserter, so belts and inserters get their own assemblers now",
      "classic miss: building tight around the first furnaces; leave the iron-plate, copper-plate, steel-plate and coal lanes room to widen, because they all will",
    ],
    register: "starts saying \"the factory\" instead of \"your pile\"",
  },
  N4: {
    id: "oil",
    lines: [
      "next: a pumpjack and an oil-refinery on basic-oil-processing — in this save that recipe makes petroleum-gas and nothing else (100 crude-oil to 45 petroleum-gas); then plastic-bar (1 coal + 20 petroleum-gas) and sulfur-processing (sulfuric-acid is 1 iron-plate + 5 sulfur + 100 water); those two get you advanced-circuit, and chemical-science-pack is 1 sulfur + 3 advanced-circuit + 2 engine-unit",
      "classic miss: treating this as a plumbing problem — blue science here is a circuit problem, and the famous full-heavy-oil-tank stall can't happen yet, because basic-oil-processing makes no heavy-oil in this save",
    ],
    register: "fluid routing: its actual field, at last",
  },
  N5: {
    id: "blue science and rail",
    lines: [
      "next: advanced-oil-processing plus heavy-oil-cracking and light-oil-cracking — now heavy-oil can fill a tank and stop the refinery, so every fluid needs an exit; railway then automated-rail-transportation for train-stop, rail-signal and rail-chain-signal, and put the first ore outpost on rail; robotics wants battery and electric-engine, and electric-engine-unit needs 15 lubricant, so lubricant comes first",
      "classic miss: signals — a plain rail-signal where a rail-chain-signal belongs deadlocks the junction, and an outpost with no stop limit pulls every train to one mine",
    ],
    register: "traffic control: it has opinions about traffic and finally shares them",
  },
  N6: {
    id: "bots",
    lines: [
      "next: roboport coverage over the mall first — from here a pasted blueprint builds itself; you only have passive-provider-chest and storage-chest for now, because requester-chest and buffer-chest come with logistic-system, which needs space-science-pack; production-science-pack is 30 rail + 1 electric-furnace + 1 productivity-module, so rails and modules need real lines, not hand-crafting",
      "classic miss: moving the main bus onto logistic robots; bots are for the mall and the last few tiles, and a belt lane still moves more iron for less power",
    ],
    register: "says \"we\" for the first time, and doesn't remark on it",
  },
  N7: {
    id: "rocket",
    lines: [
      "next: size processing-unit, low-density-structure and rocket-fuel together, because a rocket-part is one of each; a cargo-landing-pad (25 steel-plate, 10 processing-unit, 200 concrete) before the first launch, or what comes back has nowhere to land; stock space-platform-foundation deep — it's 20 steel-plate + 20 copper-cable each and the platform eats it",
      "classic miss: launching before there's a plan for the return trip, and underbuilding concrete and processing-unit, which the silo and the landing pad both want by the hundred",
    ],
    register: "quietly proprietary about the silo, and doesn't mention the ship",
  },
  N8: {
    id: "orbit",
    lines: [
      "next: asteroid-collector and crusher on the platform, with gun-turret ammo pointing where you're going; space-science-pack is 1 ice + 2 iron-plate + 1 carbon, so all three chunk types have to be crushed, not just the metallic ones; then space-platform-thruster, then pick one planet and commit to it",
      "classic miss: a platform that flies before it can feed its own turrets",
    ],
    register: "back in orbit, insufferably at home",
  },
  N8b: {
    id: "between planets",
    lines: [
      "next: one platform per route with its own schedule, not one platform doing everything; request at the destination, because the platform's own requests decide what it waits for; keep a trip's worth of thruster-fuel, thruster-oxidizer and ammo aboard before you need it, and put the labs where the packs are made rather than shipping every pack home",
      "classic miss: a platform waiting forever for a request the origin planet never fills",
    ],
    register: "fleet logistics, the job it was demoted from: very slightly smug",
  },
  SP: {
    id: "platform",
    lines: [
      "next: ammo and repair before speed, because the leading edge takes the damage; one crusher per chunk type — metallic, carbonic, oxide — so nothing dead-ends; check thruster-fuel and thruster-oxidizer against the whole trip, not the current burn, and put asteroid-reprocessing on the surplus rather than voiding it",
      "classic miss: widening the front of the platform, which catches more asteroids than the guns can shoot",
    ],
    register: "at home, and corrects your orbital phrasing",
  },
  V: {
    id: "vulcanus",
    lines: [
      "next: calcite-processing, then tungsten-carbide by mining a big-volcanic-rock, which opens foundry; once the foundry is up, molten-iron-from-lava (1 calcite + 500 lava gives 250 molten-iron and 10 stone) replaces ore smelting outright — cast plates, gears, pipe and low-density-structure; then big-mining-drill and tungsten-steel for metallurgic-science-pack",
      "classic miss: shipping iron-ore here; lava and calcite are the ore on Vulcanus, and calcite is the one thing that runs out",
    ],
    register: "approves of Vulcanus: everything here is a furnace",
  },
  F: {
    id: "fulgora",
    lines: [
      "next: recycling, by mining a fulgoran-ruin-vault, then holmium-processing; scrap-recycling turns 1 scrap into twelve different things, so every one of them needs an exit before you scale — a recycler loop for the ones you don't want; lightning-rod power before anything that has to run unattended; then electromagnetic-plant (it wants 50 holmium-plate crafted) for electromagnetic-science-pack",
      "classic miss: one byproduct with nowhere to go stalls the whole scrap line; sort first and recycle the remainder — concrete, ice and stone are usually the ones that fill up",
    ],
    register: "ruins and lightning: it finds the place tasteless, and says so once",
  },
  G: {
    id: "gleba",
    lines: [
      "next: agriculture by mining an iron-stromatolite, then jellynut and yumako, then biochamber once you've crafted 10 nutrients; size every buffer in seconds, not stacks — nutrients spoil in 5 minutes, yumako-mash in 3, jelly in 4; send the surplus to burnt-spoilage and a heating-tower instead of a chest, and remember agricultural-science-pack (1 bioflux + 1 pentapod-egg) spoils in an hour, so ship it or use it",
      "classic miss: buffering — a full chest of fruit on Gleba is a full chest of spoilage later, and a biochamber whose inserter stops starves of nutrients within minutes",
    ],
    register: "everything here rots, which it finds professionally offensive",
  },
  A: {
    id: "aquilo",
    lines: [
      "next: heat before anything else — heating-tower, heat-pipe, heat-exchanger, and fuel for them, because nothing here burns until you make it; then lithium-processing by mining a lithium-iceberg-big, and cryogenic-plant once you've crafted a lithium-plate; ammoniacal-solution-separation gives ice and ammonia, and solid-fuel-from-ammonia keeps the towers lit; cryogenic-science-pack is 3 ice + 1 lithium-plate + 6 fluoroketone-cold",
      "classic miss: arriving without fuel aboard; everything on Aquilo needs heat first, and that includes the machines that would have made the fuel",
    ],
    register: "cold, dark and quiet: it likes it here, which is worrying",
  },
  unknown: {
    id: "unknown",
    lines: [
      "next: ask what they're working towards — this save's technology names don't match anything known, so answer only from what the save shows: what's researchable now, what's stuck, and what they're carrying",
      "classic miss: none claimed for this save",
    ],
    register: "unfamiliar territory: it says so plainly and asks",
  },
};

/** At this size, more machines on a full lane buys nothing (FC-161, FC-162). Appended to whichever row won. */
const SCALE_NOTE = "scale note: at this size throughput comes from modules, beacons and more lanes, not more machines on a lane that's already full; ask for the measured rate before changing anything";
const SCALE_MACHINES = 5000;

const PLANETS: Record<string, string> = { vulcanus: "V", fulgora: "F", gleba: "G", aquilo: "A" };
const SPACE_PLATFORM = /^platform-\d+$/;

/** Prototype names a row mentions, so they can be checked against the save before the row is used. */
export function namesIn(text: string): string[] {
  return [...text.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g)].map((m) => m[0]).filter((n) => !ENGLISH.has(n));
}

const triggersOf = (p: Prototypes) => {
  const names = new Set<string>();
  for (const tech of Object.values(p.technologies)) {
    const trigger = (tech as { trigger?: { item?: unknown; entity?: unknown } }).trigger;
    for (const named of [triggerName(trigger?.item), triggerName(trigger?.entity)]) if (named) names.add(named);
  }
  return names;
};

/** Is every name in this row actually in the save? A row that isn't gets withheld, never corrected on the fly. */
export function grounded(row: StageRow, p: Prototypes): boolean {
  const triggers = triggersOf(p);
  const known = (n: string) =>
    Boolean(p.recipes[n] || p.items[n] || p.fluids[n] || p.technologies[n] || p.machines[n] || p.entities[n] || triggers.has(n));
  return row.lines.every((line) => namesIn(line).every(known));
};

/** The surface a planet row is chosen by: factorissimo's "nauvis-factory-floor" is still Nauvis. */
export function planetOf(surface: string, planets = Object.keys(PLANETS)): string | null {
  const name = surface.toLowerCase();
  if (planets.includes(name)) return name;
  const prefix = planets.filter((planet) => name.startsWith(`${planet}-`)).sort((a, b) => b.length - a.length)[0];
  return prefix ?? (name === "nauvis" || name.startsWith("nauvis-") ? "nauvis" : null);
}

/**
 * The row for this save, first match wins: a space platform, then the planet underfoot, then several planets
 * running, then the technology axis from the most advanced down, then nothing-matched.
 *
 * Surface beats technology on purpose — someone standing on Gleba with a silo at home wants Gleba advice — and a
 * planet-like surface with no row of its own asks rather than answering with Nauvis advice while they're underwater.
 */
export function stageFor(p: Prototypes | null, digest: Digest | null): { row: StageRow; scale: boolean } {
  const fallback = { row: ROWS.unknown!, scale: false };
  if (!p) return fallback;
  const machines = digest?.machines?.progress.machines ?? 0;
  const scale = machines >= SCALE_MACHINES;
  const out = (id: string) => {
    const row = ROWS[id]!;
    return grounded(row, p) ? { row, scale } : { row: ROWS.unknown!, scale: false };
  };
  const surface = digest?.player?.character_surface ?? digest?.player?.surface ?? "";
  const producing = new Set((digest?.surfaces ?? []).map((s) => s.name.toLowerCase()));

  if (SPACE_PLATFORM.test(surface.toLowerCase())) return out("SP");
  if (surface) {
    const planet = planetOf(surface);
    if (planet && PLANETS[planet]) return out(PLANETS[planet]!);
    // A modded planet (maraxsis, cerys) has no row: asking beats answering with Nauvis advice.
    if (!planet) return fallback;
  }
  if (Object.keys(PLANETS).filter((planet) => producing.has(planet)).length >= 2) return out("N8b");

  const known = (t: string) => Boolean(p.technologies[t]);
  const done = (t: string) => p.technologies[t]?.researched === true;
  const bots = () => done("construction-robotics") || done("logistic-robotics");
  if (done("space-platform")) return out("N8");
  if (done("rocket-silo")) return out("N7");
  if (bots()) return out("N6");
  if (done("chemical-science-pack")) return out("N5");
  if (done("oil-gathering")) return out("N4");
  if (done("logistic-science-pack")) return out("N3");
  if (done("automation-science-pack")) return out("N2");
  // A save whose tree doesn't even have these names isn't early game — it's unrecognised.
  if (known("automation-science-pack")) return out("N1");
  return fallback;
}

/**
 * Words that show he's talking about his own past (FC-182). Used to spot a throwback in an answer, so the
 * once-a-session allowance is only spent when he actually takes it — the model can't be asked to count.
 */
const THROWBACK = /\b(the ship|my ship|hauler|hold authority|the roster|manifest|trimmed?|ballast(?:ing)?|jump vector|orbit(?:al)?s?|flew|flying|crew|dry ?dock|cargo bay|docking)\b/i;

export const tookAThrowback = (answer: string): boolean => THROWBACK.test(answer);

/** The lines that ride in the turn's tail on a "what should I do" turn. */
export function stageLines(stage: { row: StageRow; scale: boolean }): string[] {
  return [`[stage: ${stage.row.id}]`, ...stage.row.lines, ...(stage.scale ? [SCALE_NOTE] : [])];
}
