// FC-161 rig check: how many items a second a scripted feed really puts on one belt lane, for each way of
// inserting, so the build test's input belt is fed at the belt's own speed and not faster. Dev save hosted.
import { connectDevGame } from "../lib/devgame";
const dev = await connectDevGame();
const SURFACE = "companion-belt-feed";
const run = async (mode: "at-0" | "at-back", beltName: string) => {
  await dev.sc(`local s = game.get_surface("${SURFACE}") or game.create_surface("${SURFACE}")
    s.generate_with_lab_tiles = true s.always_day = true s.request_to_generate_chunks({0,0}, 2) s.force_generate_chunk_requests()
    for _, e in pairs(s.find_entities()) do e.destroy() end
    for x = 0, 9 do s.create_entity({ name = "${beltName}", position = { x + 0.5, 0.5 }, force = "player", direction = defines.direction.east }) end
    feed_belt = s.find_entity("${beltName}", { 0.5, 0.5 })
    drain_belt = s.find_entity("${beltName}", { 9.5, 0.5 })
    feed_count = 0 feed_by_item = { ["iron-plate"] = 0, ["copper-cable"] = 0 }
    script.on_nth_tick(1, function()
      local items = { "iron-plate", "copper-cable" }
      for i = 1, 2 do
        local line = feed_belt.get_transport_line(i)
        if ${mode === "at-0" ? 'line.can_insert_at(0)' : 'line.can_insert_at_back()'} then ${mode === "at-0" ? 'line.insert_at(0, { name = items[i] })' : 'line.insert_at_back({ name = items[i] })'} end
      end
      for i = 1, 2 do
        for _, name in pairs(items) do
          local n = drain_belt.get_transport_line(i).remove_item({ name = name, count = 100 })
          feed_count = feed_count + n
          feed_by_item[name] = feed_by_item[name] + n
        end
      end
    end)
    game.speed = 10 rcon.print("ok")`);
  await Bun.sleep(2000); // fill the line
  const a = JSON.parse(await dev.sc(`rcon.print(helpers.table_to_json({ n = feed_count, by = feed_by_item, tick = game.tick }))`));
  await Bun.sleep(3000);
  const z = JSON.parse(await dev.sc(`rcon.print(helpers.table_to_json({ n = feed_count, by = feed_by_item, tick = game.tick }))`));
  const perSecond = ((z.n - a.n) * 60) / (z.tick - a.tick);
  const per = Object.entries(z.by as Record<string, number>).map(([name, n]) => `${name} ${(((n - (a.by[name] ?? 0)) * 60) / (z.tick - a.tick)).toFixed(2)}/s`).join(", ");
  console.log(`${beltName} fed ${mode}: ${perSecond.toFixed(2)} items/s total (${per}); one lane carries ${(beltName === "transport-belt" ? 7.5 : beltName === "fast-transport-belt" ? 15 : 22.5).toFixed(1)}/s`);
  await dev.sc(`game.speed = 1 script.on_nth_tick(1, nil) rcon.print("ok")`);
};
await run("at-0", "transport-belt");
await run("at-back", "transport-belt");
await run("at-0", "express-transport-belt");
await dev.sc(`if game.get_surface("${SURFACE}") then game.delete_surface("${SURFACE}") end feed_belt = nil drain_belt = nil feed_count = nil feed_by_item = nil rcon.print("cleaned")`);
dev.rcon.close();
