// FC-150: generates the console's sound effects with the player's ElevenLabs key (ELEVENLABS_API_KEY or ELEVEN_LABS_KEY
// in .env) into data/sounds/. Skips sounds that already exist unless --force (or names given: bun run sounds -- done).
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateSound, SOUND_NAMES, type SoundName } from "../server/src/sfx";
import { elevenLabsKey } from "../server/src/tts";

const key = elevenLabsKey();
if (!key) {
  console.error("No ElevenLabs key: add ELEVENLABS_API_KEY=... to .env at the top of the repo.");
  process.exit(1);
}
const args = Bun.argv.slice(2);
const force = args.includes("--force");
const named = args.filter((a) => !a.startsWith("--")) as SoundName[];
const unknown = named.filter((n) => !SOUND_NAMES.includes(n));
if (unknown.length) { console.error(`Unknown sounds: ${unknown.join(", ")}. Known: ${SOUND_NAMES.join(", ")}`); process.exit(1); }
const dir = join(import.meta.dir, "../data/sounds");
mkdirSync(dir, { recursive: true });

let failed = 0;
for (const name of named.length ? named : SOUND_NAMES) {
  const file = join(dir, `${name}.mp3`);
  if (existsSync(file) && !force && !named.length) { console.log(`${name}: already there`); continue; }
  try {
    const bytes = await generateSound(key, name);
    await Bun.write(file, bytes);
    console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    failed++;
    console.error(`${name}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
