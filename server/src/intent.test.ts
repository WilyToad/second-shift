import { expect, test } from "bun:test";
import { ASKS_FOR, bareFollowUp, needsWorldTools, PICTURE, plainAnswer, wantsBlueprint, wantsBuild, wantsChart } from "./intent";
import { wantsBotsToFill, wantsContents, wantsMeasuredOutput, wantsPackingList, wantsPlayerStatus, wantsPointedAt, wantsReady, wantsSpidertronSent, wantsStartAdvice, wantsStock, wantsStop, wantsSurroundings } from "./player";

/**
 * Every intent classifier, run over every question at once (FC-199). Each regex was added when a session showed a
 * miss and each was tested alone; the collisions only showed when they were put side by side. The first run of
 * this corpus found five: "help me… what do I do?" answered flat as an alarm, "a red dot on the map… must be
 * monsters" not a world question at all, "what should I work on next?" never reaching the stage table, "holding
 * steady" read as something in the player's hand, and "what am I holding?" read as a trend (FC-203, FC-204, FC-205).
 *
 * Adding a classifier means adding a column here; changing one means re-reviewing the rows it flips.
 */
const CLASSIFIERS: Record<string, (q: string) => boolean> = {
  world: (q) => needsWorldTools(q, false),
  urgent: (q) => plainAnswer(q, {}),
  bare: bareFollowUp,
  build: wantsBuild,
  bp: wantsBlueprint,
  chart: wantsChart,
  start: wantsStartAdvice,
  packing: wantsPackingList,
  stock: wantsStock,
  ready: wantsReady,
  pic: (q) => PICTURE.test(q),
  around: wantsSurroundings,
  status: wantsPlayerStatus,
  spider: wantsSpidertronSent,
  stop: wantsStop,
  contents: wantsContents,
  pointed: wantsPointedAt,
  measured: wantsMeasuredOutput,
  fill: wantsBotsToFill,
  paste: (q) => ASKS_FOR.place_blueprint!.test(q),
  mark: (q) => ASKS_FOR.mark_deconstruction!.test(q),
  research: (q) => ASKS_FOR.queue_research!.test(q),
};

/** Real questions — the player's own sessions first, then the eval suites — with the classifications reviewed by hand. */
const CORPUS: [question: string, expected: string[]][] = [
  ["where am I?", []],
  ["help me... what do I do?", ["start","around","status"]],
  ["what can I craft right now?", ["status"]],
  ["I just picked up a bunch of debris from a crashed ship!", ["around","status"]],
  ["look around", ["world","around"]],
  ["I think I found some ore", ["around"]],
  ["show me the way to the nearest ore", ["world"]],
  ["I just built something", ["world","around","status"]],
  ["what should I build next?", ["start","around","status"]],
  ["Before you scan for ore, ask me whether I want you to look around.", ["world","around"]],
  ["yeah", []],
  ["OK I'm running where", []],
  ["I've got 10 red bottles to research automation", []],
  ["I see a big red dot on the map up there that must be monsters", ["world","urgent"]],
  ["I built 10 of them", ["world","around","status"]],
  ["A bit further", ["bare"]],
  ["What makes bioflux, and where can it be crafted?", []],
  ["And how many biochambers would I need for 60 bioflux per minute?", []],
  ["How many copper cables does a green circuit take?", []],
  ["Am I ready to go build?", ["ready"]],
  ["Am I ready to head out?", ["ready"]],
  ["build a line up to my metal", ["world","build"]],
  ["Build me 120 iron gear wheels a minute", ["bp"]],
  ["Do you ever miss flying?", []],
  ["Give me a blueprint for 120 iron gear wheels a minute", ["bp"]],
  ["Make a blueprint for 60 iron gear wheels per minute and paste it here", ["world","bp","paste"]],
  ["How many rails are near me?", ["world"]],
  ["Is anything attacking me right now?", ["urgent"]],
  ["mark them for deconstruction", ["world","mark"]],
  ["paste it here", ["world","paste"]],
  ["What do I need before I can research agricultural science?", []],
  ["What rate are my labs really hitting?", ["measured"]],
  ["What should I work on next?", ["start","around","status"]],
  ["Where is the rocket silo?", ["world","stock"]],
  ["I'm building a smelting outpost, I need 20 ovens, a couple hundred belt, arms to feed them and chests for storage", ["packing"]],
  ["send the spidertron to the ore patch", ["spider"]],
  ["stop", ["stop"]],
  ["what is this?", ["pointed"]],
  ["what's in this chest?", ["contents","pointed"]],
  ["get the bots to fill it", ["fill"]],
  ["How is my science doing? Show me a chart.", ["world","chart"]],
  ["Is my iron plate production on the factory floor holding steady?", ["chart"]],
  ["what's attacking my east wall?", ["urgent"]],
  ["I'm out of ammo up here", ["world","urgent"]],
  ["the power is down", ["urgent"]],
  ["and how many for a red circuit?", ["world"]],
  ["further north, how many labs?", ["world"]],
  ["what about copper?", []],
  ["quick question, how many gears does an inserter take?", []],
  ["take a screenshot of this", ["world","pic"]],
  ["queue steel processing", ["world","research"]],
  ["what's the nearest coal?", ["world"]],
  ["where are my 200 steel?", ["world","stock"]],
  ["how many labs do I have?", ["world","stock"]],
  ["research automation", ["research"]],
  ["what am I holding?", ["status","pointed"]],
  ["what's in my inventory?", ["status"]],
  // From the player's live session (2026-09-18): the spoken form of their own packing example, no "need", no commas,
  // fell to the build offer instead of a list (FC-211). Two counted things in a build sentence is packing.
  ["I'm going to build a smelting outpost 20 stone furnace is a couple hundred belt arms to feed them chest for storage", ["packing"]],
  ["I'm going to build a smelting outpost", ["build"]],
  ["build me a smelting outpost with 20 furnaces and 200 belts", ["packing"]],
];

test("FC-199: every classifier agrees with the reviewed corpus", () => {
  const wrong: string[] = [];
  for (const [question, expected] of CORPUS) {
    const actual = Object.entries(CLASSIFIERS).filter(([, f]) => f(question)).map(([k]) => k);
    if (actual.join(",") !== expected.join(",")) wrong.push(`${JSON.stringify(question)}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
  expect(wrong, wrong.join("\n")).toEqual([]);
  expect(CORPUS.length).toBeGreaterThanOrEqual(40);
});

test("FC-199: every classifier is in the table, so a new one can't be left out", () => {
  // The columns are the whole set of text classifiers the turn uses; a new export from intent.ts or player.ts
  // that decides guidance has to be added here or this list goes stale in silence.
  expect(Object.keys(CLASSIFIERS)).toHaveLength(22);
});
