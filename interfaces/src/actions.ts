// Mod actions the server may call, with the shape of their data. Unknown actions are rejected here
// before anything reaches the game.
import { z } from "zod";
import { DigestSchema } from "./digest";
import { luaArray } from "./protocol";
import { InserterBonusesSchema, PrototypesSchema } from "./prototypes";

export const InfoSchema = z.object({
  protocol: z.number(),
  dump_version: z.number().default(1),
  mod_version: z.string(),
  game_version: z.string(),
  tick: z.number(),
  mods: z.record(z.string(), z.string()),
  players: z.number(),
});

const NameCount = z.object({ name: z.string(), count: z.number() });

/** What the player carries, can hand-craft now and built recently (S22). */
export const PlayerStatusSchema = z.object({
  character: z.boolean(),
  surface: z.string(),
  x: z.number(),
  y: z.number(),
  items: luaArray(NameCount),
  total_items: z.number(),
  hand: NameCount.optional(),
  craftable: luaArray(NameCount),
  // The list stopped at its cap with recipes left unchecked.
  more_craftable: z.boolean(),
  crafting_queue: luaArray(NameCount),
  recent_builds: luaArray(z.object({ name: z.string(), ghost: z.boolean(), surface: z.string(), x: z.number(), y: z.number(), age_ticks: z.number(), still_there: z.boolean() })),
});
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

const Nearest = NameCount.extend({ x: z.number(), y: z.number() });

/** What the player can see around their character (S22). */
export const SurroundingsSchema = z.object({
  surface: z.string(),
  x: z.number(),
  y: z.number(),
  radius: z.number(),
  // Resources are looked for this far out when none are within `radius` (FC-139).
  resource_radius: z.number().optional(),
  mine: luaArray(Nearest),
  resources: luaArray(Nearest.extend({ amount: z.number() })),
  other: luaArray(Nearest),
  trees: z.number(),
  rocks: z.number(),
  enemies: z.number(),
  water_tiles: z.number(),
  // What containers the player didn't build hold (the crash site's wreckage), from up to 25 containers.
  salvage: luaArray(NameCount).default([]),
  salvage_containers: z.number().default(0),
});
export type Surroundings = z.infer<typeof SurroundingsSchema>;

/** An entity as the player sees it: ghosts by what they'll become, whole-tile positions (FC-151). */
export const SeenEntitySchema = z.object({ name: z.string(), ghost: z.boolean(), type: z.string(), surface: z.string(), x: z.number(), y: z.number(), own: z.boolean() });
export type SeenEntity = z.infer<typeof SeenEntitySchema>;

/** What the player points at, last hovered, holds and has open (FC-151). */
export const PointedAtSchema = z.object({
  selected: SeenEntitySchema.optional(),
  // Gone entities come back with only still_there and ago_ticks.
  last_hovered: SeenEntitySchema.partial().extend({ still_there: z.boolean(), ago_ticks: z.number() }).optional(),
  hand: NameCount.optional(),
  hand_ghost: z.string().optional(),
  opened: z.object({ kind: z.string(), entity: SeenEntitySchema.optional(), item: z.string().optional() }).optional(),
});
export type PointedAt = z.infer<typeof PointedAtSchema>;

/** The player's own logistic network, and whether they're in range of it (FC-168). */
export const LogisticNetworkSchema = z.object({
  in_range: z.boolean(),
  network_id: z.number().optional(),
  robots: z.number(),
  available_robots: z.number(),
  items: luaArray(z.object({ name: z.string(), count: z.number(), quality: z.string().optional() })),
  total_kinds: z.number(),
  // Read, never written: the player's own choice (FC-168).
  trash_unrequested: z.boolean(),
});
export type LogisticNetwork = z.infer<typeof LogisticNetworkSchema>;

/** What the companion asked the bots for, in its own section of the player's requests (FC-168). */
export const SetRequestsSchema = z.object({
  group: z.string(),
  set: luaArray(z.object({ name: z.string(), count: z.number(), in_network: z.number() })),
  short: luaArray(z.object({ name: z.string(), reason: z.string() })),
  robots: z.number(),
  sections: z.number(),
  trash_unrequested: z.boolean(),
});

/** What the player can reach without walking far: what they carry plus the containers they can see (FC-165). */
export const StockSchema = z.object({
  surface: z.string(),
  radius: z.number(),
  x: z.number(),
  y: z.number(),
  free_slots: z.number(),
  containers: z.number(),
  not_visible: z.number(),
  items: luaArray(z.object({
    name: z.string(), count: z.number(), carried: z.number(), quality: z.string().optional(),
    // Where the nearest one outside the player's own inventory is.
    x: z.number().optional(), y: z.number().optional(), distance: z.number().optional(), container: z.string().optional(),
  })),
  total_kinds: z.number(),
});
export type Stock = z.infer<typeof StockSchema>;

