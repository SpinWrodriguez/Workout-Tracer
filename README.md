# Workout Tracer

Personal hypertrophy/strength tracker for a garage gym, scheduled around weekend golf.
Local-first PWA — installs to the iPhone home screen, works offline, no backend and no auth.

**This repo is at Phase 1: log a session.** See `docs/SPEC.md` for the full build spec and
the phase plan.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build (emits the service worker)
npm test           # vitest — includes the Phase 1 acceptance criteria
npm run lint
```

`npm run icons` regenerates the PWA icon set in `public/`.

## What Phase 1 ships

- **Seeded exercise table** — 49 rows covering the whole Cortex SM-26 plus free weights,
  hand-curated with `station`, `loadMultiplier`, `barWeight`, `gripLoad` and `isHinge`
  (`src/db/seed/exercises.ts`). This is the entire universe of exercises; nothing is fetched.
- **Session logging** — horizontal exercise strip, set table, rest timer, and a custom in-app
  numeric keypad. The iOS keyboard is never used for weight or reps.
- **Cable load translation** — a 50 kg stack selection on a single pulley logs as 50 kg loaded
  and 24.5 kg effective, and both are on screen.
- **History** — sessions by month; tap one to reopen and edit it.
- **Shared backup** — reads the nutrition app's `_version: 2` export, migrates it to the v3
  envelope, and writes a combined export covering both apps.

Not yet built, by design: loadable-weight ladders and progression suggestions (Phase 2), the
golf rule (Phase 3), muscle volume and charts (Phase 4), AI block review, HR and Health
import (Phase 5).

## Design system

`src/index.css` holds the tokens from spec §4 and nothing else is invented: near-black
`#0A0A0A` ground, elevation through lightness rather than shadow (no `box-shadow`, no
gradients), Archivo 800 uppercase screen titles, tabular numerals everywhere, a white pill
CTA, and a five-slot bottom nav whose centre slot is a floating FAB.

## Architecture notes

Two things are load-bearing and easy to break:

1. **`SetLog.exerciseId` references `Exercise`, never `BlockExercise`.** Progression charts
   have to span blocks — "goblet squat 20 → 24 → 28 kg over three blocks" is the point.
2. **Both `weightKg` and `effectiveKg` are stored.** Log what you loaded, chart and compare
   on what it actually lifts. Without this the 2:1 cable stack makes a 50 kg cable row look
   stronger than a 50 kg squat and every 1-RM estimate is nonsense.

### Shared database

One Dexie database named `fitness`, shared with the existing nutrition app (spec §10). Store
names carry their namespace as a prefix — `shared_bodyWeight`, `nutrition_selections`,
`workout_exercise` — because both apps own a table called `exercise` and they mean different
things. `db.ts` maps the prefixed stores onto readable accessors.

`shared_bodyWeight` is the key shared table: either app can log the morning weigh-in.
`shared_activity` is the second — finishing a session writes a row there so the nutrition app
sees it without a manual entry. That row carries a duration-based estimate at 3.5 METs and is
named `(est.)`, because HR-derived calorie figures overestimate badly for resistance work.

### Import before export

The v2 importer was built first, so every chart added later has the real 77-day dataset behind
it from day one. Import is **additive and idempotent**: every table is keyed on its natural key
and written with `bulkPut`, so re-importing the same file upserts instead of duplicating, and
nothing is ever deleted. The v2 reader accepts both array-shaped and date-keyed-map data, since
the nutrition export's exact shape is not pinned down.

### free-exercise-db

`freeDbId` is mapped by hand at seed time and is nullable on purpose — fuzzy name matching
fails silently and you never notice which exercise lost its photo. The whole Smith station, the
landmine movements and the bands are null; nothing upstream matches "Smith machine squat with
an 18 kg bar". Where an upstream record id could not be confirmed it was left undefined rather
than guessed. No fetch happens yet: that is §9, a later phase.
