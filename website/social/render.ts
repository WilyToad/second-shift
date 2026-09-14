// Renders the social card: website/src/og.png (1200×630, link previews) and docs/media/social-preview.png
// (1280×640, upload in the GitHub repo's settings). Uses the capture tooling's headless Chromium.
import { session } from "../../scripts/capture/console";

const card = `file://${import.meta.dir}/card.html`;
const root = `${import.meta.dir}/../..`;
for (const [width, height, out] of [[1200, 630, `${root}/website/src/og.png`], [1280, 640, `${root}/docs/media/social-preview.png`]] as const) {
  const s = await session("social-card", { width, height, scale: 1 });
  await s.send("Page.navigate", { url: card });
  await s.waitFor("document.readyState === 'complete' && document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)", 15000);
  await Bun.sleep(400);
  await s.still(out);
  await s.close();
  console.log(`wrote ${out}`);
}
