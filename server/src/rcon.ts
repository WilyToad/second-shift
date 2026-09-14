// Source RCON client for Factorio. One TCP connection; replies are matched to requests by id.
// Factorio answers each command with a single response packet (measured up to 5 MB).

const TYPE_AUTH = 3;
const TYPE_EXEC = 2; // also the auth response type
const HEADER = 12; // size field excluded: id(4) + type(4) + two trailing NULs(2) + size(4) - 2

export type RconOptions = { host: string; port: number; password: string; timeoutMs?: number };

export class RconError extends Error {}

export function encodePacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, "utf8");
  const packet = Buffer.alloc(14 + payload.length);
  packet.writeInt32LE(10 + payload.length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, HEADER);
  return packet;
}

/** Splits complete packets off the front of `buf`. Returns packets and the unconsumed rest. */
export function decodePackets(buf: Buffer): { packets: { id: number; type: number; body: string }[]; rest: Buffer } {
  const packets = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const size = buf.readInt32LE(offset);
    if (buf.length - offset < size + 4) break;
    packets.push({
      id: buf.readInt32LE(offset + 4),
      type: buf.readInt32LE(offset + 8),
      body: buf.subarray(offset + HEADER, offset + 4 + size - 2).toString("utf8"),
    });
    offset += size + 4;
  }
  return { packets, rest: buf.subarray(offset) };
}

type Pending = { resolve: (body: string) => void; reject: (e: Error) => void; timer: Timer };

export class RconClient {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private outbox: Buffer[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;

  private constructor(private readonly opts: RconOptions) {}

  static async connect(opts: RconOptions): Promise<RconClient> {
    const client = new RconClient(opts);
    await client.open();
    return client;
  }

  private async open(): Promise<void> {
    this.socket = await Bun.connect({
      hostname: this.opts.host,
      port: this.opts.port,
      socket: {
        data: (_s, chunk) => this.onData(chunk),
        drain: () => this.flush(),
        close: () => this.failAll(new RconError("RCON connection closed")),
        error: (_s, e) => this.failAll(new RconError(`RCON socket error: ${e.message}`)),
      },
    });
    const ok = await this.request(TYPE_AUTH, this.opts.password, true);
    if (ok === null) throw new RconError("RCON authentication failed");
  }

  /** Runs a console command (e.g. `/companion {...}`) and returns what the handler printed. */
  async exec(command: string): Promise<string> {
    return (await this.request(TYPE_EXEC, command, false))!;
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }

  private request(type: number, body: string, isAuth: boolean): Promise<string | null> {
    if (!this.socket) return Promise.reject(new RconError("RCON not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RconError(`RCON request ${id} timed out`));
      }, this.opts.timeoutMs ?? 10_000);
      this.pending.set(id, {
        resolve: (b) => resolve(b),
        reject,
        timer,
      });
      if (isAuth) this.authId = id;
      this.outbox.push(encodePacket(id, type, body));
      this.flush();
    });
  }

  /** Writes queued packets, keeping the remainder when the socket accepts only part. */
  private flush(): void {
    while (this.socket && this.outbox.length > 0) {
      const next = this.outbox[0]!;
      const written = this.socket.write(next);
      if (written < next.length) {
        this.outbox[0] = next.subarray(Math.max(written, 0));
        return; // wait for drain
      }
      this.outbox.shift();
    }
  }

  private authId = -2;

  private onData(chunk: Buffer): void {
    const { packets, rest } = decodePackets(Buffer.concat([this.buffer, chunk]));
    this.buffer = rest;
    for (const p of packets) {
      if (p.id === -1) {
        // Auth failure is reported with id -1.
        const auth = this.pending.get(this.authId);
        if (auth) { clearTimeout(auth.timer); this.pending.delete(this.authId); auth.reject(new RconError("RCON authentication failed")); }
        continue;
      }
      // Servers may send an empty RESPONSE_VALUE before the auth response; skip it.
      if (p.id === this.authId && p.type !== TYPE_EXEC) continue;
      const waiter = this.pending.get(p.id);
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      this.pending.delete(p.id);
      waiter.resolve(p.body);
    }
  }

  private failAll(e: Error): void {
    this.outbox = [];
    for (const [id, w] of this.pending) { clearTimeout(w.timer); w.reject(e); this.pending.delete(id); }
  }
}
