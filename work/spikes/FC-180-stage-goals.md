# FC-180 — Stage goals: what the companion pushes for, and when

Spike, 2026-09-17. Nothing built, nothing installed, no game run. The deliverable is the authored
table below plus the rules for selecting a row from it.

**The player's ask:** "give the companion more purpose or direction at various stages … come up with
some opinionated goals or direction for the companion at those times that differs."

**What this is not:** a prompt rule telling the model to suggest goals. FC-171 is open because an
answer named a technology (`defensive-structures`) this save doesn't have, on a turn with nothing
retrieved to ground it. Asking the model for stage advice is the same turn shape with a bigger
surface. So: **every goal below is text a human wrote, every prototype name in it is verified against
`data/captures/prototypes.json`, and the row is chosen by a condition the save can prove.** The model's
only job is to say it in its own words, under the existing "name nothing that isn't in the lines" note
(`server/src/agent.ts:626`).

---

## 1. Verdict, and one correction to the brief

Build it. It's cheap: stage selection needs **zero new game calls** (§3), and the authored text is a
data table with a unit test that every name in it exists in the dump.

**Correction: this must not go in the system prompt.** The brief says the table ships inside the
cached stable prefix. Measured evidence says that costs ~0.8 s on every turn:

- `alignToCacheBlock` (`server/src/prompt.ts:172`) pads the stable prefix with reference lines until it
  *just crosses* the next 2,048-token boundary. Growth below the boundary is therefore **free** — it
  eats padding, not cache. FC-163 confirms it: adding `update_list` left the prompt at 3,876 tokens
  "inside the same cached 4,096-token block", first token median 1.29 s.
- So the free headroom is roughly `4,096 − 3,876 − 24 margin ≈ 200 tokens`. The whole table measures
  **~2,650 tokens** (§7, from character counts). It would cross into the 6,144-token block, and so
  would a single row: the median row is ~190 tokens, which is the entire headroom.
- PLAN §6 measured exactly that: system prompt at 6,169 tokens → follow-ups **2.75–2.85 s**, against
  **1.90–2.04 s** at 4,121. S25 measured the milder version: an 83-token overshoot cost 1.59–1.61 s vs
  1.31–1.50 s.

**Where it goes instead: the turn's tail**, the pattern already in the code —
`server/src/agent.ts:558`, "Turn guidance decided in code, kept in the uncached tail so the system
prompt stays stable", and FC-163's "the active list rides in the turn's tail". One matched stage block
is ~190 tokens (median, measured by character count); PLAN's suffix-prefill probe puts uncached tail
tokens at ~1 ms each (410 → 0.70 s, 1,215 → 1.14 s), so **~0.19 s on the turns that get it**, and
nothing on the turns that don't. That is the number to beat with §7's cut list, and it is worth
measuring for real before shipping rather than trusting the ratio.

The rejected alternative — matched stage block in the *system* prompt — is free per turn but rewrites
the stable prefix at every stage change, which invalidates history's cached blocks too: a cold prefill
(~42 s at 32k, absorbed only if we re-warm) plus re-alignment, mid-session. Tail wins.

**Which turns get it:** the existing `wantsStartAdvice` gate (`server/src/player.ts:34`, the `START`
regex — "what should I do", "what next", "where do I start", "help"). That path already fetches
`player_status`, `surroundings` and `researchOptions()`, already allows 80 words instead of 60, and
already carries the note "base next steps only on the inventory, hand-craftable, recipe, surroundings
and research lines; name no item, building or technology that isn't in them". That note is a literal
enumeration, so **it has to be edited to include the stage lines** or the model is being told to
ignore them — one word, but it's a required change, not a free ride. The stage block is **not** added
to ordinary questions, and never to a pointed-at, blueprint, packing or stop turn.

**And it has to fit the answer.** The `start` path allows 80 words; a row is three goals with recipe
amounts plus a miss, which doesn't fit, so the model will silently drop something. Say which: lead
with the first goal, give the second if it's relevant to what the save shows, and bring the
`classic miss:` in only when it bears on what they're doing right now. The third goal is the one that
gets truncated either way, which is the same conclusion as cut #2 in §7.

---

## 2. Cost classes for triggers

The mod's rules forbid full-surface sweeps on a timer, so every trigger below is class C0 or C1 only.

| Class | What | Cost |
|---|---|---|
| **C0** | `researched` flags on the server's cached `Prototypes`. No game call: `game.ts:patchResearch` keeps them current — whole force ~1.3 ms once on connect, ~0.08 ms per technology after one completes. A set lookup in TypeScript. | **free** |
| **C1** | Fields already in the polled digest: `player.surface` / `character_surface`, `surfaces[].platform`, `surfaces[].produced/consumed/science`, `machines.progress.machines`, `research.current/queue`. Digest handler 0.19–0.48 ms per poll, already paid. | **free** |
| **C2** | On demand, one ~17 ms RCON round trip: `player_status` 1.5–1.7 ms (inventory), `find_machines` 0.14–0.79 ms, `stock` 0.58 ms, `research_options`. | **not used to select a stage** |
| — | Anything needing a full-surface sweep. | **forbidden** |

**Inventory is deliberately not a trigger.** It costs a round trip and it's noisy — a player carrying
20 `transport-belt` proves nothing about their stage. On the `wantsStartAdvice` path `player_status`
is fetched anyway, so it can *refine* a goal ("you already have the plates for this"), but it never
selects the row.

---

## 3. Choosing a row: ordered, and one row always wins

Evaluate in this order; **first match wins**, and exactly one matches.

