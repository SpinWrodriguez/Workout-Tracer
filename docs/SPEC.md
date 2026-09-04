# Workout App — Build Spec

Personal hypertrophy/strength tracker for a garage gym, scheduled around weekend golf.
Written to be handed to Claude Code phase by phase.

---

## 1. Context

**User:** returning lifter, 82kg, male, sedentary desk job, two kids under 5.
**Goal:** build muscle while losing fat slowly (~0.3 kg/week). Maintenance ≈ 2,250 kcal.
**Realistic training week:** 2 sessions, occasionally 3. Golf Saturday, sometimes Sunday too.
**Hard constraint:** grip, lat and forearm work must not land on a round or the day before it
(relaxed from 3 days — see `src/lib/golf.ts`; two days out is advised, not barred) — it
causes early wrist release (casting) and arms-first sequencing in the golf swing.

**Why not an off-the-shelf app:** existing apps assume 3–5 sessions/week, don't model a
2:1 cable ratio, don't know about the plate inventory, and have no concept of protecting a
weekend sport. Those four things are the whole reason this app exists.

---

## 2. Equipment (fixed — this is the entire universe of exercises)

**Cortex SM-26 6-in-1 multi-gym**
- Smith machine — guided bar, **18 kg**, Olympic 50mm sleeves
- Half rack with J-hooks and adjustable safety spotters
- Dual-stack functional trainer — **2 × 70 kg** stacks (13 × 5 kg plates + 5 kg selector rod)
- Landmine
- Multi-grip chin-up bar
- Dip station

**Cable ratios (critical)**
| Setup | Ratio | Effective load |
|---|---|---|
| Single pulley (unilateral) | 0.49 | stack × 0.49 |
| Both pulleys (bilateral) | 0.98 | stack × 0.98 |
| Dual pulley adaptor | 1.0 | true 1:1 |

**Attachments:** landmine handle, straight curl bar, 2 × single-arm, lat pulldown bar,
leg roller, extension chains.

**Free weights**
- Olympic barbell, **20 kg**
- Plates: one pair each of 20, 10, 5 kg + **two pairs** of 1.5 kg
- Kettlebells: 10 kg (confirm others)
- Resistance bands — load not quantifiable, log RPE + reps only

**Derived load ladders**

Free bar (20 kg): `20, 23, 26, 30, 33, 36, 40, 43, 46, 50, 53, 56, 60, 63, 66, 70, 73, 76, 80, 83, 86, 90, 93, 96`
Smith bar (18 kg): `18, 21, 24, 28, 31, 34, 38, 41, 44, 48, 51, 54, 58, 61, 64, 68, 71, 74, 78, 81, 84, 88, 91, 94`

24 rungs per bar, 3 kg steps within each cluster.

> **Remaining gap:** 26 → 30 kg is a 4 kg jump, and that pattern repeats every 10 kg
> (36→40, 46→50, ...). Workable, but a single pair of 2.5 kg plates would close them
> and give continuous 2.5–3 kg steps throughout the range. Low priority, not urgent.
> The cable stack remains the finest increment at ~2.45 kg effective unilaterally.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React + TypeScript + Vite | Claude generates this well; fast iteration |
| Storage | IndexedDB via Dexie | Local-first, works offline in the garage |
| Styling | Tailwind | Fast, no design system to maintain |
| Charts | Recharts | Simple, good enough |
| Delivery | PWA, installed to iPhone home screen | No App Store, no dev account |
| Later (Phase 5) | Capacitor | Only route to BLE on iOS — Web Bluetooth is not supported in Safari |

Keep it single-user and local. No auth, no backend, no sync in v1.
Add a JSON export/import for backup — same pattern as the nutrition app already in use.

---

## 4. UI design system — USE THIS, DO NOT INVENT ONE

> Claude defaults to light-mode cards with a blue accent and generic sans-serif headings.
> That is not what this app looks like. Follow these tokens literally.

### Colour tokens

```css
--bg:          #0A0A0A;   /* app background, near-black */
--surface:     #171717;   /* cards */
--surface-2:   #242424;   /* inputs, chips, elevated rows */
--border:      #2E2E2E;   /* hairlines only, use sparingly */

--text:        #FFFFFF;
--text-dim:    #8E8E93;   /* labels, secondary */
--text-faint:  #5A5A5E;   /* completed/disabled rows */

--volume:      #FF8A5B;   /* set counts, volume bars */
--muscle:      #2E6FE8;   /* silhouette highlight */
--strength:    #4FD1E0;   /* 1-RM / strength charts */
--bodyweight:  #A78BFA;   /* weight trend */
--cta:         #FFFFFF;   /* primary button fill, black text on it */

--rir-1:       #8E2B2B;   /* dark red  — RIR 1, hardest */
--rir-2:       #7A5B12;   /* dark amber — RIR 2 */
--rir-3:       #E8A020;   /* bright amber — RIR 3 */
```

