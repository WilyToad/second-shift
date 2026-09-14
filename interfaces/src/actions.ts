// Mod actions the server may call, with the shape of their data. Unknown actions are rejected here
// before anything reaches the game.
import { z } from "zod";
import { DigestSchema } from "./digest";
import { luaArray } from "./protocol";
import { PrototypesSchema } from "./prototypes";

export const InfoSchema = z.object({
  protocol: z.number(),
  mod_version: z.string(),
  game_version: z.string(),
  tick: z.number(),
  mods: z.record(z.string(), z.string()),
  players: z.number(),
});

/** An entity on the companion player's surface, identified the way a player would point at it. */
export const EntityRefSchema = z.object({ name: z.string(), x: z.number(), y: z.number() });
export type EntityRef = z.infer<typeof EntityRefSchema>;

const PositionSchema = z.object({ x: z.number(), y: z.number() });
export const DIRECTIONS = ["right", "left", "up", "down", "around"] as const;

export const FindEntitiesArgsSchema = z.object({
  types: z.array(z.string()).optional(),
  names: z.array(z.string()).optional(),
  direction: z.enum(DIRECTIONS).default("around"),
  radius: z.number().positive().max(128).default(32),
  mine: z.boolean().optional(),
});

export const FindEntitiesSchema = z.object({
  surface: z.string(),
  center: PositionSchema,
  direction: z.enum(DIRECTIONS),
  radius: z.number(),
  area: z.object({ left_top: PositionSchema, right_bottom: PositionSchema }),
  count: z.number(),
  by_name: z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number())),
  not_visible: z.number(),
  entities: luaArray(EntityRefSchema),
  truncated: z.boolean(),
});
export type FindEntitiesResult = z.infer<typeof FindEntitiesSchema>;

const TargetsSchema = z.object({ entities: z.array(EntityRefSchema).max(1000) });
/** Per-reason rejection counts, e.g. { not_visible: 1 }. Reasons come from scripts/helmet.lua. */
const ApplyResultSchema = z.object({
  done: z.number(),
  rejected: z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number())),
  undo_items: z.number(),
});

export const actions = {
  ping: { args: z.object({}), data: z.object({ tick: z.number() }) },
  info: { args: z.object({}), data: InfoSchema },
  digest: { args: z.object({}), data: DigestSchema },
  dump_prototypes: { args: z.object({}), data: PrototypesSchema },
  find_entities: { args: FindEntitiesArgsSchema, data: FindEntitiesSchema, kind: "look" },
  highlight: { args: TargetsSchema.extend({ seconds: z.number().positive().max(300).default(30) }), data: z.object({ drawn: z.number(), seconds: z.number() }), kind: "look" },
  clear_highlight: { args: z.object({}), data: z.object({ cleared: z.number() }), kind: "look" },
  mark_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
  cancel_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
} as const;

export type ActionName = keyof typeof actions;
export type ActionArgs<A extends ActionName> = z.input<(typeof actions)[A]["args"]>;
export type ActionData<A extends ActionName> = z.output<(typeof actions)[A]["data"]>;

export function isActionName(name: string): name is ActionName {
  return Object.hasOwn(actions, name);
}