1. **On a space platform** — the character's surface is a platform surface → row **SP**. (C1) Test the
   *surface name* (`platform-1` in the capture, so `platform-<n>`), **not** membership of
   `digest.surfaces`: that list is filtered to surfaces with nonzero cached production
   (`digest.lua`), and a platform that was just built produces nothing yet — which is exactly when
   "ammo and repair before speed" is the advice that matters. The `surfaces[].platform` field is a
   second, later-firing confirmation, not the primary test. The `platform-<n>` naming is observed in
   one capture (`platform-1`, labelled "Rocket One"); the convention for other indices is inferred
   (§8).
2. **On a planet with a row** — the character's surface name matches a known planet: exact, else the
   longest known name the surface name starts with followed by `-` (factorissimo's
   `nauvis-factory-floor` resolves to `nauvis`) → rows **V / F / G / A**. `nauvis` has no row of its
   own and falls through. (C1)
3. **Several planets running** — two or more of `vulcanus`, `fulgora`, `gleba`, `aquilo` appear in
   `digest.surfaces` (which only lists surfaces with nonzero production or science, so this means
   *producing*, not merely visited) → row **N8**. (C1)
4. **The technology axis** — rows **N7 … N1**, tried from the most advanced down. (C0)
5. **Nothing matched** → the fallback row (§5). (C0)

Surface beats technology on purpose: a player standing on Gleba with a rocket silo at home wants Gleba
advice. `character_surface` (not `surface`) is used, so remote view doesn't change the stage.

**Why step 4 is total and unambiguous.** Each row is "gate G researched **and** the next gate not
researched", and the gates form a real chain in this save's dump, so the rows partition every
save:

| Row | Gate researched | Next gate (not researched) | Chain evidence from the dump |
|---|---|---|---|
| N1 | — | `automation-science-pack` | root of the tree; `prerequisites: [electronics, steam-power]`, both prerequisite-free triggers |
| N2 | `automation-science-pack` | `logistic-science-pack` | `logistic-science-pack.prerequisites = [logistics]`, `logistics.prerequisites = [automation-science-pack]` |
| N3 | `logistic-science-pack` | `oil-gathering` | `oil-gathering` research ingredients are `automation-science-pack` + `logistic-science-pack` *(soft link: an ingredient, not a prerequisite — its listed prerequisite is `fluid-handling`)* |
| N4 | `oil-gathering` | `chemical-science-pack` | `chemical-science-pack.prerequisites = [advanced-circuit, sulfur-processing]` → `sulfur-processing.prerequisites = [oil-processing]` → `oil-processing.prerequisites = [oil-gathering]` |
| N5 | `chemical-science-pack` | `construction-robotics` **or** `logistic-robotics` | both `prerequisites = [robotics]`; `robotics.prerequisites = [battery, electric-engine]`, and `battery`'s recipe needs `sulfuric-acid` |
| N6 | either robotics tech | `rocket-silo` | `rocket-silo.prerequisites` includes `logistic-robotics` |
| N7 | `rocket-silo` | `space-platform` | `space-platform.prerequisites = [rocket-silo]` |
| N8 | `space-platform` | — | see step 3; otherwise N7's successor row |

The **bots boundary is `construction-robotics` or `logistic-robotics`** (either unlocks `roboport`),
because that is the before/after-bots line the project cares about: before it, a pasted blueprint is a
plan; after it, ghosts build themselves (FC-172).

**Megabase is an overlay, not a row.** When `digest.machines.progress.machines >= 5000` (C1), one extra
line is appended to whichever row won. A megabase player on Gleba still gets Gleba advice. At most one
overlay line, ever.

---

## 4. The table

Shipped text is in the fenced blocks — that exact wording enters the turn tail. Prose outside the
blocks is for us.

### N1 — Counting rocks (pre-electric)

Trigger: `automation-science-pack` not researched. C0.

```
[stage: before power]
next: two burner-mining-drill feeding a pair of stone-furnace, coal on a belt, not in your hands; craft 50 iron-plate and steam-power unlocks itself; craft 10 copper-plate and electronics does
classic miss: mining by hand long after two drills would have paid for themselves
```

Register (ships as a note, not as a data line): *It has flown starships. It is counting rocks. Dry, unhurried.*

Dump-cited: `steam-power` trigger `craft-item iron-plate ×50`, `electronics` trigger
`craft-item copper-plate ×10`, both prerequisite-free; `burner-mining-drill` = 3 `iron-plate` +
3 `iron-gear-wheel` + 1 `stone-furnace`. The drill-payback claim is reasoning, not measurement.

### N2 — First electricity and red science

Trigger: `automation-science-pack` researched, `logistic-science-pack` not. C0.

```
[stage: first electricity]
next: offshore-pump, boiler, steam-engine, in that order, before anything else electric; electric-mining-drill on iron and copper; feed the labs with an inserter, not by hand — automation-science-pack is 1 copper-plate + 1 iron-gear-wheel and an assembling-machine-1 can make it
classic miss: hand-carrying coal. The boiler, the drills and the furnaces all want it on the same belt
```

Register (ships as a note, not as a data line): *Mildly surprised the arithmetic worked. Still calls it "your fire".*

Dump-cited: `automation-science-pack` recipe; `automation` unlocks `assembling-machine-1` and
`long-handed-inserter`; `electronics` unlocks `lab`, `inserter`, `small-electric-pole`; `steam-power`
unlocks `offshore-pump`, `boiler`, `steam-engine`, `pipe`, `pipe-to-ground`. Boiler/engine ratios are
deliberately absent — not in the dump (see §8).