Dark UI conveys elevation through **lightness, not shadow**. No `box-shadow`. No gradients
anywhere except the silhouette fill.

### Typography

- **Screen titles:** uppercase, weight 800, tight tracking (`-0.02em`), ~28px.
  Reference look: `DASHBOARD`, `WORKOUT`, `LEVELS`. Use Archivo or Inter at 800.
- **Card titles:** sentence case, weight 650, 16–17px.
- **Labels:** 11–12px, `--text-dim`, weight 500. Not uppercase.
- **All numerals:** `font-variant-numeric: tabular-nums`. Non-negotiable — weights and reps
  sit in columns and must not jitter.
- **Big stats:** weight 700, 22–34px, tight tracking.

### Components

| Component | Spec |
|---|---|
| Card | `--surface`, radius 16px, padding 16px, no border, no shadow |
| Primary CTA | Full-width white pill, black text, weight 600, fixed to bottom, 52px tall |
| Segmented toggle | Pill container `--surface-2`, active segment solid white with black text. Use for timeframe: `1W 1M 3M 6M 1Y All` |
| Muscle chip | `--surface-2`, radius 8px, 12px text, `--text-dim`; active state gets `--muscle` text |
| Set row | 4 columns: set no. (circle) · target · kg input · reps input · checkbox. Completed rows drop to `--text-faint` |
| RIR badge | Small filled circle, right-aligned on the set row, coloured by `--rir-*` |
| Bottom nav | 5 slots, fixed, `--bg` with top hairline. Centre slot is a white circular FAB (+) that floats above the bar |
| Number pad | Custom in-app numeric keypad for weight/reps. Do not use the iOS keyboard — it covers the set table and is slow in a garage with chalky hands |
| Rest timer | Countdown in the header, always visible during a session, with a progress bar |
| Empty state | `-- kg` / `--- sets` in `--text-dim`, never "No data available" |

### Layout rules

- One screen = one job. No nested scroll areas.
- Session logging screen must be usable **one-handed, mid-set, without zooming**. Thumb-reach
  matters more than density.
- Horizontal exercise strip at the top of the session screen (thumbnails), tap to switch —
  never a dropdown.
- Charts: no axis chrome beyond a single dashed gridline and endpoint labels.

### Screens (Phase 1–4)

1. **Dashboard** — weekly rings (sets / exercises / muscles vs target), weight trend card, recent sessions
2. **Session** — live logging: exercise strip, set table, rest timer, custom keypad
3. **Program** — current block, day slots A/B/C/X/Y, exercise list per slot
4. **Levels** — silhouette + per-muscle weekly set volume list
5. **History** — per-exercise charts, session log
6. **Settings** — plate inventory, bar weights, cable ratios, golf calendar, backup/restore

---

## 5. Data model

```ts
// Seeded once, hand-curated from the garage equipment. ~50 rows.
// freeDbId links to yuhonas/free-exercise-db for description + photos (see §9).
Exercise {
  freeDbId?: string           // e.g. 'Barbell_Squat' — hand-mapped at seed time, nullable
  id: string
  name: string
  station: 'free_bar' | 'smith' | 'cable' | 'kettlebell' | 'bodyweight' | 'band' | 'landmine'
  attachment?: string
  primaryMuscles: MuscleId[]
  secondaryMuscles: MuscleId[]
  loadMultiplier: number      // 1.0 free/smith; 0.49 single pulley; 0.98 bilateral
  barWeight?: number          // 20 free, 18 smith
  loadMode: 'weight' | 'bodyweight' | 'rpe_only'
  gripLoad: 'none' | 'low' | 'high'   // <-- drives the golf rule
  isHinge: boolean            // form-risk flag; schedule fresh, never late in a circuit
}

Muscle {
  id: MuscleId
  name: string                // 'Lats', 'Front Delts', 'Quads', ...
  region: 'upper' | 'lower' | 'core'
  svgPathId: string           // for the silhouette, Phase 4
}

Block {                       // mesocycle — exercises stay FIXED inside a block
  id: string
  startDate: string
  endDate: string             // 6–8 weeks
  focusMuscles: MuscleId[]
  notes?: string
}

BlockExercise {
  blockId: string
  exerciseId: string
  daySlot: 'A' | 'B' | 'C' | 'X' | 'Y'
  targetSets: number
  repRangeLow: number
  repRangeHigh: number
  order: number
}

Session {
  id: string
  blockId: string
  daySlot: string
  date: string
  durationMin?: number
  hrAvg?: number
  hrMax?: number
  notes?: string
}

SetLog {
  sessionId: string
  exerciseId: string          // NOT blockExerciseId — this is what makes cross-block history work
  setNo: number
  weightKg?: number           // as loaded, before multiplier
  effectiveKg?: number        // computed: weightKg × loadMultiplier
  reps: number
  rpe?: number                // 6–10
  rir?: number                // reps in reserve, alternative to RPE
}

BodyWeight { date: string, kg: number }
```

