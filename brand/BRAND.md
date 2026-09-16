# Second Shift brand and style guide

One guide for every surface: the GitHub repo, the web console beside the game, the mod, and the website.
Values live in [`tokens.css`](tokens.css); this file says how to use them. If a surface needs something the
guide doesn't cover, add it here first, then build it.

## The idea

Second Shift is **a second engineer in your helmet.** It watches your factory with you, answers in plain
words from your own game, and does only what you could do yourself. It never plays for you.

Everything in the brand comes from that picture:

- **The helmet.** The companion sees what you see and reaches what you reach. The logo is a helmet with its visor lit.
- **The shift.** A coworker on the factory floor who reads your factory for you. Warm steel, work lights, and signage type.
- **Cyan means the companion.** In the console, on the website and in the logo, cyan marks what the companion says, proposes or does. Nothing else uses it.

## Name

| Use | Don't use |
|---|---|
| **Second Shift** (two words, title case) | 2nd Shift, SecondShift, Second-Shift, SECOND SHIFT in running text |
| `second-shift` for the mod id, repo, package and URLs | `factorio-companion` (the old working name) |
| "the companion" for the assistant inside the product | "the AI", "the bot", "Claude", or a model name |

- **Tagline:** *A second engineer in your helmet.*
- **One-liner:** *A local AI companion for Factorio 2.0 that answers from your own game and can only do what you could.*
- **Uppercase:** only in the wordmark and in `label`-style captions.
- **Factorio credit:** Factorio is a trademark of Wube Software. Say "for Factorio", never imply it's official, and don't use Wube's logo or the Factorio gear wordmark.

## Voice

The companion talks like a good coworker on the radio: short, specific, calm. The docs and website use the same voice.

- **Numbers, not adjectives.** "Iron plates: 1,840/min made, 2,100/min used." Not "your iron is running low!"
- **Say where facts came from.** "From your save:" or the recipe line, not recipe knowledge from memory.
- **Say what it can't do, and the way forward.** "That spot is in fog of war, so I can't place there. Walk closer or add radar coverage."
- **Active voice; controls say what happens.** A button says "Approve", and the result says "Placed 12 ghosts".
- **No hype, no exclamation marks, no emoji** in product copy or docs.
- **Talk to the player as "you"**, and write the companion's actions in the first person ("I found…").

| Instead of | Write |
|---|---|
| "Supercharge your factory with AI!" | "Ask how many assemblers you need, and get the number from your save." |
| "Oops! Something went wrong." | "The game didn't answer over RCON. Is it hosted? Run `bun run launch`." |
| "The agent will now execute the blueprint placement." | "Paste this as ghosts at the map view? Your robots build it." |

## Logo

Files in [`logo/`](logo/). The SVGs are the source; the wordmark is outlined, so it renders without the font.

| File | Use |
|---|---|
| `lockup.svg` | Mark + wordmark on dark grounds: README header (dark mode), website header, social card |
| `lockup-on-light.svg` | The same on light grounds: README header (light mode), printed or light pages |
| `mark.svg` / `mark-on-light.svg` | The helmet alone: avatars, small spaces, mod thumbnail |
| `favicon.svg` | Browser tabs: the mark on a plate tile |
| `wordmark.svg` | Wordmark alone, when the mark is already on screen |

**The mark:** a chamfered helmet (it doubles as a bolt head) with a two-pane visor. The left pane is dark, the right one lit: you, and the second engineer on shift beside you.

- **Clear space:** keep at least half the mark's height clear on every side.
- **Minimum size:** 16 px for the mark (favicon) and 20 px tall for the lockup.
- **Don't:** recolour the lit pane to anything but visor cyan, light both panes, round the corners, add a gear, outline, shadow or glow, stretch it, or set the wordmark in another face.
- **On GitHub**, switch versions with a `<picture>` element so the header works in both themes (see the README header).

## Colour

Dark first, because the console sits beside a dark game on a second monitor. The website is dark too. Light grounds appear only where we don't control the theme (GitHub light mode), and there we use the `on-light` logos.

### Steel (grounds and surfaces)

| Token | Hex | Name | Use |
|---|---|---|---|
| `--ground` | `#1c1a18` | Night steel | Page ground |
| `--inset` | `#151412` | Sump | Inputs, wells, code blocks |
| `--panel` | `#25221f` | Plate | Panels, cards |
| `--panel-2` | `#2e2a26` | Raised plate | Selected tabs, hover, the player's own messages |
| `--seam` | `#3a352f` | Seam | Borders, dividers, the dark visor pane |

### Ink

| Token | Hex | Name | Contrast on ground | Use |
|---|---|---|---|---|
| `--text` | `#ebe5d9` | Paper | 13.8 : 1 | Body text, headings, the helmet |
| `--muted` | `#a39b8e` | Dust | 6.3 : 1 | Secondary text, labels |
| `--faint` | `#70695f` | Ash | 3.2 : 1 | Metadata only (timestamps, token counts), never needed to act |

### Visor cyan (the companion)

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--agent` | `#7cc4d8` | 8.9 : 1 on ground | Companion actions and buttons, approval cards, focus rings, links on the website, the lit visor |
| `--agent-dim` | cyan at 12 % | n/a | Fill behind an approval card |
| `--on-agent` | `#10232a` | 8.3 : 1 on cyan | Text on cyan buttons |
| `--agent-deep` | `#256f85` | 5.2 : 1 on light | The visor and links on light grounds only |

