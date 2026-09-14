// Hosts a save as a private local multiplayer game so RCON is available, then checks the mod answers.
// Usage: bun scripts/launch.ts [save.zip] [--dev]
//   --dev  no autosaves (use for save copies in data/ so your autosave slots aren't overwritten)
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isFactorioRunning, readRconSettings, spawnFactorio, waitForPort } from "./lib/factorio";
import { RconClient } from "../server/src/rcon";

const args = Bun.argv.slice(2);
const dev = args.includes("--dev");
const save = resolve(args.find((a) => !a.startsWith("--")) ?? join(import.meta.dir, "../data/saves/dev.zip"));

if (isFactorioRunning()) {
  console.error("Factorio is already running. Close it, then launch again.");
  process.exit(1);
}
if (!existsSync(save)) {
  console.error(`Save not found: ${save}`);
  process.exit(1);
}
const rcon = await readRconSettings();
if (!rcon) {
  console.error("RCON isn't enabled in config.ini (it may have been reverted). Run: bun run setup-rcon");
  process.exit(1);
}

const dataDir = join(import.meta.dir, "../data");
mkdirSync(dataDir, { recursive: true });
const settingsPath = join(dataDir, dev ? "server-settings.dev.json" : "server-settings.json");
if (!existsSync(settingsPath)) {
  await Bun.write(settingsPath, JSON.stringify({
    name: "second-shift",
    description: "Private local game for Second Shift",
    visibility: { public: false, lan: false },
    require_user_verification: false,
    max_players: 1,
    game_password: Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url"),
    auto_pause: false,
    only_admins_can_pause_the_game: true,
    autosave_interval: 10,
    autosave_slots: dev ? 0 : 5,
    autosave_only_on_server: true,
    non_blocking_saving: false,
  }, null, 2) + "\n");
}

console.log(`Hosting ${save}${dev ? " (dev: no autosaves)" : ""}…`);
// Started without Steam's relaunch (no "custom arguments" prompt); don't tie its lifetime to this script.
// Note: the client ignores --bind when hosting (rechecked 2026-09-14: still 0.0.0.0:34197). The port is
// protected by a random password, max_players 1 and no LAN or public listing.
const launchLog = join(dataDir, "factorio-launch.log");
spawnFactorio(["--host", save, "--server-settings", settingsPath], { logPath: launchLog }).unref();

const t0 = Date.now();
if (!(await waitForPort(rcon.host, rcon.port, 180_000))) {
  console.error("RCON never opened. Check factorio-current.log; the game may still be loading or config.ini was reverted.");
  process.exit(1);
}
const client = await RconClient.connect(rcon);
const reply = JSON.parse(await client.exec(`/companion ${JSON.stringify({ id: 1, action: "info" })}`));
client.close();
if (!reply.ok) {
  console.error("RCON is up but the mod didn't answer:", reply);
  process.exit(1);
}
if (/requires game restart/i.test(await Bun.file(launchLog).text().catch(() => ""))) {
  console.warn("Note: Steam relaunched the game anyway, so its launch prompt may have appeared.");
}
console.log(`Ready after ${((Date.now() - t0) / 1000).toFixed(1)} s: protocol ${reply.data.protocol}, mod ${reply.data.mod_version}, base ${reply.data.game_version}, tick ${reply.data.tick}`);
