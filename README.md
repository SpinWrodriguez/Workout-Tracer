# Workout Tracer

Personal hypertrophy/strength tracker for a garage gym, scheduled around weekend golf.
Local-first PWA — installs to the iPhone home screen, works offline, no backend and no auth.

**Phases 1–4 of `docs/SPEC.md` are built, plus the free-exercise-db enrichment from §9 step 2.**
Phase 5 (AI block review, heart rate, Apple Health) is not started — see *What's left* below.

## Running it

```bash
npm install
npm run dev              # http://localhost:5173/Workout-Tracer/
npm run build            # typecheck + production build (emits the service worker)
npm test                 # vitest — includes every phase's acceptance criteria
npm run lint
npm run icons            # regenerate the PWA icon set in public/
npm run freedb:snapshot  # refresh the upstream exercise-id list the seed test checks against
```

## What's built

### Phase 1 — log a session
49 hand-curated exercises covering the whole Cortex SM-26 plus free weights, each with its
`station`, `loadMultiplier`, `barWeight`, `gripLoad` and `isHinge`. Live logging with a
horizontal exercise strip, set table, rest timer and a custom in-app numeric keypad — the iOS
keyboard is never used for weight or reps, because it covers the set table and is slow with
chalky hands. Session history by month, tap to reopen and edit. Reads the nutrition app's
`_version: 2` backup and writes the combined v3 envelope.

### Phase 2 — loadable weights and progression
`loadableWeights(barKg, plates)` reproduces both published ladders from §2 exactly: 24 rungs
each, `20 23 26 30 …` on the free bar and `18 21 24 28 …` on the Smith. The keypad's ± keys
step rung to rung, both ends are hard stops, and a typed value snaps to the nearest rung —
27 kg can be typed, warns, and saves as 26. Progression follows the spec's three rules and
always lands on a real rung; where the next step exceeds 10% of the current load it says so
and suggests microplates. The inventory is editable in Settings with the generated ladders
rendered directly beneath the inputs.

### Phase 3 — the golf rule
The differentiator. High-grip work is kept out of the round itself and the three days before
it. Rounds are marked straight from the weekly view on Program — tap a day to cycle rest,
planned, played — which also shows gym days, rest days, which days can carry grip work, and
any violations by name and distance to the round. While logging, a high-grip exercise inside
the window gets a red banner and a late-scheduled hinge gets a quieter note. The block builder
excludes golf days, spreads sessions evenly, anchors on the earliest grip-safe day, filters
high-grip work off any day inside the window, leads every session with the hinge, and keeps
each session inside 40 minutes.

### Phase 4 — volume, silhouette, history
Weekly sets per muscle at 1 per primary and 0.5 per secondary, on a new Levels screen with a
front-and-back body map shaded by volume. Muscles under 8 or over 20 sets are flagged, but only
ones actually trained. Per-exercise charts for top set, estimated 1-RM and total volume, all
computed from `effectiveKg` so cable and barbell work share an axis. Body weight gets daily
points, a 7-day trailing average and a least-squares trend in kg/week.

### §9 step 2 — descriptions and photos
Descriptions and reference photos come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
(public domain, no key, no rate limit). It is never the source of exercise *selection* — the
equipment list is fixed and the app picks from it — and its `equipment` field is never used to
filter, because the curated `station` field is the authority.

Fetched once from Settings and stored in Dexie, filtered down to just the 46 records the seed
maps to; carrying all 876 would be a megabyte for no benefit. Images are cached as blobs on
first view, not on import. Nothing on any screen requires the cache: every exercise also has a
hand-written one-line cue about *this* rack, which takes precedence over the upstream text and
is the only description available offline before a first fetch.

## What's left

Phase 5, and it needs decisions rather than code:

- **AI block review** — the model call has no home yet. Calling Anthropic from the client means
  shipping an API key inside a PWA, which is not something to do quietly; a tiny proxy conflicts
  with "no backend" in §3. The output contract and the id-validation guardrail from §9 step 1 are
  already enforced by the deterministic builder, so whatever runs the model can be validated
  against the same rules.
- **Heart rate** — needs Capacitor and a physical iPhone plus the COOSPO strap. Web Bluetooth
  does not exist in iOS Safari, so this cannot be built or tested from a browser at all.
- **Apple Health import** — same: Capacitor plugin, real device.

## Design system

`src/index.css` holds the tokens from §4 and nothing else is invented: near-black `#0A0A0A`
ground, elevation through lightness rather than shadow (no `box-shadow`, no gradients outside
the silhouette fill), Archivo 800 uppercase screen titles, tabular numerals everywhere, a white
pill CTA, and a five-slot bottom nav whose centre slot is a floating FAB.

### Light theme

Dark is the spec's theme and the default. Light overrides the same variables under
`[data-theme='light']`, so every Tailwind utility and every `var()` reference follows without a
single component change. Switch it in Settings → Appearance (System / Light / Dark) or with the
sun/moon button in the Dashboard header.

The elevation rule still holds in light, just inverted — elevation goes *up* toward white, so
the page is grey `#F2F2F5` and cards are white. `--cta` inverts to near-black, and because every
button already pairs `bg-cta` with `text-bg`, the black-pill-on-white look falls out for free.

