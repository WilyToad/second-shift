import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLink } from "./game";
import { decodePackets, encodePacket } from "./rcon";

const prototypes = { recipes: {}, items: {}, fluids: {}, technologies: {}, machines: {} };
const digest = { tick: 1, research: { progress: 0, queue: {} }, surfaces: {}, alerts: {} };

/** Fake game: answers info (with a switchable mod list), dump_prototypes and digest; counts dumps. */
function fakeGame() {
  const state = { mods: { base: "2.0.77" } as Record<string, string>, dumps: 0, events: [] as object[] };
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

test("a finished research refetches prototypes (unlocks and productivity changed)", async () => {
  const { server, state } = fakeGame();
  const link = new GameLink({ pollMs: 50, eventPollMs: 50, historySize: 10, cacheDir: mkdtempSync(join(tmpdir(), "fc-cache-")), settings: async () => ({ host: "127.0.0.1", port: server.port, password: "x" }) });
  cleanup.push(() => link.stop(), () => server.stop(true));
  link.start();
  await until(() => state.dumps === 1 && link.latest() !== undefined);
  await Bun.sleep(300); // the first event poll only records the sequence number
  state.events.push({ seq: 1, tick: 5, kind: "research_finished", severity: "info", research: "logistics" });
  await until(() => state.dumps === 2);
});
