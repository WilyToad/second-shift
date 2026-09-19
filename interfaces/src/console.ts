// What the console may send the server (FC-200). The server used to cast `JSON.parse(raw)` to this type, which is
// a promise, not a check; anything malformed reached the agent. Local-only (the server binds 127.0.0.1), so the
// point is robustness rather than security — a bad message is dropped and logged instead of throwing mid-turn.
import { z } from "zod";

const HeardSchema = z.object({
  first: z.string(),
  picked: z.string(),
  alternatives: z.number().int().nonnegative(),
  offered: z.array(z.string()),
  phrases: z.number().int().nonnegative(),
  where: z.string(),
  carried: z.boolean(),
  /** With local transcription (FC-230): what the browser heard, and how long whisper took. */
  browser: z.string().optional(),
  localMs: z.number().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("watch"), on: z.boolean() }),
  // `spoken` marks a question that came through speech recognition (FC-175); `heard` is its diagnostic record
  // (FC-185): logged, never put in the prompt.
  z.object({ type: z.literal("ask"), text: z.string().max(8000), thinking: z.boolean().optional(), spoken: z.boolean().optional(), heard: HeardSchema.optional() }),
  z.object({ type: z.literal("approve"), id: z.string().min(1).max(64) }),
  z.object({ type: z.literal("decline"), id: z.string().min(1).max(64) }),
  z.object({ type: z.literal("reset") }),
  // The player is talking or typing a question: keep the model awake (FC-158).
  z.object({ type: z.literal("wake") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** The parsed message, or null with a reason the server can log. Never throws. */
export function parseClientMessage(raw: unknown): { message: ClientMessage; reason?: undefined } | { message?: undefined; reason: string } {
  let json: unknown;
  try {
    json = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { reason: "not JSON" };
  }
  const parsed = ClientMessageSchema.safeParse(json);
  if (parsed.success) return { message: parsed.data };
  const type = json && typeof json === "object" && "type" in json ? String((json as { type: unknown }).type) : "?";
  return { reason: `${type}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "message"} ${i.message}`).join("; ")}` };
}