The accents get **darker** rather than lighter: the same hue that reads well on near-black is
unreadable at 12px on white. A test asserts each one clears 4.5:1 on a light card and that the
light palette overrides every token the dark one declares, since a missed token silently leaks
dark into light.

Three things needed more than a token swap, and are commented where they live:

- **The RIR swatches and warning text split apart.** Darkening the bright amber far enough for
  12px text collapsed the red / amber / amber scale into three near-identical browns, so
  `--color-warn` now carries the text role and `--color-rir-*` stays a swatch scale. Swatches are
  held to the 3:1 graphics minimum and to being 1.5× apart in luminance.
- **The golf-rule banner has its own fill/text pair.** Its fill is a saturated red, so its text
  can never be `--text` — that would be black on dark red in light. In light it becomes a tinted
  fill with dark red text, which is what a light-mode alert should look like.
- **The silhouette shades in CSS, not JS.** `color-mix` against the live tokens follows the
  theme; the old hardcoded RGB lerp could not. Trained muscles also start at a 30% tint rather
  than fading in from zero, because on a light card the idle grey is already close to a pale blue
  and 3 of 20 sets was invisible.

`§4`'s own `--rir-1` (`#8E2B2B` on `#171717`) is only 2.2:1 in dark, under the graphics minimum.
That is the spec's value so it stands, and it is not a problem in practice: every RIR badge
prints its number beside the dot, so the meaning is never carried by colour alone. A test pins
both facts down so neither drifts.

Two deliberate departures from §4, both noted in the code:

- **The golf calendar lives on Program, not Settings.** Marking a round is something you do
  while looking at the week it breaks.
- **Settings is a gear on the Dashboard, not a nav slot.** Five slots minus the FAB leaves four
  tabs for five screens; Settings is the one opened least, so Levels takes the slot.

The theme choice lives in `localStorage`, not the shared Dexie database: it is a per-device
display preference rather than data, so it has no business in a cross-app backup, and it has to
be readable synchronously before first paint. A small inline script in `index.html` applies it
before the bundle is even requested — without that the app renders dark for a frame and then
flips, which is the most visible bug a theme switcher can have.

## Architecture notes

Two things are load-bearing and easy to break:

1. **`SetLog.exerciseId` references `Exercise`, never `BlockExercise`.** Progression charts have
   to span blocks — "goblet squat 20 → 24 → 28 kg over three blocks" is the point.
2. **Both `weightKg` and `effectiveKg` are stored.** Log what you loaded, chart and compare on
   what it actually lifts. Without this the 2:1 cable stack makes a 50 kg cable row look
   stronger than a 50 kg squat and every 1-RM estimate is nonsense.

### Shared database

One Dexie database named `fitness`, shared with the existing nutrition app (§10). Store names
carry their namespace as a prefix — `shared_bodyWeight`, `nutrition_selections`,
`workout_exercise` — because both apps own a table called `exercise` and they mean different
things. `db.ts` maps the prefixed stores onto readable accessors.

`shared_bodyWeight` is the key shared table: either app can log the morning weigh-in.
`shared_activity` is the second — finishing a session writes a row there so the nutrition app
sees it without a manual entry. That row carries a duration-based estimate at 3.5 METs and is
named `(est.)`, because HR-derived calorie figures overestimate badly for resistance work.

The v3 envelope gained `workout.settings` and `workout.golfDay` after §10 was written. The
version stays at 3: the sections are additive, every section is optional on read, and a bump is
for a change that breaks a reader. `workout_freeDbCache` is deliberately **not** in the backup —
it is derived data holding image blobs, refetchable in one tap.

### Import before export

The v2 importer was built first, so real data is behind every chart. Import is **additive and
idempotent**: every table is keyed on its natural key and written with `bulkPut`, so
re-importing upserts instead of duplicating and nothing is ever deleted. The v2 reader accepts
both array-shaped and date-keyed-map data, since the nutrition export's exact shape is not
pinned down.

### The freeDbId mapping is tested, not trusted

§9 warns that fuzzy name matching fails silently and you never notice which exercise lost its
photo. So the ids are hand-mapped, and `src/db/seed/freeDbIds.ts` snapshots the full upstream id
list so a unit test can verify every one of them offline. That check caught two wrong guesses on
its first run. The snapshot is imported only by the test, so it costs nothing in the bundle;
`npm run freedb:snapshot` refreshes it.

§9 also predicts nothing upstream matches "Smith machine squat with an 18 kg bar". The data
disagrees — there is a full `Smith_Machine_*` family — so the Smith station is mapped after all.
Three exercises genuinely have no match (the cable low-to-high lift, the landmine squat-to-press,
the band lateral walk) and fall back to their cue with no photo.

### Bundle

Recharts is the spec's chart choice but roughly doubles the bundle for three near-chrome-free
charts, so it is split into a lazily loaded chunk: the app shell stays at ~120 kB gzipped and the
chart chunk loads on first view. The service worker precaches both, so charts still work offline.
