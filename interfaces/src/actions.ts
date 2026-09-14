// Mod actions the server may call, with the shape of their data. Unknown actions are rejected here
// before anything reaches the game.
import { z } from "zod";
import { DigestSchema } from "./digest";
import { PrototypesSchema } from "./prototypes";

export const InfoSchema = z.object({
  protocol: z.number(),
  mod_version: z.string(),
  game_version: z.string(),
  tick: z.number(),
  mods: z.record(z.string(), z.string()),
  players: z.number(),
});

export const actions = {
  ping: { args: z.object({}), data: z.object({ tick: z.number() }) },
  info: { args: z.object({}), data: InfoSchema },
  digest: { args: z.object({}), data: DigestSchema },
  dump_prototypes: { args: z.object({}), data: PrototypesSchema },
} as const;

export type ActionName = keyof typeof actions;
export type ActionArgs<A extends ActionName> = z.input<(typeof actions)[A]["args"]>;
export type ActionData<A extends ActionName> = z.output<(typeof actions)[A]["data"]>;

export function isActionName(name: string): name is ActionName {
  return Object.hasOwn(actions, name);
}
