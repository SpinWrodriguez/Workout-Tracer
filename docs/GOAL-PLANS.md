# Goal plans — design

Status: **agreed, not built.** Mock-up of every screen below:
https://claude.ai/artifact/TNNugYsyWRBEXCStMoSTUy

## 1. Why

The app has one block (31 Aug – 26 Oct) holding 12 workouts, each generated on
its own with no thread between them. The log shows the cost: of 55 exercises
ever used, 8 have been done four or more times. Nothing can progress if it
comes round once a month.

A goal plan works the other way round: **one goal, a fixed length, three
fixed workouts repeated every week, and a target that changes week by week**.
The exercises are chosen once, at the start; what moves is the dose.

It also closes BACKLOG §5 ("what happens when a block ends"): a plan *is* a
block with a goal, and finishing one is how the next starts.

The month of general conditioning the first draft planned is the month the
lifter has just done. The first plan to build is the serious one.

## 2. The first plan: Muscle, 8 weeks

Matches the standing instructions: build muscle while holding 82 kg or under,
golf second but protected.

| Week | Phase | Sets per muscle per week | Reps | Reps in reserve |
|---|---|---|---|---|
| 1–2 | Settle in | ~10 | 10–12 | 3 |
| 3–5 | Build | ~12 → 14 | 8–12 | 2 |
| 6–7 | Push | ~16 | 6–10 | 1–2 |
| 8 | Lighter + test | ~8 | 8–10 | 3 |

- **Mon / Wed / Fri**, starting **Mon 26 Oct**, ending Sun 20 Dec. Golf is
  Saturday, so Friday's workout (C) is built golf-safe from the start: no
  high-grip, no high spinal load, no heavy legs, no finisher.
- **Every workout runs in the same order:** 5 min warm-up (90/90 hip switch,
  open book, T-spine + high knee; not counted as sets), 8–10 min **golf
  power** (one explosive or rotational move 3 × 5 fast, one anti-rotation
  move 2 × 8–10), then the muscle work, then the Mon/Wed finisher. About 85%
  of the week's sets are muscle work and 15% golf, close to the 1-in-6 the
  conditioning month already did.
- **Golf power by day:** Mon jump squat + Pallof press; Wed landmine
  rotational press + Copenhagen plank; Fri light cable chop + side plank as a
  primer for Saturday. Weeks 1–5 train speed; weeks 6–7 keep it fast but drop
  to 2 sets so it adds no fatigue while the lifting peaks; week 8 re-tests.
- **Muscle choices that serve the swing:** glutes and hips against early
  extension, adductors for a stable lead leg, lats against lead-arm collapse,
  anti-rotation core so the turn does not come from the lower back.
- **Three workouts, seven slots each**, about 55 minutes:
  - A · Lower + Push: opener, lower main, upper push, single-leg, delts,
    overhead triceps, calves.
  - B · Pull + Hinge: opener, hinge main, vertical pull, row, hamstring curl,
    curl, core.
  - C · Upper + Glutes (golf-safe): light rotation, hip thrust, press,
    pullover, fly, rear delts, seated calves.
- **Progression inside the plan** is the existing rule (top of range at
  RIR ≥ 2 → next rung). The plan changes only the *target* each week: range,
  sets, reps in reserve, rest. A lagging muscle (lowest on Levels last week)
  gets one extra set the following week.
- **Small finisher** on Mon and Wed, about 8 minutes, to keep the conditioning
  month's gains. Formats in §4.
- **Judged on:** estimated 1-RM of the main lifts (week 1 vs week 8), weekly
  sets per muscle, and the 7-day body-weight average staying ≤ 82 kg. Golf
  side: standing broad jump and the landmine scoop toss load moved fast,
  week 1 vs week 8, plus swing speed when a radar is available.

## 3. Short weeks — the backup plan

A plan that only works in a perfect week fails by week 3. So the plan expects
missed days and has one rule set for them.

**How a week counts**

| Done that week | What happens |
|---|---|
| 3 workouts | Full week. |
| 1 or 2, with the catch-up below | Counts. The plan moves on. |
| None | The week repeats next week; the plan ends a week later. |
| Back after 2+ weeks off | One re-entry week at week-1 targets, weights about 10% lighter, then the plan resumes where it stopped. |

**When the week goes wrong.** When workouts are behind the calendar (or from
"Can't make all three this week?" on Program), the app asks how many days are
left and offers:

- **2 days → two short workouts (~45 min each).** All the main lifts, about
  80% of the sets. The golf rule decides the split: squat and deadlift go to
  the earlier day, golf-safe work to Friday.
- **1 day → one catch-up workout (~55 min).** The main lift from each of A, B
  and C, plus the two muscles furthest below target on Levels. Accessories wait
  until next week. Every main lift still gets its weekly exposure, so next
  week's weights still go up.
- **None → skip.** The week repeats next week, as above.

