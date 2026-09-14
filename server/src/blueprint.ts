// Blueprint strings: "0" + base64(zlib(JSON)). Blueprints, books and planners share the envelope.
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";

export const BlueprintEntitySchema = z.looseObject({
  entity_number: z.number(),
  name: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  direction: z.number().optional(), // 2.0: 16 directions, 0 = north, 4 = east, 8 = south, 12 = west
  recipe: z.string().optional(),
  quality: z.string().optional(),
});
export type BlueprintEntity = z.infer<typeof BlueprintEntitySchema>;

export const BlueprintSchema = z.looseObject({
  item: z.literal("blueprint"),
  label: z.string().optional(),
  entities: z.array(BlueprintEntitySchema).default([]),
  tiles: z.array(z.looseObject({ name: z.string(), position: z.object({ x: z.number(), y: z.number() }) })).optional(),
  version: z.number().optional(),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

export type BlueprintRecord = { blueprint?: unknown; blueprint_book?: unknown; deconstruction_planner?: unknown; upgrade_planner?: unknown };

export class BlueprintStringError extends Error {}

const STRING_SHAPE = /^0[A-Za-z0-9+/]+=*$/;

export function looksLikeBlueprintString(text: string): boolean {
  return text.length > 20 && STRING_SHAPE.test(text);
}

export function decodeBlueprintString(text: string): BlueprintRecord {
  const s = text.trim();
  if (!s.startsWith("0")) throw new BlueprintStringError("Unsupported blueprint string version (expected it to start with 0).");
  try {
    return JSON.parse(inflateSync(Buffer.from(s.slice(1), "base64")).toString("utf8"));
  } catch (e) {
    throw new BlueprintStringError(`Not a valid blueprint string: ${(e as Error).message}`);
  }
}

export function encodeBlueprintString(record: BlueprintRecord): string {
  return "0" + deflateSync(Buffer.from(JSON.stringify(record), "utf8"), { level: 9 }).toString("base64");
}

/** Every blueprint in a record, flattening books (with their labels for context). */
export function blueprintsIn(record: BlueprintRecord, path = ""): { path: string; blueprint: Blueprint }[] {
  if (record.blueprint) {
    const bp = BlueprintSchema.parse(record.blueprint);
    return [{ path: path || bp.label || "blueprint", blueprint: bp }];
  }
  if (record.blueprint_book) {
    const book = record.blueprint_book as { label?: string; blueprints?: ({ index: number } & BlueprintRecord)[] };
    const base = path ? `${path} / ${book.label ?? "book"}` : book.label ?? "book";
    return (book.blueprints ?? []).flatMap((entry) => blueprintsIn(entry, base));
  }
  return [];
}