### N3 — Green science and the first bus

Trigger: `logistic-science-pack` researched, `oil-gathering` not. C0.

```
[stage: green science]
next: steel-processing, then a second smelter column — steel-plate is 5 iron-plate, so it doubles your iron demand; automation-2 and logistics-2 for the machine and belt tier; logistic-science-pack is 1 transport-belt + 1 inserter, so belts and inserters get their own assemblers now
classic miss: building tight around the first furnaces. Leave the iron-plate, copper-plate, steel-plate and coal lanes room to widen, because they all will
```

Register (ships as a note, not as a data line): *Starts saying "the factory" instead of "your pile".*

Dump-cited: `logistic-science-pack` recipe, `steel-plate` recipe, `automation-2`
(prerequisites `automation`, `logistic-science-pack`, `steel-processing`; unlocks
`assembling-machine-2`), `logistics-2`, `steel-processing` (unlocks `steel-plate`, `steel-chest`).
"Leave room" is community wisdom.

### N4 — The oil wall

Trigger: `oil-gathering` researched, `chemical-science-pack` not. C0. Sub-signal (C1, optional):
`petroleum-gas` present in a surface's `produced` list means a refinery is actually running.

```
[stage: oil]
next: a pumpjack and an oil-refinery on basic-oil-processing — in this save that recipe makes petroleum-gas and nothing else (100 crude-oil to 45 petroleum-gas); then plastics (plastic-bar is 1 coal + 20 petroleum-gas) and sulfur-processing (sulfuric-acid is 1 iron-plate + 5 sulfur + 100 water); those two get you advanced-circuit, and chemical-science-pack is 1 sulfur + 3 advanced-circuit + 2 engine-unit
classic miss: treating this as a plumbing problem. Blue science here is a circuit problem — and the famous full-heavy-oil-tank stall can't happen yet, because basic-oil-processing makes no heavy-oil in this save
```

Register (ships as a note, not as a data line): *Fluid routing. Its actual field, at last.*

**Why this is the stall point.** Two reasons, and only the first is dump-cited. (a) It is the first
gate that needs a *new kind* of thing: a fluid, a second science building type, and a chain four
recipes deep from ore to pack (`petroleum-gas → plastic-bar → advanced-circuit → chemical-science-pack`,
plus `sulfur → sulfuric-acid` and `engine-unit` from steel). (b) Community wisdom (reddit/forum
"oil wall", "I quit at blue science") puts the drop-off here; that's reputation, not a measurement we
have.

**Correction to vanilla memory, and the reason this row exists at all:** in 1.1, basic oil processing
produced heavy, light and gas, so the classic mistake was heavy oil backing up. In **this save's dump**,
`basic-oil-processing` is `100 crude-oil -> 45 petroleum-gas`, full stop, and
`advanced-oil-processing` (the three-fluid one) has `chemical-science-pack` as a prerequisite *and* as a
research ingredient. So the backup mistake belongs one row later. A model answering from vanilla 1.1
memory would get this exactly wrong, which is the whole argument for authoring the text.

### N5 — Blue science and trains

Trigger: `chemical-science-pack` researched, neither `construction-robotics` nor `logistic-robotics`. C0.

```
[stage: blue science and rail]
next: advanced-oil-processing plus heavy-oil-cracking and light-oil-cracking — now heavy-oil can fill a tank and stop the refinery, so every fluid needs an exit; railway then automated-rail-transportation for train-stop, rail-signal and rail-chain-signal, and put the first ore outpost on rail; robotics wants battery and electric-engine, and electric-engine-unit needs 15 lubricant, so lubricant comes first
classic miss: signals. A plain rail-signal where a rail-chain-signal belongs deadlocks the junction, and an outpost with no stop limit pulls every train to one mine
```

Register (ships as a note, not as a data line): *Traffic control. It has opinions about traffic and finally shares them.*

