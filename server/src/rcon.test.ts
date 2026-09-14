import { afterEach, expect, test } from "bun:test";
import { decodePackets, encodePacket, RconClient } from "./rcon";

type Server = Bun.TCPSocketListener<unknown>;
let server: Server | null = null;
afterEach(() => { server?.stop(true); server = null; });

/** Minimal fake Factorio RCON server. `handle` maps a command to its reply. */
function fakeServer(password: string, handle: (cmd: string) => string, splitWrites = false) {
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const queue: Buffer[] = [];
  const flush = (sock: Bun.Socket<unknown>) => {
    while (queue.length) { const n = sock.write(queue[0]!); if (n < queue[0]!.length) { queue[0] = queue[0]!.subarray(Math.max(n, 0)); return; } queue.shift(); }
  };
  server = Bun.listen({
    hostname: "127.0.0.1", port: 0,
    socket: {
      drain(sock) { flush(sock); },
      data(sock, chunk) {
        const { packets, rest } = decodePackets(Buffer.concat([buf, chunk]));
        buf = rest;
        for (const p of packets) {
          let out: Buffer;
          if (p.type === 3) out = encodePacket(p.body === password ? p.id : -1, 2, "");
          else out = encodePacket(p.id, 0, handle(p.body));
          if (!splitWrites) { queue.push(out); flush(sock); continue; }
          for (let i = 0; i < out.length; i += 7) queue.push(out.subarray(i, i + 7)); // force partial packets
          flush(sock);
        }
      },
    },
  });
  return server.port;
}

test("encode/decode round-trips and keeps partial packets", () => {
  const a = encodePacket(7, 2, "/companion {}");
  const b = encodePacket(8, 0, "héllo");
  const joined = Buffer.concat([a, b.subarray(0, 5)]);
  const { packets, rest } = decodePackets(joined);
  expect(packets).toEqual([{ id: 7, type: 2, body: "/companion {}" }]);
  expect(rest.length).toBe(5);
});

test("authenticates and matches concurrent replies by id", async () => {
  const port = fakeServer("pw", (cmd) => `echo:${cmd}`, true);
  const rcon = await RconClient.connect({ host: "127.0.0.1", port, password: "pw" });
  const replies = await Promise.all(Array.from({ length: 50 }, (_, i) => rcon.exec(`/companion ${i}`)));
  expect(replies[0]).toBe("echo:/companion 0");
  expect(replies[49]).toBe("echo:/companion 49");
  rcon.close();
});

test("large commands and replies arrive intact", async () => {
  const port = fakeServer("pw", (cmd) => `${cmd.length}:` + "x".repeat(2_000_000));
  const rcon = await RconClient.connect({ host: "127.0.0.1", port, password: "pw" });
  const reply = await rcon.exec("/companion " + "b".repeat(500_000));
  expect(reply.startsWith("500011:")).toBe(true);
  expect(reply.length).toBe(2_000_007);
  rcon.close();
});

test("wrong password is rejected", async () => {
  const port = fakeServer("pw", () => "");
  await expect(RconClient.connect({ host: "127.0.0.1", port, password: "nope", timeoutMs: 2000 })).rejects.toThrow("authentication failed");
});
