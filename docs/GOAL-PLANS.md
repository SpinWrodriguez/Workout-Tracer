# Goal plans — design

Status: **proposal, not built.** Decisions marked ❓ are open and need an answer
before Phase 1 starts.

## 1. Why

The app has one block (31 Aug – 26 Oct) holding 12 workouts, each generated on
its own with no thread between them. The log shows the cost: of 55 exercises
ever used, 8 have been done four or more times. Nothing can progress if it
comes round once a month.

A goal plan works the other way round: **one goal, a fixed length, two or three
fixed workouts repeated every week, and a target that changes week by week**.
The exercises are chosen once, at the start; what moves is the dose.

It also closes BACKLOG §5 ("what happens when a block ends"): a plan *is* a
block with a goal, and finishing one is how the next starts.

## 2. The first plan: 4 weeks, general fitness + conditioning

The lifter feels strong and wants a month of all-round work with conditioning
before the next strength or muscle phase. This is the preset to build first.

| Week | Phase | Strength part | Conditioning part |
|---|---|---|---|
| 1 | Base | 3 × 10–12, RIR 3 | 8 min, easy pace |
| 2 | Build | 3 × 10–12, RIR 2 (+1 set on two mains) | 12 min |
| 3 | Push | 3 × 8–10, RIR 1–2, shorter rest (60–75 s) | 15 min, harder format |
| 4 | Test + taper | 2 × 8–10, RIR 3 | benchmark re-test, then 8 min easy |

- **Three full-body workouts (A, B, C)**, the same three for all four weeks.
  Each: a power/rotation opener, two compounds (one lower, one upper), two
  accessories, then the conditioning finisher. About 50 minutes.
- **Golf stays protected.** With golf on Saturday: A Monday, B Wednesday,
  C Friday. C is built golf-safe from the start: no high-grip, no heavy spinal
  load, no heavy legs. The existing grip/spine rule still checks every
  placement; the plan just never asks it to say no.
- **Walking 18 holes counts** as a conditioning session in the weekly total
  (❓ confirm): it is ~4 hours on foot and already logged as an activity.
- Progression inside the plan is the existing rule (top of range at RIR ≥ 2 →
  next rung). The plan only changes the *target* each week: range, sets, RIR,
  rest.

## 3. Conditioning — the new piece

The app only knows sets of reps or seconds. Conditioning needs a timed block.

**Formats** (one per finisher):

| Format | Prescription | Logged |
|---|---|---|
| Intervals | work s / rest s × rounds | rounds completed, RPE |
| EMOM | N reps every minute × minutes | minutes completed, RPE |
| AMRAP | circuit for N minutes | rounds + extra reps, RPE |
| Steady | N minutes continuous (walk, bike, row, shadow swings) | minutes, RPE |

- **Exercise choice:** from the library, excluding retired, advanced-skill,
  high-spinal-load and mobility rows. Hinges allowed only at low spinal load
  (swings yes, deadlifts no). Golf-week rules apply as they do now.
- **Timer:** the rest timer grows an interval mode — work/rest countdown with
  the haptic tick on each change and the round number on screen. Same
  wall-clock deadline approach, so a locked phone does not drift.
- **Volume:** conditioning rounds are **not** counted as muscle sets (they
  would flood the body map). History gets its own weekly figure:
  *conditioning minutes*, next to weekly sets.
- **Heart rate** (optional): `Session.hrAvg/hrMax` already exist; the finisher
  screen offers to fill them.

❓ **Equipment:** is there a bike, rower, ski-erg or skipping rope? Without one,
conditioning is bodyweight, bands, cable, kettlebell and dumbbell circuits,
which is fine but worth knowing.

## 4. Benchmarks — knowing it worked

The same test at the start (week 1, first session) and the end (week 4):

1. **Benchmark circuit for time** — 5 rounds of 10 goblet squats, 10 push-ups,
   10 band pull-aparts, 20 s plank. Time to finish, and HR at the end if
   available. The headline number.
2. **Max push-ups**, one set.
3. **Plank hold** to failure of position.
4. **Body weight** — the 7-day average at start and end (already tracked,
   target ≤ 82 kg).

