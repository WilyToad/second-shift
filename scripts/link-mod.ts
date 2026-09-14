// Symlinks mods/factorio-companion into the Factorio mods folder and enables it.
import { existsSync, lstatSync, readlinkSync, symlinkSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MODS_DIR, isFactorioRunning } from "./lib/factorio";

const source = resolve(import.meta.dir, "../mods/factorio-companion");
const target = join(MODS_DIR, "factorio-companion");
const modList = join(MODS_DIR, "mod-list.json");

if (isFactorioRunning()) {
  console.error("Factorio is running. Close it first: it rewrites mod-list.json on exit.");
  process.exit(1);
}

if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
  const stat = lstatSync(target);
  if (!stat.isSymbolicLink() || resolve(MODS_DIR, readlinkSync(target)) !== source) {
    console.error(`${target} already exists and isn't a link to this repo. Remove it first.`);
    process.exit(1);
  }
  console.log("Mod link already in place.");
} else {
  symlinkSync(source, target, "dir");
  console.log(`Linked ${target} -> ${source}`);
}

const list = (await Bun.file(modList).json()) as { mods: { name: string; enabled: boolean }[] };
const entry = list.mods.find((m) => m.name === "factorio-companion");
if (entry?.enabled) {
  console.log("Mod already enabled in mod-list.json.");
} else {
  const backupDir = join(import.meta.dir, "../data/backups");
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(modList, join(backupDir, `mod-list.json.${new Date().toISOString().replace(/[:.]/g, "-")}`));
  if (entry) entry.enabled = true;
  else list.mods.push({ name: "factorio-companion", enabled: true });
  await Bun.write(modList, JSON.stringify(list, null, 2) + "\n");
  console.log("Enabled factorio-companion in mod-list.json (backup in data/backups).");
}
