// Regenerates the logo SVGs in this folder, with the wordmark outlined so it renders without the font.
// The SVGs are the source of truth; run this only to change the mark or lockup:
//   bun add --no-save opentype.js && bun brand/logo/generate.ts
import opentype from "opentype.js";
const out = import.meta.dir;
// Google Fonts serves a static TTF instance of Big Shoulders Display 800 (opentype.js reads TTF, not woff2).
const buf = await (await fetch("https://fonts.gstatic.com/s/bigshouldersdisplay/v24/fC1MPZJEZG-e9gHhdI4-NBbfd2ys3SjJCx12wPgf9g-_3F0YdQ88JF4.ttf")).arrayBuffer(); const font = opentype.parse(buf);
const C = { steel: "#1c1a18", plate: "#25221f", paper: "#ebe5d9", cyan: "#7cc4d8", cyanDeep: "#256f85", dimLight: "#3a352f", dimDark: "#4a4540" };

// The mark: a chamfered helmet (a bolt head, a factory part) with a two-pane visor. The right pane is lit:
// the second engineer on shift beside you.
const mark = (helmet: string, visor: string, dim: string) => `
  <path d="M19 6h26l13 13v26L45 58H19L6 45V19z" fill="${helmet}"/>
  <path d="M12 24h19l-3 15H12z" fill="${dim}"/>
  <path d="M35 24h17v15H32z" fill="${visor}"/>`;

function word(text: string, size: number, x: number, baseline: number, tracking: number) {
  let d = ""; let cx = x;
  for (const g of font.stringToGlyphs(text)) {
    d += g.getPath(cx, baseline, size).toPathData(2);
    cx += (g.advanceWidth! / font.unitsPerEm) * size + tracking;
  }
  return { d, width: cx - tracking - x };
}
const svg = (w: number, h: number, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

await Bun.write(`${out}/mark.svg`, svg(64, 64, mark(C.paper, C.cyan, C.dimLight), "Second Shift"));
await Bun.write(`${out}/mark-on-light.svg`, svg(64, 64, mark(C.steel, C.cyanDeep, C.dimDark), "Second Shift"));
await Bun.write(`${out}/favicon.svg`, svg(64, 64, `<rect width="64" height="64" rx="12" fill="${C.plate}"/><g transform="translate(5 5) scale(0.844)">${mark(C.paper, C.cyan, C.dimLight)}</g>`, "Second Shift"));

// Lockup: mark + wordmark. Cap height of Big Shoulders ≈ 0.7 em; size so caps match the helmet body (≈ 40 px).
const size = 58, gap = 18, baseline = 52;
const w = word("SECOND SHIFT", size, 64 + gap, baseline, size * 0.02);
const W = Math.ceil(64 + gap + w.width + 2);
const lockup = (helmet: string, visor: string, vent: string, ink: string) =>
  `<g transform="translate(0 0)">${mark(helmet, visor, vent)}</g><path d="${w.d}" fill="${ink}"/>`;
await Bun.write(`${out}/lockup.svg`, svg(W, 64, lockup(C.paper, C.cyan, C.dimLight, C.paper), "Second Shift"));
await Bun.write(`${out}/lockup-on-light.svg`, svg(W, 64, lockup(C.steel, C.cyanDeep, C.dimDark, C.steel), "Second Shift"));
const wm = word("SECOND SHIFT", size, 0, baseline - 6, size * 0.02);
await Bun.write(`${out}/wordmark.svg`, svg(Math.ceil(wm.width + 1), 52, `<path d="${wm.d}" fill="${C.paper}"/>`, "Second Shift"));
console.log(`wrote logos to ${out}`);