Cyan is never decoration: no cyan section backgrounds, gradients or glows. If a thing isn't the companion or an action you can take, it isn't cyan.

### Signals (state only)

| Token | Hex | Meaning |
|---|---|---|
| `--ok` | `#86bf5b` | Done, powered, healthy |
| `--amber` | `#eaa13c` | Warning: worth a look soon (low ammo, full buffer, missing research) |
| `--crit` | `#e8685a` | Critical: attacks, failures, refusals |

Every signal also has a shape or a word (an alert stripe, a pill label, "failed"). Colour is never the only cue.

## Type

All three faces are under the SIL Open Font License and ship in [`fonts/`](fonts/) (Latin subset, woff2), so the console works offline.

| Role | Face | Where |
|---|---|---|
| Display | **Big Shoulders Display** 700–800 | Website headlines, the wordmark, big numbers on the website. Never in the console's running UI and never below 23 px |
| UI and body | **Titillium Web** 400 / 600 / 700 | Everything else. It's the face of Factorio's own interface, so the console feels like part of the game |
| Data | **IBM Plex Mono** 400 / 500 | Rates, counts, coordinates, commands, code, status pills. Always `tabular-nums` |

- **Scale (1.25 from 15 px):** 12 meta · 13 small · **15 body** · 19 lead · 23 h3 · 29 h2 · 46 h1 · 72 hero.
- **Labels:** 11 px Titillium 600, uppercase, letter-spacing 0.09 em, Dust.
- **Headlines:** Big Shoulders in title case, tight leading (1.0–1.1), `text-wrap: balance`. Uppercase only for short labels of three words or fewer.
- **Line length:** 60–75 characters for running text.

## Shape and layout

- **Radius:** 4 px on panels and cards, 3 px on buttons and pills. Nothing fully rounded except status dots.
- **Borders:** 1 px Seam. Panels are separated by seams, not shadows. No drop shadows in the console; on the website, only captures get one (to lift them off the ground).
- **Spacing:** 4 px base (4, 8, 12, 16, 24, 32, 48). Panels pad 10–14 px.
- **Grids:** the console has three columns (alerts · chat · live). The website uses a 12-column grid with a 1120 px max width and 16 px minimum gutters.

## Components

These are defined in `displays/src/chat.css`. The website reuses the same look when it shows the product.

| Component | Look | Rule |
|---|---|---|
| **Panel** | Plate, 1 px Seam, 4 px radius, header row with a label | The one container. Don't nest panels |
| **Pill** | Mono 13 px, Plate, Seam border, 3 px radius | Status only (`ok` / `warn` / `crit` colour the text, not the fill) |
| **Primary button** | Cyan fill, `--on-agent` text, 700 weight | One per group: the thing the companion will do |
| **Secondary button** | Transparent, Dust text, Seam border | Cancel, decline, and anything else |
| **Approval card** | Dashed cyan border, `--agent-dim` fill | A proposed map change, before you confirm. Turns solid green when done, red when failed |
| **Alert** | 3 px severity stripe on the left, bold title, meta row | Stripe colour = signal; newest first |
| **Tool line** | Mono 13 px, Dust, 2 px Seam rule on the left | What the companion looked up, in one line |
| **Rich text badge** | Small inline chip | Factorio `[item=…]` tags in names become badges, never raw tags |

## Imagery

**Captures are the product.** Every screenshot and animation of Second Shift is real: taken from a running game and the real console, with real answers. Never mock up an answer, edit numbers, or composite a feature that doesn't exist.

- **Console captures:** 1440 × 900 browser viewport, 2× where possible, PNG. Crop to one panel or the whole console, never mid-panel.
- **Game captures:** the game at its normal UI scale, JPEG or PNG. Add no arrows or circles inside the game image; put captions beside it.
- **Animations:** short loops (4–12 s) of one interaction, no cursor trails or watermark overlays. MP4/WebM on the website; GIF (under 5 MB) in the README.
- **On the website**, captures sit on Plate with a 1 px Seam border, a 4 px radius and one soft shadow.

**Illustration** (website only) comes from Codex image generation. It supports the captures and never stands in for them. It follows one art direction:

> Painterly industrial illustration, top-down or three-quarter view of a factory floor at night: conveyor belts, assemblers and pipes under warm work lights in muted steel and rust tones, with one cool cyan light source from a helmet visor or a screen. Low saturation, heavy shadow, no text, no logos, no UI, no people's faces, not the Factorio art style.

- Name the files after what they show (`night-shift-floor.webp`, not `hero-2.webp`) and keep each prompt next to its image in `website/art/PROMPTS.md`.

## Surfaces checklist

| Surface | Must have |
|---|---|
| **GitHub repo** | Lockup header with `<picture>` for light and dark, the tagline, a hero capture, and the one-liner as the repo description. Social preview image (1280 × 640, Night steel ground, lockup and one capture). Topics: `factorio`, `factorio-mod`, `ai-assistant`, `local-llm`, `bun` |
| **Web console** | Tokens from `brand/tokens.css`, bundled fonts, mark and name in the top bar, `favicon.svg`, the title "Second Shift" |
| **Mod** | `info.json` title "Second Shift", the one-liner as description, `thumbnail.png` (144 × 144, the mark on a plate tile) |
| **Website** | Tokens from `brand/tokens.css`, lockup in the header, captures before illustration, dark only, the tagline as the first headline |
