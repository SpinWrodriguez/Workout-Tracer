# Backlog

Independent tasks, each runnable in its own session. Ordered roughly by value.
Every item states what "done" means so a session can finish it without asking.

**Ground rules for any session picking these up**

- `npm run build` is the gate, not `tsc -p tsconfig.app.json` — the latter
  excludes tests and has let a broken build through twice.
- Verify in a real browser before claiming something works. `puppeteer-core`
  drives installed Chrome; serve with `npx vite preview --port <n>` and open
  `http://localhost:<n>/Workout-Tracer/` (the base path is not optional).
- Pushing deploys to GitHub Pages. That is the user's live app on their phone.
- The user's data lives in the deployed origin's IndexedDB and in Supabase
  `workout_data`. Anything touching the schema needs a migration story.

---

## 1. Decide how the app gets an API key — done

Both, with the Edge Function preferred and a pasted key as the fallback. See
`docs/EDGE-FUNCTION.md` for the reasoning and how to deploy it. Original
options kept below for the record.

### Original notes

**Blocks items 2 and 3 — do this first.**

There is no way to keep a key in a client-side PWA. The nutrition app at
`C:\Users\willc\OneDrive\Cowork\nutrition-tracer` faces the same problem;
check what it does before inventing something.

Two options:

- **Supabase Edge Function** holding the key server-side, called with the
  user's existing session. Same project as `workout_data`, so auth is already
  solved. Adds a deploy step outside the Pages workflow.
- **A key pasted into Settings**, stored in `localStorage`. Device-local, so it
  does not sync and has to be entered on each device. Much less work, and the
  key is exposed to anything that can read the origin's storage.

**Done when:** one is chosen and written up here with the reasoning, and the
plumbing exists — a single `askModel(prompt): Promise<string>` that either
works or fails cleanly offline. No feature has to use it yet.

---

## 2. AI analysis of logged training

**The user's own idea, and the highest-value one.** Needs no schema work: the
data is already in `setLog`, `session` and `sharedBodyWeight`.

Not "generate a workout" — the deterministic builder already does that well.
This is the thing it cannot do: read six weeks of logged sets and say what is
actually happening. *This lift has not moved in five weeks. Your Thursday
sessions are consistently 20 minutes short of the ones you plan. Your top set
on squat has gone up 12% while bench is flat.*

Suggested shape:

- Summarise the block into a compact structured digest (per exercise: sessions,
  top set, estimated 1RM trend, total volume, weeks since a PR). Keep it small
  enough to send.
- The model reads the digest and returns findings, each with the exercise it
  concerns and a short claim.
- **Verify every claim against the data before showing it.** Same standard as
  `blockValidation`: a number the model states that the digest does not support
  is dropped, not shown. This is the whole reason the app is trustworthy.
- Surface as a card on Dashboard or a new tab. Cache the result; do not call on
  every open.

**Done when:** findings appear from real logged data, every displayed number is
recomputed locally, and the feature degrades to silence with no key or no
network.

---

## 3. AI-assisted workout generation (spec §Phase 5)

**Prompt and output contract drafted in `docs/AI-WORKOUT-GENERATION.md`** —
read that first; it settles the parts that do not depend on item 1.

The generator is already built to accept this. `fillDay` in
`src/lib/blockBuilder.ts` is the seam: it is handed the pattern targets,
intensity, exclusions and time budget for **one** day, and never sees or picks
a date — so a model cannot put a deadlift on a Friday.

Everything it returns goes through `validateBlock`, which recomputes rather
than trusting claims. Keep it that way: `formatViolationsForModel` already
exists to feed violations back for a retry, and `MAX_VALIDATION_ATTEMPTS`
bounds the loop.

**Done when:** a model can fill a day, its output is validated and repaired by
existing code, and turning it off falls back to the deterministic selector with
no behaviour change.

---

## 4. Finish disentangling generation from scheduling — done

The starter week is gone. It wrote `BlockSchedule.weekday`, the recurring
address, so generating four days filled every week of the block; that was the
user-reported bug that finished it off. Generation now writes only a `DatePlan`
entry, and the two ways in are the AI week planner (`WeekPlanSheet`) and one
workout at a time.