/** The player's spidertrons on their surface, nearest first (FC-144). */
export const SpidertronsSchema = z.object({
  spidertrons: luaArray(z.object({
    name: z.string(), unit_number: z.number(), x: z.number(), y: z.number(), distance: z.number(),
    driver: z.boolean(), walking_to: z.object({ x: z.number(), y: z.number() }).optional(),
  })),
  total: z.number(),
  // Sending one across the map needs the player's own remote.
  has_remote: z.boolean(),
  surface: z.string(),
});
export type Spidertrons = z.infer<typeof SpidertronsSchema>;

/** Measured output of machines, from their own finished-craft counts (FC-162). */
export const MachineOutputSchema = z.object({
  tick: z.number(),
  // Ticks since the last read; 0 when this read starts the clock.
  window_ticks: z.number(),
  machines: z.number(),
  not_visible: z.number(),
  recipes: luaArray(z.object({ recipe: z.string(), machines: z.number(), finished: z.number(), sampled: z.number(), per_minute: z.number().optional() })),
});
export type MachineOutput = z.infer<typeof MachineOutputSchema>;

/** What's inside a container or machine the player can see (FC-152). */
export const ContainerContentsSchema = z.object({
  entity: SeenEntitySchema,
  items: luaArray(NameCount.extend({ quality: z.string().optional() })),
  total_kinds: z.number(),
  fluids: luaArray(z.object({ name: z.string(), amount: z.number() })),
});
export type ContainerContents = z.infer<typeof ContainerContentsSchema>;

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
  /** "character": around where the character stands (default); "view": around where the player is looking. */
  from: z.enum(["character", "view"]).optional(),
});