Dump-cited: `advanced-oil-processing` (`50 water + 100 crude-oil -> 25 heavy-oil, 45 light-oil,
55 petroleum-gas`), `heavy-oil-cracking`, `light-oil-cracking`, `lubricant` (`10 heavy-oil -> 10
lubricant`), `electric-engine-unit` (`2 electronic-circuit + 1 engine-unit + 15 lubricant`), `railway`
(prerequisites `engine`, `logistics-2`; unlocks `rail`, `locomotive`, `cargo-wagon`),
`automated-rail-transportation` (unlocks `train-stop`, `rail-signal`, `rail-chain-signal`),
`robotics` (prerequisites `battery`, `electric-engine`). The signal mistake is community wisdom
(it is the single most-answered question in the game's forums); stop limits are a 2.0 feature the
project already acts on (`scripts/e2e-train-stops.ts`).

### N6 — After the bots

Trigger: `construction-robotics` or `logistic-robotics` researched, `rocket-silo` not. C0.

```
[stage: bots]
next: roboport coverage over the mall first — from here a pasted blueprint builds itself; you only have passive-provider-chest and storage-chest for now, because requester-chest and buffer-chest come with logistic-system, which needs space-science-pack; production-science-pack is 30 rail + 1 electric-furnace + 1 productivity-module, so rails and modules need real lines, not hand-crafting
classic miss: moving the main bus onto logistic robots. Bots are for the mall and the last few tiles; a belt lane still moves more iron for less power
```

Register (ships as a note, not as a data line): *Says "we" for the first time. Doesn't remark on it.*

Dump-cited: `construction-robotics` / `logistic-robotics` unlock lists (`roboport`,
`passive-provider-chest`, `storage-chest`, + the robot); `logistic-system` prerequisite
`space-science-pack`, unlocks `active-provider-chest`, `requester-chest`, `buffer-chest`;
`production-science-pack` recipe. The bots-vs-belts opinion is community wisdom plus reasoning
(robot charging draws power that a belt doesn't); we have no measurement.

### N7 — The rocket

Trigger: `rocket-silo` researched, `space-platform` not. C0.

```
[stage: rocket]
next: size processing-unit, low-density-structure and rocket-fuel together, because a rocket-part is one of each; a cargo-landing-pad (25 steel-plate, 10 processing-unit, 200 concrete) before the first launch, or what comes back has nowhere to land; stock space-platform-foundation deep — it's 20 steel-plate + 20 copper-cable each and the platform eats it
classic miss: launching before there's a plan for the return trip, and underbuilding concrete and processing-unit, which the silo and the landing pad both want by the hundred
```

Register (ships as a note, not as a data line): *Quietly proprietary about the silo. Doesn't mention the ship.*

Dump-cited: `rocket-silo` unlocks `rocket-silo`, `rocket-part`, `cargo-landing-pad`,
`space-platform-starter-pack`, `space-platform-foundation`; `rocket-part` =
`1 processing-unit + 1 low-density-structure + 1 rocket-fuel`; `cargo-landing-pad` and
`space-platform-foundation` recipes. **Not claimed:** how many rocket parts a launch takes — that
number is not in the dump (§8).

### N8 — First platform, space science

Trigger: `space-platform` researched, and fewer than two planet surfaces producing. C0 + C1.

```
[stage: orbit]
next: asteroid-collector and crusher on the platform, with gun-turret ammo pointing where you're going; space-science-pack is 1 ice + 2 iron-plate + 1 carbon, so all three chunk types have to be crushed, not just the metallic ones; then space-platform-thruster, then pick one planet and commit to it
classic miss: a platform that flies before it can feed its own turrets
```

Register (ships as a note, not as a data line): *Back in orbit. Insufferably at home.*

Dump-cited: `space-platform` (trigger `create-space-platform`) unlocks `asteroid-collector`,
`crusher`, `metallic-asteroid-crushing`, `carbonic-asteroid-crushing`, `oxide-asteroid-crushing`,
`cargo-bay`; `space-science-pack` (trigger `build-entity asteroid-collector`) =
`1 ice + 2 iron-plate + 1 carbon`; `space-platform-thruster` unlocks `thruster`, `thruster-fuel`,
`thruster-oxidizer`, `ice-melting`. "Pick one planet" is an opinion and the point of the row.

### SP — On a space platform

Trigger: the character's surface is a platform surface (name `platform-<n>`; see §3 step 1). C1.

```
[stage: platform]
next: ammo and repair before speed, because the leading edge takes the damage; one crusher per chunk type — metallic, carbonic, oxide — so nothing dead-ends; check thruster-fuel and thruster-oxidizer against the whole trip, not the current burn, and put asteroid-reprocessing on the surplus rather than voiding it
classic miss: widening the front of the platform, which catches more asteroids than the guns can shoot
```

Register (ships as a note, not as a data line): *At home. Corrects your orbital phrasing.*

Dump-cited: the three crushing recipes and `asteroid-reprocessing` (unlocks the three reprocessing
recipes); `thruster-fuel`, `thruster-oxidizer`; `metallic-`/`carbonic-`/`oxide-asteroid-chunk` items.
The "wide front" failure is community wisdom.

### V — Vulcanus

Trigger: character's surface resolves to `vulcanus`. C1.

```
[stage: vulcanus]
next: calcite-processing, then tungsten-carbide by mining a big-volcanic-rock, which opens foundry; once the foundry is up, molten-iron-from-lava (1 calcite + 500 lava gives 250 molten-iron and 10 stone) replaces ore smelting outright — cast plates, gears, pipe and low-density-structure; then big-mining-drill and tungsten-steel for metallurgic-science-pack (3 tungsten-carbide, 2 tungsten-plate, 200 molten-copper)
classic miss: shipping iron-ore here. Lava and calcite are the ore on Vulcanus, and calcite is the one thing that runs out
```

Register (ships as a note, not as a data line): *Approves of Vulcanus. Everything here is a furnace.*

Dump-cited: `calcite-processing` (trigger `mine-entity calcite`, prerequisite
`planet-discovery-vulcanus`), `tungsten-carbide` (trigger `mine-entity big-volcanic-rock`),
`foundry` (prerequisites `calcite-processing`, `tungsten-carbide`; unlocks `molten-iron-from-lava`,
`casting-iron`, `casting-steel`, `casting-copper`, `casting-iron-gear-wheel`, `casting-pipe`,
`casting-low-density-structure`, …), `big-mining-drill` (trigger `craft-item foundry`),
`tungsten-steel` (trigger `craft-item big-mining-drill`), `metallurgic-science-pack` recipe.

### F — Fulgora

Trigger: character's surface resolves to `fulgora`. C1.

```
[stage: fulgora]
next: recycling, by mining a fulgoran-ruin-vault, then holmium-processing; scrap-recycling turns 1 scrap into twelve different things, so every one of them needs an exit before you scale — a recycler loop for the ones you don't want; lightning-rod power before anything that has to run unattended; then electromagnetic-plant (it wants 50 holmium-plate crafted) for electromagnetic-science-pack
classic miss: one byproduct with nowhere to go stalls the whole scrap line. Sort first and recycle the remainder — concrete, ice and stone are usually the ones that fill up
```

Register (ships as a note, not as a data line): *Ruins and lightning. It finds the place tasteless, and says so once.*

Dump-cited: `recycling` (trigger `mine-entity fulgoran-ruin-vault`, prerequisite
`planet-discovery-fulgora`; unlocks `recycler`, `scrap-recycling`), `holmium-processing` (trigger
`craft-item holmium-ore`; unlocks `holmium-solution`, `holmium-plate`), `electromagnetic-plant`
(trigger `craft-item holmium-plate ×50`), `planet-discovery-fulgora` unlocks `lightning-rod`.
The 12 products of `scrap-recycling` are listed in the dump: `iron-gear-wheel`, `solid-fuel`,
`concrete`, `ice`, `steel-plate`, `battery`, `stone`, `advanced-circuit`, `copper-cable`,
`processing-unit`, `low-density-structure`, `holmium-ore`. Which three clog first is community
wisdom, not measured — and the *live* answer is already better than the table: this is exactly what
the digest's stuck-machine lines and PLAN §1 use case #4 are for.

### G — Gleba

Trigger: character's surface resolves to `gleba`. C1.

```
[stage: gleba]
next: agriculture by mining an iron-stromatolite, then jellynut and yumako, then biochamber once you've crafted 10 nutrients; size every buffer in seconds, not stacks — nutrients spoil in 5 minutes, yumako-mash in 3, jelly in 4; send the surplus to burnt-spoilage and a heating-tower instead of a chest, and remember agricultural-science-pack (1 bioflux + 1 pentapod-egg) spoils in an hour, so ship it or use it
classic miss: buffering. A full chest of fruit on Gleba is a full chest of spoilage later, and a biochamber whose inserter stops starves of nutrients within minutes
```

Register (ships as a note, not as a data line): *Everything here rots. It finds this professionally offensive.*

Dump-cited, and this is the strongest-grounded row: `spoil_ticks` is a dumped field, so the times are
the save's own — `nutrients` 300 s → `spoilage`, `yumako-mash` 180 s, `jelly` 240 s, `bioflux` 7200 s,
`agricultural-science-pack` 3600 s → `spoilage`, `pentapod-egg` 900 s (no spoil result). Plus
`agriculture` (trigger `mine-entity iron-stromatolite`), `jellynut` (`mine-entity jellystem`),
`yumako` (`mine-entity yumako-tree`), `biochamber` (trigger `craft-item nutrients ×10`),
`bioflux` recipe (`15 yumako-mash + 12 jelly -> 4 bioflux`), `nutrients-from-bioflux`,
`nutrients-from-spoilage`, `burnt-spoilage`, `heating-tower` (trigger
`mine-entity copper-stromatolite`), `agricultural-science-pack` recipe.

### A — Aquilo

Trigger: character's surface resolves to `aquilo`. C1.

```
[stage: aquilo]
next: heat before anything else — heating-tower, heat-pipe, heat-exchanger, and fuel for them, because nothing here burns until you make it; then lithium-processing by mining a lithium-iceberg-big, and cryogenic-plant once you've crafted a lithium-plate; ammoniacal-solution-separation gives ice and ammonia and solid-fuel-from-ammonia keeps the towers lit; cryogenic-science-pack is 3 ice + 1 lithium-plate + 6 fluoroketone-cold
classic miss: arriving without fuel aboard. Everything on Aquilo needs heat first, and that includes the machines that would have made the fuel
```

Register (ships as a note, not as a data line): *Cold, dark and quiet. It likes it here, which is worrying.*

Dump-cited: `planet-discovery-aquilo` unlocks `ammoniacal-solution-separation`,
`solid-fuel-from-ammonia`, `ammonia-rocket-fuel`, `ice-platform`; `lithium-processing` (trigger
`mine-entity lithium-iceberg-big`), `cryogenic-plant` (trigger `craft-item lithium-plate`),
`cryogenic-science-pack` recipe (`3 ice + 1 lithium-plate + 6 fluoroketone-cold`),
`ammoniacal-solution-separation` (`50 ammoniacal-solution -> 5 ice + 50 ammonia`),
`heating-tower` unlocks `heat-pipe`, `heat-exchanger`, `steam-turbine`. **Not claimed:** the
freezing mechanic's numbers (which entities freeze, at what rate) — not in the dump (§8).

### N8b — Interplanetary logistics

Trigger: two or more of `vulcanus`, `fulgora`, `gleba`, `aquilo` producing in the digest, and the
character not on one of them. C1.

```
[stage: between planets]
next: one platform per route with its own schedule, not one platform doing everything; request at the destination, because the platform's own requests decide what it waits for; keep a trip's worth of thruster-fuel, thruster-oxidizer and ammo aboard before you need it, and put the labs where the packs are made rather than shipping every pack home
classic miss: a platform waiting forever for a request the origin planet never fills
```

Register (ships as a note, not as a data line): *Fleet logistics. The job it was demoted from. Very slightly smug.*

Dump-cited: `thruster-fuel`, `thruster-oxidizer`, `biolab` (prerequisites `biter-egg-handling`,
`production-science-pack`, `uranium-processing`, `utility-science-pack`). Everything else here is
community wisdom plus reasoning.

### Overlay — scale

Trigger: `digest.machines.progress.machines >= 5000`. C1. Appended to whichever row won; at most one.

```
scale note: at this size throughput comes from modules, beacons and more lanes, not more machines on a lane that's already full; ask for the measured rate before changing anything
```

Grounded in the project's own measurements rather than folklore: FC-161's belt lane cap
(`belt_speed × 240` items/s — "a bulk inserter with a big hand on a yellow belt moves ~6.4/s, not
30/s") and FC-162's `machine_output`, which reads the machines' own craft counts. The 5,000 threshold
is a guess: the dev save has 2,746 registered machines and the megabase profile used 25,000.

---

## 5. A save that matches nothing

The fallback is **structural, not a guess**: matching is by exact technology name against the
server's cached dump, and a name that isn't in the dump can never be `researched`, so an unrecognised
tech tree simply fails every test and falls through. No heuristics, no fuzzy matching, no "this looks
like blue science".

When step 5 is reached — a total conversion, a scenario, or a modded tree that renames the vanilla
gates — this ships instead:

```
[stage: unknown]
next: ask what they're working towards. This save's technology names don't match anything I know, so answer only from what the save shows: what's researchable right now, what's stuck, and what they're carrying
classic miss: none claimed for this save
```

Register (ships as a note, not as a data line): *Unfamiliar territory. It says so plainly and asks.*

Two smaller degradations that are *not* the fallback, and must not be:

- **A modded planet with no row.** The dev save has `planet-discovery-maraxsis` and
  `moon-discovery-cerys`, and modded science packs that genuinely extend the arc —
  `hydraulic-science-pack` and `cerysian-science-pack` are both in the dump. In this save
  `promethium-science-pack` has `maraxsis-deepsea-research` as a prerequisite and
  `hydraulic-science-pack` as a research ingredient, so maraxsis is wired into the vanilla endgame,
  not bolted beside it. Standing on a maraxsis or cerys surface matches no planet row → step 3 or 4
  decides, and if that gives a Nauvis-flavoured row while the player is underwater, the answer will
  read wrong. **Better:** treat "surface is a planet-like surface with no row" as the fallback too,
  so it asks instead of guessing. Cheap to do (the surface name is already in hand) and it's how
  FC-171 gets avoided rather than relocated.
- **A vanilla save with no mods.** Everything above works: every gate technology in §3 is vanilla.

**The test that keeps this honest:** a unit test that walks every name inside every fenced block above
and asserts it appears in the loaded dump (`recipes`, `items`, `fluids`, `technologies`, `machines`,
`entities`, or inside a technology's `trigger`). On a save where a name is missing, the row is
withheld rather than shipped with a bad name — same shape as FC-171's proposed correction check, but
run at load time instead of after an answer.

---

## 6. Name verification

Every prototype name in §4 was checked against `data/captures/prototypes.json` (a real dump from the
dev save: 981 recipes, 402 items, 43 fluids, 342 technologies, 70 machines, 167 entities). All present
— checked mechanically over all 16 shipped blocks, not by eye; see the last paragraph of §7 for the
run and its only four false positives.
Notable specifics, since they're the ones memory gets wrong:

**Present, and cited above:** technologies `automation-science-pack`, `logistic-science-pack`,
`chemical-science-pack`, `production-science-pack`, `utility-science-pack`, `space-science-pack`,
`military-science-pack`, `metallurgic-science-pack`, `electromagnetic-science-pack`,
`agricultural-science-pack`, `cryogenic-science-pack`, `promethium-science-pack`, `steam-power`,
`electronics`, `automation`, `automation-2`, `logistics`, `logistics-2`, `steel-processing`,
`oil-gathering`, `oil-processing`, `advanced-oil-processing`, `plastics`, `sulfur-processing`,
`lubricant`, `railway`, `automated-rail-transportation`, `robotics`, `construction-robotics`,
`logistic-robotics`, `logistic-system`, `rocket-silo`, `space-platform`, `space-platform-thruster`,
`planet-discovery-vulcanus` / `-fulgora` / `-gleba` / `-aquilo` / `-maraxsis`, `moon-discovery-cerys`,
`calcite-processing`, `tungsten-carbide`, `tungsten-steel`, `foundry`, `big-mining-drill`, `recycling`,
`holmium-processing`, `electromagnetic-plant`, `agriculture`, `jellynut`, `yumako`, `biochamber`,
`bioflux`, `bioflux-processing`, `heating-tower`, `lithium-processing`, `cryogenic-plant`,
`asteroid-reprocessing`, `advanced-asteroid-processing`, `biolab`, `elevated-rail`, `quality-module`,
`modules`, `productivity-module`, `hydraulic-science-pack`, `cerysian-science-pack`.

**Vanilla-shaped names that are NOT in this dump** (each would be an FC-171 bug if written):

| Wrong name | Why | What the dump has |
|---|---|---|
| `automated-rail-transport` | missing the `-ation` | `automated-rail-transportation` |
| `turrets` | 1.1 name | `gun-turret`, `laser-turret`, `rocket-turret` (as technologies) |
| `rail-signals` | no such technology | signals come from `automated-rail-transportation` |
| `worker-robots-speed` | numbered only | `worker-robots-speed-1` … `-7` |
| `mining-productivity` | numbered only | `mining-productivity-1` … `-3` |
| `braking-force` | numbered only | `braking-force-1` … `-8` |
| `artillery-shell-range` | numbered only | `artillery-shell-range-1` |
| `quality-module-1` | no `-1` | `quality-module`, `quality-module-2`, `quality-module-3` |
| `fusion-power` | not a technology name | `fusion-reactor`, `fusion-reactor-equipment` |
| `logistic-chest-passive-provider`, `logistic-chest-requester` | 1.1 names | `passive-provider-chest`, `requester-chest`, `storage-chest`, `buffer-chest`, `active-provider-chest` |
| `science-pack` | not a thing | the 12 `*-science-pack` names above |
| `defensive-structures` | the FC-171 bug itself | `stone-wall`, `gun-turret`, `laser-turret` |

**Names present in one table but not another** — a naive single-table check rejects real names:

- `rocket-part` is in `recipes` only, not `items`.
- `yumako-mash` and `jelly` are in `items` only; their recipes are `yumako-processing` and
  `jellynut-processing`.
- `nutrients`, `scrap`, `holmium-ore`, `spoilage`, `ice`, `calcite`, `tungsten-ore`, `coal`, `stone`,
  `wood`, and the asteroid chunks are in `items` only.
- `petroleum-gas`, `heavy-oil`, `light-oil`, `lava`, `ammonia`, `ammoniacal-solution`, `fluorine`,
  `fluoroketone-hot`, `fluoroketone-cold`, `electrolyte`, `methane` are in `fluids` only. `fluoroketone`
  is a *recipe* name; the fluids are the hot and cold forms.
- `roboport`, `storage-tank`, `pipe`, `offshore-pump`, `accumulator`, `solar-panel`, `locomotive`,
  `train-stop`, `heat-pipe` are in `entities`, not `machines` — `machines` only covers
  `prototypes.lua`'s `MACHINE_TYPES` list (assembling-machine, furnace, rocket-silo, mining-drill,
  lab, beacon, belts, inserters, boiler, generator, reactor, agricultural-tower, character).
- `big-volcanic-rock`, `fulgoran-ruin-vault`, `iron-stromatolite`, `copper-stromatolite`, `jellystem`,
  `yumako-tree`, `lithium-iceberg-big` appear **only inside technology `trigger` records** (they aren't
  buildable, so they're not in `entities`). Cited from those records; the name check must look there
  too.

**Caveat on the method.** `dump_prototypes` skips `hidden` prototypes, so "absent from the dump" means
"absent from the grounded data", not "absent from the game". That is exactly the test FC-171 wants
(the model may only name what the data contains), but it is not the same statement, and a hidden
prototype's name would be wrongly rejected. Also: this dump is one save. A different mod set produces
different names, which is what §5 is for.

---

## 7. Token budget

Method: characters of the fenced blocks ÷ **3.2 chars/token**, the ratio PLAN §6 (S08) measured for
*reference lines* in the tail. The system prompt's own text measures ~2.0 chars/token; if the stage
blocks tokenize like that instead, every figure below is 1.6× larger. Both columns are given. These
are counted, not guessed — but they are still an estimate of tokenization, and `alignToCacheBlock`
exists precisely because such estimates drifted before, so measure through oMLX before shipping.

| Piece | Chars | Est. tokens @3.2 | @2.0 |
|---|---|---|---|
| One stage row, median of 14 | 614 | **192** | 307 |
| Largest row (blue science and rail) | 682 | 213 | 341 |
| Smallest row (before power) | 364 | 114 | 182 |
| Overlay line | 179 | 56 | 90 |
| Fallback row | 324 | 101 | 162 |
| **All 14 rows + overlay + fallback** | 8,463 | **2,645** | 4,232 |

Split by line kind across the 14 rows (7,918 chars total): `next:` **62%** (1,532 tok), `classic miss:`
**24%** (592 tok), `tone:` **11%** (271 tok), `[stage: …]` header 3% (80 tok).

So: **~2,650 tokens for the whole table, ~190 for the one row that ships** → **~0.19 s** on a
"what should I do" turn, nothing on any other turn. Against the ~200 tokens of free system-prompt
headroom, the whole table is ~13× too big and the median single row is ~95% of the headroom on its
own. That is the arithmetic behind §1.

**What to cut first, in order** (savings measured against the 14 rows' 7,918 chars):

1. **The `classic miss:` line** → a clause on the end of `next:`. Longest prose per unit of value.
   Deleting it outright saves **24%** (592 tokens of table, ~46 tokens off the median row); folding the
   sharpest half into `next:` saves maybe 15%.
2. **Goals from three to two.** Dropping the last clause of each `next:` saves **21%** (513 tokens).
   The third goal is always the "next technology" one, and `researchOptions()` already sends the live
   researchable list, so it is the most duplicated.
3. **Recipe amounts inside the goals** (`1 coal + 20 gas`). The most valuable tokens for grounding and
   among the most expensive; retrieval already pulls recipe lines for items named in the turn, so they
   can be dropped and let retrieval carry them. Not separately measured; eyeballing the numerals and
   their item names puts it near 15%.
4. **Merge N1 with N2, and SP into N8.** Costs nothing per turn (only one row ever ships) — it is a
   maintenance saving, not a latency one. Listed last for that reason.
5. **Never cut `tone:`.** It is 11% of the table, ~62 chars a row, it is the reason the player asked
   for this, and it is the only part the model cannot reconstruct from the data.

Doing cuts 1 and 2 together brings the median row to roughly **110 tokens / ~0.11 s**.

**Note on placement:** the register line ships in the turn's `notes` array (style), not among the data
lines (facts), matching how the two are kept apart in `agent.ts` today. It still costs its ~271 tokens
of table and ~20 per turn; only its destination changes.

**Verified, not asserted:** the name check proposed in §5 was run over all 16 shipped blocks against
this dump. Every hyphenated token resolves to a name in `recipes`, `items`, `fluids`, `technologies`,
`machines`, `entities`, or a technology `trigger` record, except four ordinary English hyphenations —
`hand-carrying`, `hand-crafting`, `dead-ends`, `full-heavy-oil-tank`. So the check works and its
false-positive rate on authored prose is low, matching FC-171's own finding. Three gaps the run
exposed, which the implementation must close:

- **Hyphenated-token-only scanning misses shortened names.** The first draft of the oil row said
  "45 gas" and "20 gas" for `petroleum-gas`; the regex couldn't see it, and a reader can't either
  because the full name appears earlier in the sentence. Fixed in §4, but a check that only looks at
  hyphenated tokens would not have caught it. Scan bare words against the dump's single-word names
  too, and forbid abbreviating any name.
- **Plurals.** The overlay says "modules, beacons" for `productivity-module` / `beacon`. Fine as
  English, but the check needs plural and inflection handling or it will reject them.
- **An English-hyphenation allowlist**, for the four above.

## 8. Could not verify

Flagged rather than smoothed over. Each of these is either absent from the dump or unmeasurable
without running the game, which this spike didn't do.

1. **Planet surface names.** The capture proves only `nauvis`, `nauvis-factory-floor`, `gleba` and
   `platform-1`. That `vulcanus`, `fulgora` and `aquilo` are the surface names follows the same
   convention but is **inferred**, and the dump has no `planets` table to check it against. Rows V, F, A
   depend on it. Cheap to verify in-game in one RCON call; until then, an unmatched surface falls
   through to §5, which is the safe direction.
2. **When a planet surface first appears in the digest.** `digest.lua` only lists surfaces whose cached
   production has a nonzero entry, so a surface the player has landed on but not yet produced anything
   on is absent. Good for step 3 (it means *producing*), but it means "the player is on Vulcanus" is
   answered by `player.character_surface`, not by the surfaces list. Unverified: whether a planet's
   surface exists at all before the first landing.
3. **The 5,000-machine megabase threshold.** A guess between the dev save's 2,746 and the profile's
   25,000. Nothing measured says where "megabase thinking" starts.
4. **Boiler-to-steam-engine and other ratios.** Not in the dump (`machines` carries `energy_usage` for
   crafting machines, not boiler fluid throughput), so N2 deliberately says none. Anything the model
   adds here is vanilla memory.
5. **Rocket parts per launch.** Not in the dump. N7 says "one of each per part" (dump-cited) and stops.
6. **Aquilo's freezing mechanic.** Which entities freeze and how fast is prototype data the dump
   doesn't carry. Row A says "heat first", which is true at the level of the recipes and unlocks it
   cites, and claims no numbers.
7. **Which Fulgora byproduct clogs first.** Named as "usually concrete, ice and stone" — community
   wisdom. The live digest answers it properly and should be preferred when it's available.
8. **That the oil wall is where players actually stall.** The *mechanical* claim (longest new chain,
   first fluid, gated science) is dump-cited. The *behavioural* claim is reputation from forums and
   guides; we have no drop-off data and should not imply we do.
9. **Whether stage goals actually help.** No eval exists for "was this direction useful". The honest
   acceptance test is behavioural, not factual: on the `wantsStartAdvice` turns of a real session, does
   the answer name something from the stage block, and does it never name anything outside the lines?
   That second half is testable today; the first half needs the player.

### Sources, labelled

- **Prototype dump** (`data/captures/prototypes.json`, dump v10 from the dev save): every recipe,
  technology, unlock, trigger, `spoil_ticks` and name claim in §4 and §6. This is the only
  measured-fact source here.
- **This repo** (`PLAN.md`, `server/src/prompt.ts`, `server/src/agent.ts`, `server/src/game.ts`,
  `mods/second-shift/scripts/digest.lua`, `scripts/prototypes.lua`): every latency and cost figure in
  §1–§3 and §7. Measurements taken by earlier sprints, not re-measured here.
- **Community wisdom** (Factorio wiki, the official forums, r/factorio, and the well-known guide
  tradition — Nilaus/KoS-style build orders and the "oil wall" folklore): the *classic miss* lines,
  the bots-vs-belts opinion, the rail-signal deadlock being the most-asked question, the wide-platform
  failure, "pick one planet". Labelled as such in each row. **No forum or wiki page was fetched during
  this spike** — these are recalled from training, which makes them the weakest evidence here and the
  right thing to check with the player, who has played this save.
- **My own reasoning**: the trigger design, the ordering proof in §3, the cut order in §7, the "burner
  drills pay for themselves" claim, and the fallback design.

### Weak spots I'd want challenged before building

- The register lines are written, not evaluated. Fourteen of them is a lot of voice to commit to in one
  go, and the tonal arc (bored → invested → at home) is my reading of one sentence of the brief.
- Row **N6** does the most work for the least specificity: "after the bots" spans production science,
  utility science, modules and the whole mall, which is many hours. It probably wants splitting, which
  costs a row and two more gates (`production-science-pack`, `utility-science-pack` are both in the
  dump and both in the prerequisite chain, so the split is available).
- **Trigger technologies are activity, not stage.** Worth repeating because the dev save contains the
  trap: `heating-tower` is `researched: true` there (trigger `mine-entity copper-stromatolite`,
  prerequisite `planet-discovery-gleba`) on a save that has never been to Aquilo, and
  `planet-discovery-fulgora` is researched while `recycling` is not — the planet is unlocked and
  unvisited. Every gate in §3 is a science-cost technology with real prerequisites for this reason.
  Any later addition must obey the same rule.
