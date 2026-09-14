// Wire protocol between the server and the mod: one RCON command, JSON in, JSON out.
//   request:  /companion {"id":1,"action":"digest","args":{},"profile":false}
//   reply:    {"id":1,"ok":true,"data":{...}}  or  {"id":1,"ok":false,"error":{"code":"...","message":"..."}}
//   profile:  optional second line "profile Duration: 0.19ms" when the request sets profile:true
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/**
 * Largest command the server sends. The mod parses JSON on the game's main thread: measured ~1.5 ms
 * per 100 KB and 14 ms per 1 MB (FC-022), so 48 KB keeps a command under the 1 ms per-tick budget.
 * Bigger payloads (large blueprints) must be split across ticks.
 */
export const MAX_COMMAND_BYTES = 48_000;

export class CommandTooLargeError extends Error {}

/** helpers.table_to_json writes an empty Lua table as {}; accept that wherever an array is expected. */
export const luaArray = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0 ? [] : v),
    z.array(item),
  );

export type Request = { id: number; action: string; args?: Record<string, unknown>; profile?: boolean };

export const ReplySchema = z.object({
  id: z.number().nullish(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type Reply = z.infer<typeof ReplySchema>;

export function encodeCommand(req: Request): string {
  const command = `/companion ${JSON.stringify(req)}`;
  const bytes = Buffer.byteLength(command);
  if (bytes > MAX_COMMAND_BYTES) throw new CommandTooLargeError(`Command for ${req.action} is ${bytes} bytes; the limit is ${MAX_COMMAND_BYTES}.`);
  return command;
}

export function parseReply(raw: string): { reply: Reply; profile?: string } {
  const newline = raw.indexOf("\n");
  const json = newline === -1 ? raw : raw.slice(0, newline);
  const rest = newline === -1 ? "" : raw.slice(newline + 1).trim();
  const reply = ReplySchema.parse(JSON.parse(json));
  const profile = rest.startsWith("profile ") ? rest.slice("profile ".length).replace(/^Duration: /, "") : undefined;
  return { reply, profile };
}