export const FindEntitiesSchema = z.object({
  surface: z.string(),
  center: PositionSchema,
  direction: z.enum(DIRECTIONS),
  radius: z.number(),
  area: z.object({ left_top: PositionSchema, right_bottom: PositionSchema }),
  count: z.number(),
  by_name: z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number())),
  from: z.enum(["character", "view"]).optional(),
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
  kind: z.enum(["alert", "research_finished", "selection", "talk", "control_stopped", "control_arrived"]),
  severity: z.enum(["critical", "warning", "info"]),
  type: z.string().optional(),
  count: z.number().optional(),
  surface: z.string().optional(),
  entity: z.string().optional(),
  position: PositionSchema.optional(),
  research: z.string().optional(),
  // What the companion was moving, and why it stopped (FC-051, FC-144).
  control: z.string().optional(),
  reason: z.string().optional(),
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
      inserter_bonuses: InserterBonusesSchema.optional(),
    }),
    kind: "look",
  },
  find_entities: { args: FindEntitiesArgsSchema, data: FindEntitiesSchema, kind: "look" },
  highlight: { args: TargetsSchema.extend({ seconds: z.number().positive().max(300).default(30) }), data: z.object({ drawn: z.number(), seconds: z.number() }), kind: "look" },
  clear_highlight: { args: z.object({}), data: z.object({ cleared: z.number() }), kind: "look" },
  // FC-143: an arrow at the character facing a charted spot, plus a map marker; player-only, expires.
  point_to: {
    args: z.object({ x: z.number(), y: z.number(), surface: z.string().optional(), label: z.string().max(60).optional(), seconds: z.number().positive().max(120).optional() }),
    data: z.object({ surface: z.string(), x: z.number(), y: z.number(), distance: z.number(), seconds: z.number() }),
    kind: "look",
  },
  mark_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
  cancel_deconstruction: { args: TargetsSchema, data: ApplyResultSchema, kind: "map_change" },
  events: { args: z.object({ since: z.number().default(0) }), data: EventsSchema, kind: "look" },
  debug_push_talk: { args: z.object({}), data: z.object({ seq: z.number() }), kind: "look" },
  research_options: {
    args: z.object({}),
    data: z.object({
      options: luaArray(z.object({ name: z.string(), count: z.number(), packs: luaArray(z.string()) })),
      available: z.number(),
      queue: luaArray(z.string()),
      // Technologies unlocked by doing something ("craft 10 iron-gear-wheel"), not by labs (S22).
      triggers: luaArray(z.object({ name: z.string(), trigger: z.string() })).default([]),
    }),
    kind: "look",
  },
  player_status: { args: z.object({}), data: PlayerStatusSchema, kind: "look" },
  pointed_at: { args: z.object({}), data: PointedAtSchema, kind: "look" },
  // FC-162: what the machines the player asked about have really made, from each machine's own craft count.
  // FC-164: the active list, pushed to the game for its read-only panel. The player shows or hides it; only the
  // companion changes what's on it.
  set_list: {
    args: z.object({ name: z.string(), items: luaArray(z.object({ text: z.string(), done: z.boolean(), note: z.string().optional() })) }),
    data: z.object({ shown: z.number(), name: z.string() }),
    kind: "look",
  },
  logistic_network: { args: z.object({}), data: LogisticNetworkSchema, kind: "look" },
  // Character control (FC-168): the player confirms it in a card, and it only ever touches the companion's section.
  set_requests: { args: z.object({ items: luaArray(z.object({ name: z.string(), count: z.number() })) }), data: SetRequestsSchema, kind: "character_control" },
  clear_requests: { args: z.object({ remove: z.boolean().optional() }), data: z.object({ found: z.boolean(), removed: z.boolean(), active: z.boolean(), slots: z.number().optional() }), kind: "small_request" },
  stock: { args: z.object({ radius: z.number().positive().max(64).optional() }), data: StockSchema, kind: "look" },
  debug_toggle_list: { args: z.object({}), data: z.object({ shown: z.boolean() }), kind: "look" },
  spidertrons: { args: z.object({}), data: SpidertronsSchema, kind: "look" },
  // Character control (FC-144): the player confirms it in a card, and the stop key cancels it.
  send_spidertron: {
    args: z.object({ x: z.number(), y: z.number(), surface: z.string().optional(), unit_number: z.number().optional() }),
    data: z.object({ name: z.string(), unit_number: z.number(), x: z.number(), y: z.number(), distance: z.number(), surface: z.string() }),
    kind: "character_control",
  },
  stop_control: { args: z.object({}), data: z.object({ stopped: z.boolean(), control: z.string().optional(), entity: z.string().optional(), surface: z.string() }), kind: "small_request" },
  debug_press_stop: { args: z.object({}), data: z.object({ stopped: z.boolean() }), kind: "look" },
  machine_output: { args: z.object({ entities: luaArray(EntityRefSchema).optional(), radius: z.number().positive().max(64).optional(), restart: z.boolean().optional() }), data: MachineOutputSchema, kind: "look" },
  container_contents: { args: z.object({ name: z.string(), x: z.number(), y: z.number() }), data: ContainerContentsSchema, kind: "look" },
  debug_select_entity: { args: z.object({ name: z.string().optional(), x: z.number().optional(), y: z.number().optional() }), data: z.object({ selected: z.boolean() }), kind: "look" },
  map_id: { args: z.object({}), data: z.object({ map_id: z.string().optional() }), kind: "look" },
  surroundings: { args: z.object({ radius: z.number().positive().max(64).optional(), resource_radius: z.number().positive().max(96).optional() }), data: SurroundingsSchema, kind: "look" },
  queue_research: { args: z.object({ technology: z.string() }), data: z.object({ queued: z.string(), queue: luaArray(z.string()) }), kind: "small_request" },
  add_map_tag: { args: z.object({ x: z.number().optional(), y: z.number().optional(), surface: z.string().optional(), text: z.string().max(200) }), data: z.object({ x: z.number(), y: z.number(), text: z.string() }), kind: "small_request" },
  camera_to: { args: z.object({ x: z.number(), y: z.number(), surface: z.string().optional() }), data: z.object({ surface: z.string(), x: z.number(), y: z.number() }), kind: "small_request" },
  mark_upgrade: { args: TargetsSchema.extend({ target: z.string().optional() }), data: ApplyResultSchema, kind: "map_change" },
  screenshot: {
    args: z.object({ x: z.number().optional(), y: z.number().optional(), size: z.number().optional(), zoom: z.number().optional(), from: z.enum(["character", "view"]).optional() }),
    data: z.object({ path: z.string(), surface: z.string(), x: z.number(), y: z.number(), size: z.number(), zoom: z.number(), tiles: z.number() }),
    kind: "look",
  },
  set_train_stop: {
    args: TargetsSchema.extend({ limit: z.number().int().min(-1).optional(), priority: z.number().int().min(0).max(255).optional(), name: z.string().min(1).max(200).optional() }),
    data: z.object({ done: z.number(), rejected: z.preprocess((v) => (Array.isArray(v) ? {} : v), z.record(z.string(), z.number())) }),
    kind: "map_change",
  },
  set_recipe: {
    args: TargetsSchema.extend({ recipe: z.string() }),
    data: ApplyResultSchema.omit({ undo_items: true }).extend({ to_inventory: z.number(), spilled: z.number() }),
    kind: "map_change",
  },
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
  get_selection: {
    args: z.object({ seq: z.number() }),
    data: z.object({ seq: z.number(), count: z.number(), surface: z.string(), blueprint: z.string().optional() }),
    kind: "look",
  },
  debug_select_area: {
    args: z.object({ radius: z.number().positive().max(200).optional(), x: z.number().optional(), y: z.number().optional() }),
    data: z.object({ seq: z.number(), count: z.number(), surface: z.string() }),
    kind: "look",
  },
  debug_refresh_rates: { args: z.object({}), data: z.object({}).passthrough(), kind: "look" },
} as const;

export type ActionName = keyof typeof actions;
export type ActionArgs<A extends ActionName> = z.input<(typeof actions)[A]["args"]>;
export type ActionData<A extends ActionName> = z.output<(typeof actions)[A]["data"]>;

export function isActionName(name: string): name is ActionName {
  return Object.hasOwn(actions, name);
}