**Two modelling rules that matter more than the rest:**

1. `SetLog.exerciseId` references `Exercise`, never `BlockExercise`. Progression charts must
   span blocks — "goblet squat 20 → 24 → 28 kg over three blocks" is the whole point.
2. Store both `weightKg` (what you loaded) and `effectiveKg` (after multiplier). Log the
   first, chart and compare on the second. Otherwise cable work will look absurdly strong
   next to squats and every 1-RM estimate will be nonsense.

---

## 6. Phases

Each phase ships something usable. Don't start the next until the current one is in use.

### Phase 1 — Log a session
**Scope**
- Seed the exercise table (hand-written JSON, ~50 rows for this equipment)
- Pick exercise → enter sets: weight, reps, RPE
- Save session with date
- List past sessions, open one, edit it
- JSON export / import

**Acceptance**
- Can log yesterday's session from memory: goblet 20 kg, KB swing 10 kg, split squat 10 kg,
  pull-ups bodyweight, cable row 50 kg (→ 24.5 kg effective), RDL 30 kg
- Cable row displays both 50 kg selected and ~24.5 kg effective
- Export produces a file that re-imports cleanly

### Phase 2 — Loadable weights + progression
**Scope**
- `loadableWeights(barKg, plateInventory)` → sorted deduped array; cache per bar at setup
- Plate inventory editable in settings
- Every weight input snaps to a loadable rung; never offer 27 kg
- Ceiling is a hard stop
- Progression suggestion per exercise: last session's top set → next rung, with rule:
  - hit top of rep range at RIR ≥ 2 → next rung up
  - hit rep range at RIR 0–1 → repeat same weight
  - missed rep range twice → hold, flag for review
- Show "smallest available jump is X% — consider microplates" when the jump exceeds 10%
  (with this inventory that fires on the 26→30 style gaps at light loads)

**Acceptance**
- With one pair each of 20/10/5 plus two pairs of 1.5, free bar returns exactly the 24-rung ladder in §2
- Cable stack returns 5 kg increments with effective values at ×0.49
- Suggestion for a 20 kg goblet squat at 3×10 RIR 3 is 23 kg, not 22 or 24

### Phase 3 — The golf rule (the differentiator)
**Scope**
- Mark golf days on a calendar (played, or planned)
- Each exercise carries `gripLoad`
- Bar `gripLoad: 'high'` on a golf day or the day before; advise two days out
- Block builder auto-places high-grip work early in the week
- Session view: warn if a hinge (`isHinge`) is being done late in a fatigued session
- Weekly view showing gym days, golf days, rest days, and rule violations

**Acceptance**
- Placing pull-ups on Friday with golf Saturday produces a clear warning
- Placing them Monday produces none
- Generated week for "2 sessions + Saturday golf" puts all high-grip work Mon/Tue

### Phase 4 — Volume, silhouette, history
**Scope**
- Weekly sets per muscle, computed from SetLogs (primary = 1 set, secondary = 0.5)
- Body silhouette SVG shaded by weekly set volume — **as a readout, not a picker**
- Per-exercise history chart: effective weight, estimated 1-RM, total volume
- Body weight chart: daily points, 7-day rolling average, linear trend line with kg/week
- Flag when weekly sets for a muscle fall below 8 or exceed 20

**Acceptance**
- Silhouette matches hand-calculated set counts for a known week
- Weight chart reproduces the −0.35 kg/week trend from the existing 77-day dataset
- 1-RM estimates use effective kg, so cable and barbell lifts are comparable

### Phase 5 — Optional extras
Only after Phases 1–4 have been used for a full block.
- **AI block review.** At block end, send exercise history (weights, reps, RPE, stalls) plus
  focus muscles and the golf constraint; get back the next block's exercise selection and
  set/rep targets. Runs 2–3 times per 6–8 weeks, never per session.
