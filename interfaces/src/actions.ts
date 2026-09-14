// Mod actions the server may call, with the shape of their data. Unknown actions are rejected here
// before anything reaches the game.
import { z } from "zod";
import { DigestSchema } from "./digest";
import { luaArray } from "./protocol";
import { PrototypesSchema } from "./prototypes";

export const InfoSchema = z.object({
  protocol: z.number(),
  dump_version: z.number().default(1),
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

export const GameEventSchema = z.object({
  seq: z.number(),
  tick: z.number(),
  kind: z.enum(["alert", "research_finished"]),
  severity: z.enum(["critical", "warning", "info"]),
  type: z.string().optional(),
  count: z.number().optional(),
  surface: z.string().optional(),
  entity: z.string().optional(),
  position: PositionSchema.optional(),
  research: z.string().optional(),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

export const EventsSchema = z.object({ seq: z.number(), oldest: z.number(), events: luaArray(GameEventSchema) });

export const MachineProgressSchema = z.object({ machines: z.number(), scanned: z.boolean(), refresh_ticks: z.number() });
/** surface -> recipe label -> status name -> count. */
export const MachineCountsSchema = z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number()))))));
export const MachineStatsSchema = z.object({ progress: MachineProgressSchema, counts: MachineCountsSchema });

export const actions = {
  ping: { args: z.object({}), data: z.object({ tick: z.number() }) },
  info: { args: z.object({}), data: InfoSchema },
  digest: { args: z.object({}), data: DigestSchema },
  dump_prototypes: { args: z.object({}), data: PrototypesSchema },
  research_state: {
    // Without technologies: the whole force. With: those technologies and the recipes their effects
    // touch, listed in `recipes`/`technologies` (the scope the other fields describe).
    args: z.object({ technologies: z.array(z.string()).max(100).optional() }),
    data: z.object({
      recipes: luaArray(z.string()).optional(),
      technologies: luaArray(z.string()).optional(),
      enabled_recipes: luaArray(z.string()),
      productivity_bonus: z.record(z.string(), z.number()), // only non-zero bonuses
      researched_technologies: luaArray(z.string()),
    }),
    kind: "look",
  },
  find_entities: { args: FindEntitiesArgsSchema, data: FindEntitiesSchema, kind: "look" },
  highlight: { args: TargetsSchema.extend({ seconds: z.number().positive().max(300).default(30) }), data: z.object({ drawn: z.number(), seconds: z.number() }), kind: "look" },
  clear_highlight: { args: z.object({}), data: z.object({ cleared: z.number() }), kind: "look" },
  mark_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
  cancel_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
  events: { args: z.object({ since: z.number().default(0) }), data: EventsSchema, kind: "look" },
  research_options: {
    args: z.object({}),
    data: z.object({ options: luaArray(z.object({ name: z.string(), count: z.number(), packs: luaArray(z.string()) })), available: z.number(), queue: luaArray(z.string()) }),
    kind: "look",
  },
  queue_research: { args: z.object({ technology: z.string() }), data: z.object({ queued: z.string(), queue: luaArray(z.string()) }), kind: "small_request" },
  add_map_tag: { args: z.object({ x: z.number().optional(), y: z.number().optional(), text: z.string().max(200) }), data: z.object({ x: z.number(), y: z.number(), text: z.string() }), kind: "small_request" },
  camera_to: { args: z.object({ x: z.number(), y: z.number(), surface: z.string().optional() }), data: z.object({ surface: z.string(), x: z.number(), y: z.number() }), kind: "small_request" },
  mark_upgrade: { args: TargetsSchema.extend({ target: z.string().optional() }), data: ApplyResultSchema, kind: "map_change" },
  place_blueprint: {
    args: z.object({ blueprint: z.string(), x: z.number().optional(), y: z.number().optional(), direction: z.number().optional() }),
    data: z.object({ placed: z.number(), expected: z.number(), x: z.number(), y: z.number(), undo_items: z.number() }),
    kind: "map_change",
  },
  machine_stats: { args: z.object({}), data: MachineStatsSchema, kind: "look" },
  find_machines: {
    args: z.object({ recipe: z.string().optional(), surface: z.string().optional(), statuses: z.array(z.string()).optional() }),
    data: z.object({
      surface: z.string(), recipe: z.string().optional(), count: z.number(), not_visible: z.number(), same_surface: z.boolean(),
      by_status: z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number())),
      entities: luaArray(EntityRefSchema),
    }),
    kind: "look",
  },
  debug_machine_tick: { args: z.object({}), data: MachineProgressSchema, kind: "look" },
  debug_reset_machines: { args: z.object({}), data: MachineProgressSchema, kind: "look" },
  debug_refresh_rates: { args: z.object({}), data: z.object({}).passthrough(), kind: "look" },
} as const;

export type ActionName = keyof typeof actions;
export type ActionArgs<A extends ActionName> = z.input<(typeof actions)[A]["args"]>;
export type ActionData<A extends ActionName> = z.output<(typeof actions)[A]["data"]>;

export function isActionName(name: string): name is ActionName {
  return Object.hasOwn(actions, name);
}
