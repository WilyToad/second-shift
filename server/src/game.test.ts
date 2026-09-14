import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLink } from "./game";
import { decodePackets, encodePacket } from "./rcon";

const prototypes = {
  recipes: { "steel-plate": { category: "smelting", energy: 16, ingredients: {}, products: {}, enabled: false, maximum_productivity: 3 } },
  items: {}, fluids: {}, machines: {},
  technologies: { "steel-processing": { prerequisites: {}, unlocks: ["steel-plate"], count: 50, ingredients: {}, seconds_per_unit: 5, researched: false } },
};
const digest = { tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {} };

/** Fake game: answers info (with a switchable mod list), dump_prototypes and digest; counts dumps. */
function fakeGame() {
  const state = { mods: { base: "2.0.77" } as Record<string, string>, dumps: 0, events: [] as object[], researchCalls: [] as unknown[], researchState: true };
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      data(sock, chunk) {
        const { packets, rest } = decodePackets(Buffer.concat([buf, chunk]));
        buf = rest;
        for (const p of packets) {
          if (p.type === 3) { sock.write(encodePacket(p.id, 2, "")); continue; }
          const req = JSON.parse(p.body.replace(/^\/companion /, ""));
          let data: unknown = { tick: 1 };
          if (req.action === "info") data = { protocol: 1, dump_version: 2, mod_version: "0.1.0", game_version: "2.0.77", tick: 1, mods: state.mods, players: 1 };
          if (req.action === "dump_prototypes") { state.dumps++; data = prototypes; }
          if (req.action === "digest") data = digest;
          if (req.action === "research_state") {
            state.researchCalls.push(req.args?.technologies ?? "all");
            if (!state.researchState) { sock.write(encodePacket(p.id, 0, JSON.stringify({ id: req.id, ok: false, error: { code: "unknown_action", message: "research_state" } }))); continue; }
            data = req.args?.technologies
              ? { recipes: ["steel-plate"], technologies: ["steel-processing"], enabled_recipes: ["steel-plate"], productivity_bonus: {}, researched_technologies: ["steel-processing"] }
              : { enabled_recipes: {}, productivity_bonus: {}, researched_technologies: {} };
          }
          if (req.action === "events") { const events = state.events.filter((e: any) => e.seq > (req.args?.since ?? 0)); data = { seq: state.events.length, oldest: 1, events: events.length ? events : {} }; }
          sock.write(encodePacket(p.id, 0, JSON.stringify({ id: req.id, ok: true, data })));
        }
      },
    },
  });
  return { server, state };
}

let cleanup: (() => void)[] = [];
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; });

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await Bun.sleep(20);
  expect(cond()).toBe(true);
};

test("prototypes are fetched on connect only when the mod list changes", async () => {
  const { server, state } = fakeGame();
  const link = new GameLink({ pollMs: 50, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-cache-")), settings: async () => ({ host: "127.0.0.1", port: server.port, password: "x" }) });
  cleanup.push(() => link.stop(), () => server.stop(true));
  link.start();
  await until(() => state.dumps === 1 && link.latest() !== undefined);

  link.disconnect(); // same mods: reconnect must not refetch
  await Bun.sleep(300);
  await until(() => link.status().connected);
  expect(state.dumps).toBe(1);

  state.mods = { base: "2.0.77", maraxsis: "1.31.9" }; // mod list changed
  link.disconnect();
  await until(() => state.dumps === 2);
});

test("a finished research patches the prototypes without a full dump", async () => {
  const { server, state } = fakeGame();
  const link = new GameLink({ pollMs: 50, eventPollMs: 50, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-cache-")), settings: async () => ({ host: "127.0.0.1", port: server.port, password: "x" }) });
  cleanup.push(() => link.stop(), () => server.stop(true));
  link.start();
  await until(() => state.dumps === 1 && link.latest() !== undefined);
  await Bun.sleep(300); // the first event poll only records the sequence number
  state.events.push({ seq: 1, tick: 5, kind: "research_finished", severity: "info", research: "steel-processing" });
  await until(() => link.prototypes()?.data.recipes["steel-plate"]?.enabled === true);
  expect(link.prototypes()?.data.technologies["steel-processing"]?.researched).toBe(true);
  expect(state.researchCalls).toEqual([["steel-processing"]]);
  expect(state.dumps).toBe(1);
});

test("an older mod without research_state falls back to a full dump", async () => {
  const { server, state } = fakeGame();
  state.researchState = false;
  const link = new GameLink({ pollMs: 50, eventPollMs: 50, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-cache-")), settings: async () => ({ host: "127.0.0.1", port: server.port, password: "x" }) });
  cleanup.push(() => link.stop(), () => server.stop(true));
  link.start();
  await until(() => state.dumps === 1 && link.latest() !== undefined);
  await Bun.sleep(300);
  state.events.push({ seq: 1, tick: 5, kind: "research_finished", severity: "info", research: "steel-processing" });
  await until(() => state.dumps === 2);
});

test("reconnecting with the same mods patches research progress instead of dumping", async () => {
  const { server, state } = fakeGame();
  const link = new GameLink({ pollMs: 50, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-cache-")), settings: async () => ({ host: "127.0.0.1", port: server.port, password: "x" }) });
  cleanup.push(() => link.stop(), () => server.stop(true));
  link.start();
  await until(() => state.dumps === 1 && link.latest() !== undefined);
  link.disconnect();
  await until(() => state.researchCalls.includes("all"));
  expect(state.dumps).toBe(1);
});
