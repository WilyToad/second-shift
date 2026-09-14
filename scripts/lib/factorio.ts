// Paths and helpers for the local Steam install of Factorio on macOS.
import { homedir } from "node:os";
import { join } from "node:path";

export const USER_DIR = join(homedir(), "Library/Application Support/factorio");
export const CONFIG_INI = join(USER_DIR, "config/config.ini");
export const MODS_DIR = join(USER_DIR, "mods");
export const SAVES_DIR = join(USER_DIR, "saves");
export const APP_DIR = join(homedir(), "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app");
export const BINARY = join(APP_DIR, "Contents/MacOS/factorio");
export const RUNTIME_API_JSON = join(APP_DIR, "Contents/doc-html/runtime-api.json");

export function isFactorioRunning(): boolean {
  const r = Bun.spawnSync(["pgrep", "-f", "factorio.app/Contents/MacOS/factorio"]);
  return r.stdout.toString().trim().length > 0;
}

/** Reads `key=value` lines from one INI section, ignoring commented lines. */
export function readIniSection(text: string, section: string): Map<string, string> {
  const out = new Map<string, string>();
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) { current = header[1]!; continue; }
    if (current !== section || line.startsWith(";") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return out;
}

export type RconSettings = { host: string; port: number; password: string };

/** RCON settings from the player's config.ini, or null if they aren't set. */
export async function readRconSettings(configPath = CONFIG_INI): Promise<RconSettings | null> {
  const other = readIniSection(await Bun.file(configPath).text(), "other");
  const socket = other.get("local-rcon-socket");
  const password = other.get("local-rcon-password");
  if (!socket || !password) return null;
  const [host, port] = socket.split(":");
  if (!host || !port || port === "0") return null;
  return { host, port: Number(port), password };
}

export async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const s = await Bun.connect({ hostname: host, port, socket: { data() {} } });
      s.end();
      return true;
    } catch {
      await Bun.sleep(500);
    }
  }
  return false;
}
