// Runtime prototype data from the mod's `dump_prototypes` action: what is actually loaded in this
// save, modded content included. Entry objects are strict, so a field renamed or added in the mod
// fails validation instead of silently disappearing. Engine-provided sub-tables (ingredients,
// products, triggers) are kept loose because their optional fields vary by prototype.
import { z } from "zod";
import { luaArray } from "./protocol";

const IngredientSchema = z.looseObject({
  type: z.enum(["item", "fluid"]),
  name: z.string(),
  amount: z.number(),
});

const ProductSchema = z.looseObject({
  type: z.enum(["item", "fluid", "research-progress"]),
  name: z.string(),
  amount: z.number().optional(),
  amount_min: z.number().optional(),
  amount_max: z.number().optional(),
  probability: z.number().optional(),
});

const SurfaceConditionSchema = z.object({ property: z.string(), min: z.number().optional(), max: z.number().optional() });

export const RecipeSchema = z.strictObject({
  category: z.string(),
  energy: z.number(),
  ingredients: luaArray(IngredientSchema),
  products: luaArray(ProductSchema),
  enabled: z.boolean(),
  maximum_productivity: z.number(),
  surface_conditions: luaArray(SurfaceConditionSchema).optional(),
  allows_productivity: z.boolean().optional(),
  productivity_bonus: z.number().optional(), // researched, per force
});

export const ItemSchema = z.strictObject({
  type: z.string(),
  stack_size: z.number(),
  place_result: z.string().optional(),
  spoil_ticks: z.number().optional(),
  spoil_result: z.string().optional(),
  fuel_value: z.number().optional(),
});

export const FluidSchema = z.strictObject({ fuel_value: z.number().optional() });

export const TechnologySchema = z.strictObject({
  prerequisites: luaArray(z.string()),
  unlocks: luaArray(z.string()),
  count: z.number(),
  count_formula: z.string().optional(),
  ingredients: luaArray(z.object({ name: z.string(), amount: z.number() })),
  seconds_per_unit: z.number(),
  trigger: z.looseObject({ type: z.string() }).optional(),
  researched: z.boolean(),
});

export const MachineSchema = z.strictObject({
  type: z.string(),
  size: z.tuple([z.number(), z.number()]),
  module_slots: z.number().optional(),
  crafting_categories: luaArray(z.string()).optional(),
  crafting_speed: z.number().optional(),
  energy_usage: z.number().optional(),
  mining_speed: z.number().optional(),
  belt_speed: z.number().optional(),
  base_productivity: z.number().optional(), // e.g. foundry, electromagnetic plant, biochamber: 0.5
  // Inserters: revolutions per tick, bulk type, built-in hand size bonus, pickup/drop offsets when facing north.
  rotation_speed: z.number().optional(),
  bulk: z.boolean().optional(),
  hand_bonus: z.number().optional(),
  pickup: z.tuple([z.number(), z.number()]).optional(),
  drop: z.tuple([z.number(), z.number()]).optional(),
});

export const InserterBonusesSchema = z.object({ stack: z.number(), bulk: z.number() });

/** A buildable entity's footprint: tile size and collision box [left, top, right, bottom] around its position. */
export const EntityFootprintSchema = z.strictObject({
  type: z.string(),
  size: z.tuple([z.number(), z.number()]),
  collision: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export const PrototypesSchema = z.strictObject({
  recipes: z.record(z.string(), RecipeSchema),
  items: z.record(z.string(), ItemSchema),
  fluids: z.record(z.string(), FluidSchema),
  technologies: z.record(z.string(), TechnologySchema),
  machines: z.record(z.string(), MachineSchema),
  // Older captures predate this section.
  entities: z.record(z.string(), EntityFootprintSchema).default({}),
  // Gathered, not crafted: mined resources, harvested plants/fish, pumped tile fluids, asteroid chunks.
  raw_resources: luaArray(z.string()).default([]),
  // Researched inserter hand size bonuses (dump v6).
  inserter_bonuses: InserterBonusesSchema.default({ stack: 0, bulk: 0 }),
});
export type Prototypes = z.infer<typeof PrototypesSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Technology = z.infer<typeof TechnologySchema>;
export type Machine = z.infer<typeof MachineSchema>;
