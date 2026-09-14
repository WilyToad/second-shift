// Enables local RCON in the player's real config.ini. Factorio must be closed:
// the game rewrites config.ini on exit and would discard the change.
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_INI, isFactorioRunning, readRconSettings } from "./lib/factorio";

const SOCKET = "127.0.0.1:27015";

if (isFactorioRunning()) {
  console.error("Factorio is running. Close it first: it rewrites config.ini on exit.");
  process.exit(1);
}

const existing = await readRconSettings();
if (existing) {
  console.log(`RCON already enabled on ${existing.host}:${existing.port}. Nothing to do.`);
  process.exit(0);
}

const backupDir = join(import.meta.dir, "../data/backups");
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `config.ini.${new Date().toISOString().replace(/[:.]/g, "-")}`);
copyFileSync(CONFIG_INI, backup);

const password = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
let text = await Bun.file(CONFIG_INI).text();
const setKey = (key: string, value: string) => {
  const line = new RegExp(`^;?\\s*${key}=.*$`, "m");
  if (line.test(text)) text = text.replace(line, `${key}=${value}`);
  else text = text.replace(/^\[other\]\s*$/m, `[other]\n${key}=${value}`);
};
setKey("local-rcon-socket", SOCKET);
setKey("local-rcon-password", password);
await Bun.write(CONFIG_INI, text);

const check = await readRconSettings();
if (!check) {
  console.error(`Couldn't verify the change. Restore the backup: ${backup}`);
  process.exit(1);
}
console.log(`RCON enabled on ${SOCKET} (password stored in config.ini). Backup: ${backup}`);