**What is left over:** `templateWeek`, `templateWeekdays`, `maxSessionsFor`,
`generateBlock` and `configFromSchedule` are now referenced only by their own
tests. They are the deterministic whole-week engine the starter week used.
Deleting them touches four test files and would remove the only non-AI path to
a full week, so it was left alone rather than ripped out in the same change.
Decide whether a deterministic week builder is still wanted; if not, delete the
lot and their tests together.

---

## 5. What happens when a block ends

`Block.endDate` is displayed and nothing else. There is no rollover, no deload
week, no "start the next block", and no prompt when the current one runs out.
For a 6–8 week mesocycle that is a real gap: exercises are meant to stay fixed
*within* a block and change *between* them, which is the entire point of the
structure.

Needs: a way to end a block, carry forward or regenerate its workouts, and keep
history attached to the right block. `Session.blockId` already exists, so
history survives; the question is the flow.

**Done when:** a block can be finished and the next one started without
hand-editing the database, and last block's numbers still drive progression
suggestions in the new one.

---

## 6. Push activity back to the nutrition app

Sync is one-way for the shared tables: weigh-ins come down from
`nutrition_data`, but logged sessions never write an `activity` row back, so
the nutrition app cannot see training load. `saveSession` already maintains a
local `sharedActivity` row — it just never travels.

Read `src/lib/remoteSync.ts` and the nutrition app's own writer before
touching this. Writing to another app's blob is the risky part: a bad merge
loses the user's food log, which is worse than not having the feature.

**Done when:** completed sessions appear as activity in the nutrition app, and
a concurrent edit there cannot be clobbered.

---

## 7. History shows "Day A" for old sessions

`Session.daySlotName` is stamped at save time, so sessions logged before that
existed have none and fall back to `slotFallback` — "Day A". A one-off backfill
could name them from the block they belong to, accepting that a slot reused
across blocks may name some of them wrongly.

Consider whether a wrong name is worse than "Day A". It may be better to leave
them and only backfill where the block still exists and the slot still has the
same exercises.

**Done when:** old sessions read sensibly in History, without inventing a name
for a workout that no longer exists.

---

## 8. A real silhouette

`src/components/Silhouette.tsx` is hand-authored and is not chart quality. The
`Muscle.svgPathId` field exists precisely so a proper anatomical SVG can be
dropped in: find a CC0 front/back muscle map, map its path ids onto the
`MUSCLES` table, and keep the existing highlight logic.

**Done when:** the volume view highlights real muscle shapes, in both themes.

---

## 9. Automated UI tests — done, except sync

`src/test/dom.ts` is the jsdom harness; `*.dom.test.tsx` files opt in with a
`// @vitest-environment jsdom` docblock so the node-environment suites are
untouched. Six flows are covered: logging a set, the save button appearing and
going away, creating a workout, moving a session to another date, renaming a
workout, and applying a rule fix. Each was verified to fail when the behaviour
is broken on purpose.

**What is left:** sync. It was in the original list and is the one flow still
only checked at the unit level, because it needs a fake Supabase store driven
through the UI rather than through `workoutSync` directly — `fakeStore` in
`workoutSync.test.ts` is most of the way there.

Two things the harness records, both learned the hard way and worth knowing
before writing another DOM test:

- `readBlockPlan` takes the **latest** block by start date. A second seeded
  block dated earlier is invisible to every screen, and the screen renders its
  empty state rather than failing.
- Waiting on the wrong write passes alone and fails under a parallel run.
  Creating a workout writes the exercises and *then* the schedule entry; the
  day editor is handed the slots the block defines. Wait for the thing you are
  about to assert on, never for something adjacent to it.

---

## 10. Smaller things

- **Conflict UI for sync.** Last write wins with no notification. Two devices
  editing the same week silently lose one side.
- **Golf days are manual.** They could come from a calendar feed, or at least
  be enterable a month at a time rather than one date at a time.
- **The week strip shows one week.** No way to plan two weeks out, though the
  date-plan layer added in `program.ts` supports it — `planDate` takes any set
  of dates.
- **`freeDbId` gaps.** 16 of the 73 exercises have no upstream id, so they
  show no photo or description. Some are garage-specific with no equivalent
  in free-exercise-db; others were nulled for failing the snapshot test. Only
  add an id that matches the same implement — a guess is worse than a gap.
- **Exercise library.** 73 exercises, curated to the garage. Adding more is
  cheap; `npm run freedb:snapshot` refreshes the id list the test checks
  against.