All grip-light and back-light, so they can sit in any week. The end-of-plan
card shows each before/after with the change.

## 5. How it looks in the app

- **Program → "Start a plan"** (also offered automatically when a block ends):
  1. Pick a goal (first release: *General fitness & conditioning*).
  2. Length — 4 or 8 weeks — and start date (default: the Monday after today,
     or the day the current block ends).
  3. Days per week (2–3) and which weekdays; golf days come from Settings.
  4. Preview: the week table above and the three workouts. Swap any exercise
     before confirming (the picker hides retired ones).
  5. Confirm → a new block is created, the workouts are written, and every
     week of the plan is placed on the calendar.
- **During the plan:** a banner on Program and Home — *Week 2 of 4 · Build*.
  Each workout card and the session screen show this week's target
  ("3 × 10–12 @ RIR 2, rest 90 s") instead of the block-wide range.
- **End of plan:** results card (benchmarks + weekly sets + conditioning
  minutes + lifts that rose), then "Start the next plan", which suggests a goal
  that follows on (e.g. conditioning → muscle).
- The old 12 workouts stay with the old block: history and charts keep them;
  the shelf for the new block starts clean.

## 6. Data model

All additive; backup version 4 → 5 with a no-op migration (old files simply
have no plan).

```ts
Block {
  ...existing
  goal?: GoalId;              // 'conditioning' | 'strength' | 'muscle' | 'golf_power'
  weeks?: number;             // 4 or 8
  /** One entry per week, copied from the preset at creation so editing a
      preset later never rewrites a plan in flight. */
  phases?: WeekTarget[];
  benchmarks?: BenchmarkDef[];
}

WeekTarget {
  week: number; name: string;           // 1, 'Base'
  repLow: number; repHigh: number;
  sets: number; extraSetsOnMains?: number;
  rir: number; restSec: number;
  conditioning: Conditioning;           // this week's finisher dose
}

BlockExercise {
  ...existing
  kind?: 'strength' | 'conditioning';   // absent = strength, so every row keeps its meaning
  role?: 'opener' | 'main' | 'accessory';
}

Conditioning { format: 'intervals' | 'emom' | 'amrap' | 'steady';
               minutes: number; workSec?: number; restSec?: number;
               exerciseIds: string[] }

// New table — not SetLog, so muscle volume stays honest.
ConditioningLog { sessionId; format; minutesPlanned; minutesDone;
                  rounds?; extraReps?; rpe? }
BenchmarkResult { blockId; benchmarkId; date; value; unit }
```

Presets live in code (`src/lib/goalPlans.ts`), not the database: they are the
program design, and copying them into `Block.phases` at creation is what keeps
a running plan stable.

## 7. Who picks the exercises

The deterministic builder (`generateDay`) fills A/B/C from the preset's
pattern list, minus retired exercises, with the AI as an optional "improve
this" pass using the standing instructions (single-leg, glutes, rotation, no
grip near golf). Both go through `validateBlock` as now. Chosen **once**, at
plan start — the plan's whole point is that they then stay put.

## 8. Phases of work

1. **Plan skeleton** — `goalPlans.ts` with the conditioning preset, Block
   fields, "Start a plan" sheet, calendar placement for every week, the
   *Week N of M* banner, weekly targets shown on cards and in the session.
   Ends the current block cleanly (BACKLOG §5).
2. **Conditioning finisher** — formats, interval timer, ConditioningLog,
   conditioning minutes on History.
3. **Benchmarks + end-of-plan report.**
4. **More presets** — strength, muscle, golf power (8 weeks, with a deload).

Phase 1 alone is usable: four weeks of fixed workouts with a changing target.
The finisher can be done off the timer until Phase 2 lands.

## 9. Open questions

1. ❓ Start date: Monday 26 Oct (when the current block ends), or sooner?
2. ❓ Three days a week — Mon / Wed / Fri as proposed, or other days?
3. ❓ Session length: keep 60 min, or ~50 so the finisher fits?
4. ❓ Conditioning equipment (bike, rower, rope)?
5. ❓ Do walking rounds of golf count toward conditioning?
6. ❓ Benchmarks: happy with the four above, or swap any?
