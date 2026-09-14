// Builds the static site into website/dist (HTML, CSS, JS and hashed media). `bun run site:build`
import { cpSync, existsSync, rmSync } from "node:fs";

const root = import.meta.dir;
const out = `${root}/dist`;
rmSync(out, { recursive: true, force: true });
const result = await Bun.build({ entrypoints: [`${root}/src/index.html`], outdir: out, minify: true });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// Link previews need a stable, unhashed image path.
if (existsSync(`${root}/src/og.png`)) cpSync(`${root}/src/og.png`, `${out}/og.png`);
const bytes = result.outputs.reduce((n, o) => n + o.size, 0);
console.log(`Built ${result.outputs.length} files (${(bytes / 1e6).toFixed(1)} MB) into website/dist`);