The catch-up and two-day versions are **built from the plan's own exercises**,
never new ones, so the progression history stays continuous. They are
temporary: next week is back to A, B and C.

## 4. Conditioning finisher

The app only knows sets of reps or seconds. The finisher needs a timed block.

| Format | Prescription | Logged |
|---|---|---|
| Intervals | work s / rest s × rounds | rounds completed, RPE |
| EMOM | N reps every minute × minutes | minutes completed, RPE |
| AMRAP | circuit for N minutes | rounds + extra reps, RPE |
| Steady | N minutes continuous | minutes, RPE |

- **Exercise choice:** library minus retired, deleted, advanced-skill,
  high-spinal-load and mobility rows. Hinges only at low spinal load (swings
  yes, deadlifts no). Golf rules apply.
- **Timer:** the rest timer grows an interval mode — work/rest countdown with
  the haptic tick on each change and the round number on screen. Same
  wall-clock deadline approach, so a locked phone does not drift.
- **Volume:** finisher rounds are **not** counted as muscle sets (they would
  flood the body map). History gets its own weekly *conditioning minutes*.

## 5. How it looks in the app

- **Program → Start a plan** (also offered when a block ends):
  1. Goal (Muscle first; Strength and Golf power later), days, start date.
  2. **Build my workouts** runs the workout generator against the plan's slots
     and the standing instructions. Retired and deleted exercises are left out.
  3. Review: every slot can be swapped, and the picker only offers exercises
     that fit that slot (and are golf-safe on Friday).
  4. Start → a new block is created, the workouts written, every week placed.
- **During the plan:** banner *Week 3 of 8 · Build* with this week's target;
  each workout card and the session screen show it ("3 × 8–12 · 2 in reserve
  · rest 90 s"), plus last week's sets and the suggested weight.
- **Levels stays**, with the heat map, measured against this week's plan
  target: done so far vs the whole week, and a *short* tag on muscles that
  will finish under target. Traps, forearms and lower back are marked
  *indirect* and never flagged.
- **End of plan:** main lifts before/after, weekly sets, body weight, sessions
  done, and a suggested next plan (Muscle → Strength).
- The old 12 workouts stay with the old block: history and charts keep them.

## 6. A way back

The plan has to be something the lifter can leave. Two layers:

- **In the app: End plan.** One button on the plan banner, with a confirm.
  It ends the plan's block where it is, keeps every logged set, and puts the
  app back to free-form: Program shows the workout shelf, New workout and the
  day sheet exactly as today. Nothing about the old way is deleted by the
  plan; while a plan runs, the loose shelf is hidden, not removed.
- **In the code: the branch `before-goal-plans`** on GitHub is the app as it
  stood before any of this was built (commit de547b1). If the plan feature
  as a whole is not wanted, that branch is what the app goes back to; the
  data model changes are additive, so data logged during a plan still loads
  in it.

## 7. Clean-up (done)

Removed to make room: the AI week planner, Home's Recent sessions, and three
Settings cards merged into About & data. **Kept:** Levels, the coach chat, and
workout generation, which becomes the engine of *Build my workouts*.

When a plan is running, the Program shelf of loose workouts is hidden and the
plan's three workouts take its place; one-off workouts stay possible from the
+. Ending the plan brings the shelf back (§6).

## 8. Data model

All additive; backup version 4 → 5 with a no-op migration.

```ts
Block {
  ...existing
  goal?: GoalId;              // 'muscle' | 'strength' | 'golf_power'
  weeks?: number;             // 8
  /** One entry per week, copied from the preset at creation so editing a
      preset later never rewrites a plan in flight. */
  phases?: WeekTarget[];
  /** Weeks repeated or inserted (a skipped week, a re-entry week). */
  adjustments?: { afterWeek: number; kind: 'repeat' | 'reentry' }[];
}

WeekTarget {
  week: number; name: string;           // 3, 'Build'
  repLow: number; repHigh: number;
  sets: number; rir: string; restSec: number;
  finisherMin: number;
}

BlockExercise {
  ...existing
  role?: 'opener' | 'main' | 'accessory' | 'finisher';
  slot?: string;                        // 'lower', 'push', 'hamcurl', …
}
```

Presets live in code (`src/lib/goalPlans.ts`). The catch-up and two-day
workouts are computed on the day from the plan's own rows, never stored as
workouts of their own.

## 9. Phases of work

1. **Plan skeleton** — Muscle preset, Block fields, Start a plan with Build
   my workouts and slot swapping, calendar placement, the *Week N of 8*
   banner, weekly targets on cards and in the session, Levels against the
   target, End plan. Ends the current block cleanly.
2. **Short weeks** — how weeks count, the catch-up and two-day versions,
   repeat and re-entry weeks.
3. **Finisher** — formats, interval timer, conditioning minutes on History.
4. **End-of-plan report**, then the Strength and Golf power presets.
