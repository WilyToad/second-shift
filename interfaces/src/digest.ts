// The small, frequently polled summary of game state (mod action "digest").
import { z } from "zod";
import { luaArray } from "./protocol";

export const RateSchema = z.object({ name: z.string(), per_minute: z.number() });

const lookup = (v: unknown) => (Array.isArray(v) ? {} : v);

export const StuckRecipeSchema = z.object({
  recipe: z.string(),
  total: z.number(),
  stuck: z.number(),
  statuses: z.preprocess(lookup, z.record(z.string(), z.number())),
});

export const DigestSchema = z.object({
  tick: z.number(),
  paused: z.boolean().optional(),
  // FC-137: made once per map by the mod, so the app keeps one conversation per map.
  map_id: z.string().optional(),
  machines: z.object({
    progress: z.object({ machines: z.number(), scanned: z.boolean(), refresh_ticks: z.number() }),
    stuck: luaArray(z.object({ surface: z.string(), recipes: luaArray(StuckRecipeSchema) })),
  }).optional(),
  player: z.object({
    name: z.string(),
    surface: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    // FC-092: in remote view `position` is where the player looks; the character is here.
    remote_view: z.boolean().optional(),
    character_surface: z.string().optional(),
    character_position: z.object({ x: z.number(), y: z.number() }).optional(),
  }).optional(),
  research: z.object({
    current: z.string().optional(),
    progress: z.number(),
    queue: luaArray(z.string()),
  }),
  surfaces: luaArray(z.object({
    name: z.string(),
    platform: z.string().optional(),
    produced: luaArray(RateSchema),
    consumed: luaArray(RateSchema),
    science: luaArray(RateSchema.extend({ per_minute_10h: z.number() })).default([]),
    age_ticks: z.number(),
  })),
  alerts: luaArray(z.object({ surface: z.string().optional(), type: z.string(), count: z.number() })),
});
export type Digest = z.infer<typeof DigestSchema>;