- **Heart rate.** COOSPO chest strap, BLE Heart Rate Service `0x180D`, characteristic
  `0x2A37`. Requires Capacitor — Web Bluetooth does not work in iOS Safari. Note that
  HR-derived calories overestimate badly for resistance work; treat as a rough figure.
- **Apple Health import** for body weight and steps via HealthKit (Capacitor plugin).

---

## 7. Explicitly out of scope

- Multi-user, auth, cloud sync
- Social features, sharing
- Exercise GIFs or video
- Nutrition tracking (already handled by the existing app)
- Any external API as the *source* of exercise selection — the equipment list is fixed and
  small, and AI selects from it. free-exercise-db is used only to enrich with description
  and photos, after selection (§9)
- AI generating a fresh workout each session. This actively breaks progressive overload:
  the reference implementation must lock exercises for the whole block.

---

## 8. Seed exercise list — starting point

Grouped by station. Expand as needed; `gripLoad: high` items are the golf-sensitive ones.

**Free bar (20 kg, ×1.0)**
Back squat · Front squat · Romanian deadlift `hinge, grip:high` · Conventional deadlift
`hinge, grip:high` · Bench press · Overhead press · Bent-over row `grip:high` · Barbell curl

**Smith (18 kg, ×1.0)**
Smith squat · Smith bench press · Smith incline press · Smith overhead press ·
Smith shrug `grip:high` · Smith calf raise

**Cable — single pulley (×0.49)**
Chop (high→low) · Lift (low→high) · Pallof press · Single-arm row `grip:low` ·
Tricep pushdown · Bicep curl · Lateral raise · Face pull · Cable kickback

**Cable — bilateral / dual adaptor (×0.98 / ×1.0)**
Lat pulldown `grip:high` · Seated row `grip:high` · Cable fly · Straight-arm pulldown `grip:low`

**Landmine**
Landmine press · Landmine row `grip:high` · Landmine rotation · Landmine squat-to-press

**Kettlebell**
Swing `hinge, grip:high` · Goblet squat · Single-leg RDL `hinge` · Turkish get-up ·
Suitcase carry `grip:high`

**Bodyweight**
Pull-up `grip:high` · Chin-up `grip:high` · Dip · Push-up · Plank · Side plank ·
Hanging leg raise `grip:high` · Split squat · Glute bridge

**Bands (`rpe_only`)**
Band pull-apart · Band external rotation · Band pull-through · Band lateral walk

---

## 9. AI generation, then enrichment (order matters)

**Old order (wrong):** API returns exercises → AI filters them.
**New order:** AI generates the block from *your* list → free-exercise-db supplies description
and photos for whatever it picked.

### Step 1 — AI generates the block

Runs at block boundaries only (every 6–8 weeks), never per session.

**Input to the model:**
- The full curated `Exercise` table (ids, names, station, muscles, gripLoad, isHinge)
- Focus muscles for the block
- Goal: hypertrophy + strength, in a small deficit
- Constraints: 2 sessions/week realistic (3 optimistic), 40 min per session,
  garage equipment only, **no high-gripLoad work on a golf day or the day before**
- Prior history: per exercise — weight progression, reps, RPE/RIR, and any stalls
- Loadable weight ladder per bar (so it never prescribes an unloadable weight)

**Output contract — strict JSON, ids only:**

```json
{
  "rationale": "short human-readable summary of the choices",
  "days": [
    { "slot": "A",
      "exercises": [
        { "exerciseId": "kb_swing", "sets": 4, "repLow": 12, "repHigh": 15, "startWeightKg": 16 }
      ]
    }
  ]
}
```

**Guardrail, and this is the important one:** the model must return `exerciseId` values that
already exist in your table. It must never invent exercise names. Validate the response
against the table and reject/retry on any unknown id. This is what stops it prescribing a leg
press you don't own, and it's what keeps the `freeDbId` mapping intact.

### Step 2 — Enrich from free-exercise-db

Public domain (Unlicense), 800+ exercises, JSON plus photos, no key, no rate limit.

