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
  machines: z.object({
    progress: z.object({ machines: z.number(), scanned: z.boolean(), refresh_ticks: z.number() }),
    stuck: luaArray(z.object({ surface: z.string(), recipes: luaArray(StuckRecipeSchema) })),
  }).optional(),
  player: z.object({
    name: z.string(),
    surface: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
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
