# Second Shift website

A single static page, built with Bun from `src/` and following the [brand guide](../brand/BRAND.md).

```sh
bun run site:dev      # dev server with reload on http://localhost:5181
bun run site:build    # static build into website/dist (hashed assets, ~7 MB, mostly video)
bun run site:serve    # serve the build as a static host would, on http://127.0.0.1:5180
```

| Path | What it is |
|---|---|
| `src/index.html`, `site.css`, `site.ts` | The page. CSS loads `brand/tokens.css`; the script only plays clips while they're on screen (and not for reduced motion) |
| `src/media/` | Web versions of the captures (2× clips and stills from `scripts/capture/`) and artwork |
| `src/og.png` | Link-preview image, copied to the build root unhashed |
| `art/` | Original Codex artwork and the prompts that made it ([PROMPTS.md](art/PROMPTS.md)) |
| `social/` | The social card (`card.html`) and `render.ts`, which writes `src/og.png` and `docs/media/social-preview.png` |

## Updating media

1. Re-record clips with `bun scripts/capture/scene.ts …` (dev save hosted, server running).
2. Re-encode for the web with `bun scripts/capture/assemble.ts <frames dir> website/src/media/<name>.mp4 --scale 2400`.
3. `bun website/social/render.ts` if the hero capture changed, then `bun run site:build`.

## Deploying

Not deployed yet. `website/dist` is a plain static folder, so it can go to Cloudflare as static assets. Before
deploying, set `og:image` in `src/index.html` to the absolute URL on the final domain; link previews ignore relative
image paths.