- **Combined dataset:** `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
- **Images:** prefix the `images` path with
  `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/`
  — e.g. `.../exercises/Air_Bike/0.jpg`

Record shape:

```json
{
  "id": "Alternate_Incline_Dumbbell_Curl",
  "name": "Alternate Incline Dumbbell Curl",
  "force": "pull",
  "level": "beginner",
  "mechanic": "isolation",
  "equipment": "dumbbell",
  "primaryMuscles": ["biceps"],
  "secondaryMuscles": ["forearms"],
  "instructions": ["...", "..."],
  "category": "strength",
  "images": ["Alternate_Incline_Dumbbell_Curl/0.jpg", ".../1.jpg"]
}
```

**Implementation notes:**
- Fetch `exercises.json` **once** at setup, store in Dexie. It is not a runtime dependency —
  the garage has patchy wifi and this must work offline.
- Cache images as blobs in IndexedDB on first view, not on import. Importing all 2,600 images
  is unnecessary; you only need ~50.
- Map `freeDbId` **by hand at seed time**, not by fuzzy name match at runtime. Fuzzy matching
  breaks silently and you'll never notice which exercise lost its photo.
- `force`, `mechanic` and `equipment` are incomplete on some records — allow null, and never
  branch logic on them.
- Nullable `freeDbId` is fine and expected. Nothing in the DB matches "Smith machine squat with
  an 18 kg bar". Fall back to your own one-line cue text and no photo.
- **Do not** trust their `equipment` field to filter for your garage. Your own `station` field
  is the authority.

---

## 10. Shared storage with the nutrition app

Both apps should eventually talk to each other. Design for that now — retrofitting a shared
schema later is painful.

### Single Dexie database, namespaced tables

```
db name: 'fitness'

shared:   bodyWeight      { date, kg }
          activity        { date, name, kcal, source: 'workout' | 'manual' | 'golf' }
          goals           { date, kcal, protein, carbs, fat, focus, maintenance }

nutrition: selections     { date, meals }
           checked        { date, meals }
           savedMeals     { ... }

workout:   exercise       { ... }        // curated list, §5
           freeDbCache    { id, json, imageBlobs }
           block          { ... }
           blockExercise  { ... }
           session        { ... }
           setLog         { ... }
```

**`bodyWeight` is the key shared table.** The nutrition app already owns 77 days of it. The
workout app reads it for load-relative strength and writes new entries. One source of truth,
either app can log the morning weigh-in.

**`activity` is the second one.** The nutrition app already has an `exercise` list of burn
entries — that's the same concept. When the workout app completes a session it writes an
`activity` row, so the nutrition app can see it without a manual entry.

> Caveat worth encoding in the UI: HR-derived calorie figures overestimate badly for
> resistance work. Write the session's *duration* and a conservative estimate, and label it
> as an estimate rather than a measurement.

### Backup envelope

One JSON file covering both apps, so a single export is a full backup:

```json
{
  "_version": 3,
  "_exportedAt": "2026-09-01T20:00:00+10:00",
  "shared":    { "bodyWeight": [], "activity": [], "goals": {} },
  "nutrition": { "selections": {}, "checked": {}, "savedMeals": [] },
  "workout":   { "exercise": [], "block": [], "blockExercise": [],
                 "session": [], "setLog": [] }
}
```

### Migration from the existing nutrition backup

The current nutrition export is `_version: 2` with top-level keys
`selections, checked, weights, savedMeals, exercise, goals`. Write a one-way migration:

| v2 key | v3 destination |
|---|---|
| `weights` | `shared.bodyWeight` |
| `exercise` | `shared.activity` (source: `'manual'`) |
| `goals` | `shared.goals` |
| `selections`, `checked`, `savedMeals` | `nutrition.*` unchanged |

Import must be **idempotent and additive** — re-importing the same file must not duplicate
rows. Key `bodyWeight` on `date`, upsert. Do not delete anything on import.

Build the import before the export. Loading the real 77-day dataset on day one means every
chart you build has real data in it from the start, which is worth more than a seed script.

---

## 11. First prompt to Claude Code

> Scaffold Phase 1 of this spec: React + TypeScript + Vite + Tailwind + Dexie, PWA-enabled.
>
> Apply the design system in §4 exactly — dark near-black theme, the listed colour tokens,
> uppercase 800-weight screen titles, tabular numerals, white pill CTA, bottom nav with a
> centre FAB, and the custom numeric keypad. Do not substitute your own visual design.
>
> Create the shared Dexie schema in §10 (db name `fitness`, namespaced tables) and the
> Exercise/Muscle/Block/BlockExercise/Session/SetLog types exactly as written in §5.
> Seed the exercise table from §8 with correct station, loadMultiplier, barWeight, gripLoad
> and isHinge values, plus nullable freeDbId.
>
> Build: the v2→v3 nutrition backup importer (§10), the session logging screen, and the
> session history list. Nothing from Phases 2–5 yet, and no AI or free-exercise-db calls yet.
