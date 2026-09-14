// Test tooling for the hosted dev save: /sc setup and inspection. Never used by agent-facing code.
import { readRconSettings } from "../../server/src/factorio";
import { RconClient } from "../../server/src/rcon";

export type Ref = { name: string; x: number; y: number };

export async function connectDevGame() {
  const rcon = await RconClient.connect({ ...(await readRconSettings())!, timeoutMs: 30_000 });
  // The first /sc on a save only answers the "disables achievements" prompt and returns nothing.
  const sc = async (lua: string) => { const a = (await rcon.exec(`/sc ${lua}`)).trim(); return a || (await rcon.exec(`/sc ${lua}`)).trim(); };
  const refsLua = (refs: Ref[]) => `helpers.json_to_table('${JSON.stringify(refs)}')`;
  return {
    rcon,
    sc,
    /** Places up to `max` straight rails east of the player where they fit. */
    async placeRailsEast(max = 8): Promise<{ placed: Ref[]; player: { x: number; y: number } }> {
      const r = JSON.parse(await sc(`
        local p = game.connected_players[1]; local s = p.surface; local placed = {}
        for dx = 4, 40, 2 do for dy = -8, 8, 2 do
          if #placed < ${max} then
            local pos = { x = math.floor(p.position.x / 2) * 2 + dx + 1, y = math.floor(p.position.y / 2) * 2 + dy + 1 }
            if s.can_place_entity({ name = "straight-rail", position = pos, force = p.force }) then
              local e = s.create_entity({ name = "straight-rail", position = pos, force = p.force })
              if e then placed[#placed + 1] = { name = e.name, x = e.position.x, y = e.position.y } end
            end
          end
        end end
        rcon.print(helpers.table_to_json({ placed = placed, player = { x = p.position.x, y = p.position.y } }))`));
      return { placed: Array.isArray(r.placed) ? r.placed : [], player: r.player };
    },
    async countMarked(refs: Ref[]): Promise<number> {
      return Number(await sc(`local p = game.connected_players[1] local n = 0 for _, r in pairs(${refsLua(refs)}) do local e = p.surface.find_entity(r.name, r) if e and e.to_be_deconstructed() then n = n + 1 end end rcon.print(n)`));
    },
    async destroy(refs: Ref[]): Promise<void> {
      if (refs.length) await sc(`local p = game.connected_players[1] for _, r in pairs(${refsLua(refs)}) do local e = p.surface.find_entity(r.name, r) if e then e.destroy() end end rcon.print("ok")`);
    },
  };
}
