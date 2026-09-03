import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise, DaySlot } from '../db/types';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { balanceSets, generateDay, WEEKLY_SET_TARGET } from './blockBuilder';
import { templateDayFor } from './weekTemplate';
import {
  SET_DURATION_SECONDS,
  SET_TOTAL_TOLERANCE,
  daysClearOfGolf,
  formatViolationsForModel,
  severityOf,
  sessionMinutes,
  validateBlock,
  workingRepRange,
  type BlockProposal,
  type ValidationContext,
} from './blockValidation';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const find = (id: string) => {
  const exercise = byId.get(id);
  if (!exercise) throw new Error(`missing ${id}`);
  return exercise;
};

/** The stated context: 2 sessions a week, golf Saturday, 40 min, first block. */
const CONTEXT: ValidationContext = {
  exercisesById: byId,
  golfWeekdays: [6],
  weeklySetTarget: WEEKLY_SET_TARGET,
  sessionBudgetMinutes: 40,
  hasHistory: false,
  laddersFor: (exercise) => ladderFor(exercise, DEFAULT_INVENTORY),
};

function entry(exerciseId: string, over: Partial<BlockExercise> = {}): BlockExercise {
  const exercise = find(exerciseId);
  return {
    blockId: 'b1',
    exerciseId,
    daySlot: 'A',
    targetSets: 3,
    repRangeLow: exercise.repMin,
    repRangeHigh: exercise.repMax,
    order: 0,
    ...over,
  };
}

function proposal(days: { slot: DaySlot; weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; ids: string[] }[]): BlockProposal {
  return {
    days: days.map((day) => ({
      slot: day.slot,
      weekday: day.weekday,
      exercises: day.ids.map((id, i) => entry(id, { daySlot: day.slot, order: i })),
    })),
  };
}

const codes = (p: BlockProposal, ctx = CONTEXT) =>
  validateBlock(p, ctx).map((violation) => violation.code);

/* -------------------------------------------------------------------------- */

describe('rule a — every id exists in the table', () => {
  it('rejects an invented exercise', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_bench_press'] }]);
    p.days[0]!.exercises.push({ ...entry('bb_bench_press'), exerciseId: 'leg_press' });
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'unknown_exercise');
    expect(found?.message).toMatch(/leg_press.*not in the exercise table/);
  });
});

describe('rule b — reps inside the exercise bounds (defect 2)', () => {
  it('rejects a Turkish get-up at 10-15 reps', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['kb_turkish_get_up'] }]);
    p.days[0]!.exercises[0]!.repRangeLow = 10;
    p.days[0]!.exercises[0]!.repRangeHigh = 15;
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'rep_range');
    expect(found?.message).toMatch(/Turkish get-up is set to 10-15, outside its usual 1-5 reps/);
  });

  it('knows a get-up is a 1-5 rep movement', () => {
    expect(find('kb_turkish_get_up').repMin).toBe(1);
    expect(find('kb_turkish_get_up').repMax).toBe(5);
    expect(find('bb_deadlift').repMin).toBe(3);
    expect(find('bb_deadlift').repMax).toBe(8);
  });

  it('narrows the hypertrophy target to what the exercise can take', () => {
    // The global 10-15 does not overlap 1-5, so the exercise wins outright.
    expect(workingRepRange(find('kb_turkish_get_up'), { low: 10, high: 15 })).toEqual({
      low: 1,
      high: 5,
    });
    // A partial overlap is intersected rather than replaced.
    expect(workingRepRange(find('bb_deadlift'), { low: 6, high: 10 })).toEqual({
      low: 6,
      high: 8,
    });
  });

  it('widens downward when the exercise ceiling is what pinned it', () => {
    // Overhead press takes 5-10; a light day asking for 10-17 lands on its top.
    const press = workingRepRange(find('bb_overhead_press'), { low: 10, high: 17 });
    expect(press.high).toBe(10);
    expect(press.low).toBeLessThan(press.high);
    expect(press.low).toBeGreaterThanOrEqual(find('bb_overhead_press').repMin);
  });

  it('never collapses to a single rep value', () => {
    // A kettlebell swing takes 10-20; a 6-10 target lands entirely on its floor.
    const swing = workingRepRange(find('kb_swing'), { low: 6, high: 10 });
    expect(swing.low).toBe(10);
    expect(swing.high).toBeGreaterThan(swing.low);
    expect(swing.high).toBeLessThanOrEqual(find('kb_swing').repMax);
  });
});

describe('rule c — grip clearance computed from the calendar (defect 1)', () => {
  it('measures days clear rather than accepting a claim', () => {
    expect(daysClearOfGolf(1, [6])).toBe(5); // Mon
    expect(daysClearOfGolf(2, [6])).toBe(4); // Tue
    expect(daysClearOfGolf(4, [6])).toBe(2); // Thu
    expect(daysClearOfGolf(6, [6])).toBe(0); // the round itself
  });

  it('rejects high-grip work on a Thursday with golf on Saturday', () => {
    const p = proposal([{ slot: 'A', weekday: 4, ids: ['bb_bent_over_row'] }]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'grip_conflict');
    expect(found?.message).toMatch(/Thu, 2 days before your next round/);
    // A problem has to carry the change that resolves it, or it is just bad
    // news: here, the day the session should move to.
    expect(found?.fix).toMatchObject({ kind: 'move_to_weekday' });
  });

  it('accepts the same work on Monday or Tuesday', () => {
    for (const weekday of [1, 2] as const) {
      const p = proposal([{ slot: 'A', weekday, ids: ['bb_bent_over_row'] }]);
      expect(codes(p)).not.toContain('grip_conflict');
    }
  });
});

describe('rule d — one heavy spinal lift per session (defect 3)', () => {
  it('rejects a deadlift stacked with a bent-over row', () => {
    const p = proposal([
      { slot: 'A', weekday: 1, ids: ['bb_deadlift', 'bb_bent_over_row'] },
    ]);
    const found = validateBlock(p, { ...CONTEXT, hasHistory: true }).find(
      (v) => v.code === 'spinal_stacking',
    );
    expect(found?.message).toMatch(/stacks 2 heavy spinal-load lifts/);
  });

  it('marks the three the spec names as high spinal load', () => {
    expect(find('bb_deadlift').spinalLoad).toBe('high');
    expect(find('bb_rdl').spinalLoad).toBe('high');
    expect(find('bb_bent_over_row').spinalLoad).toBe('high');
  });
});

describe('rule e — no advanced work in a first block (defect 3)', () => {
  it('rejects a conventional deadlift with no history', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_deadlift'] }]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'skill_too_advanced');
    expect(found?.message).toMatch(/advanced movement and this is a first block/);
  });

  it('allows it once there is history', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_deadlift'] }]);
    expect(codes(p, { ...CONTEXT, hasHistory: true })).not.toContain('skill_too_advanced');
  });
});

describe('rule f — weekly pattern coverage (defect 4)', () => {
  it('rejects a week with no squat in it', () => {
    const p = proposal([
      { slot: 'A', weekday: 1, ids: ['bb_rdl', 'bb_bench_press', 'cb_seated_row', 'bw_plank'] },
    ]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'pattern_coverage');
    expect(found?.message).toMatch(/never trains: squat/);
  });

  it('does not let a calf raise pass as a squat or a curl as a pull', () => {
    const p = proposal([
      { slot: 'A', weekday: 1, ids: ['sm_calf_raise', 'bb_curl', 'bb_rdl', 'bb_bench_press', 'bw_plank'] },
    ]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'pattern_coverage');
    expect(found?.message).toMatch(/squat/);
    expect(found?.message).toMatch(/pull/);
  });
});

describe('rule g — weekly set total (defect 5)', () => {
  it('rejects a week well under the target', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_bench_press'] }]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'weekly_set_total');
    expect(found?.message).toMatch(/totals 3 sets; the target is 33/);
  });

  it('bands the target at 80 to 120 percent', () => {
    expect(SET_TOTAL_TOLERANCE).toEqual({ low: 0.8, high: 1.2 });
  });
});

describe('rule h — start weights must be loadable', () => {
  it('rejects 27 kg on the free bar and offers a rung that exists', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_back_squat'] }]);
    p.days[0]!.exercises[0]!.startWeightKg = 27;
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'unloadable_weight');
    expect(found?.message).toMatch(/27 kg cannot be loaded/);
    expect(found?.fix).toMatchObject({ kind: 'snap_weight', kg: 26 });
  });

  it('accepts a real rung', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_back_squat'] }]);
    p.days[0]!.exercises[0]!.startWeightKg = 26;
    expect(codes(p)).not.toContain('unloadable_weight');
  });
});

describe('time estimate (defect 5)', () => {
  it('counts sets times work plus that exercise own rest', () => {
    const deadlift = find('bb_deadlift'); // 180 s rest
    const minutes = sessionMinutes([entry('bb_deadlift', { targetSets: 3 })], byId);
    // 5 min warm-up + 3 x (40 + 180) s
    expect(minutes).toBe(Math.round((300 + 3 * (SET_DURATION_SECONDS + deadlift.restSeconds)) / 60));
    expect(minutes).toBeGreaterThan(15);
  });

  it('does not price a heavy hinge like an isolation movement', () => {
    const heavy = sessionMinutes([entry('bb_deadlift', { targetSets: 3 })], byId);
    const light = sessionMinutes([entry('cb_face_pull', { targetSets: 3 })], byId);
    expect(heavy).toBeGreaterThan(light);
  });

  it('rejects a session over its budget', () => {
    const p = proposal([
      { slot: 'A', weekday: 1, ids: ['bb_back_squat', 'bb_rdl', 'bb_bench_press', 'cb_seated_row'] },
    ]);
    for (const e of p.days[0]!.exercises) e.targetSets = 5;
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'over_time_budget');
    expect(found?.message).toMatch(/over the 40 min budget/);
  });
});

/*
 * The rationale tests lived here — stripScheduleClaims took a model's claims
 * about spacing back out, and scheduleSentence wrote the true one from the
 * calendar. Both are deleted with generateBlock, the only thing that used
 * them: the app no longer asks a model to narrate a week it did not place.
 *
 * The rule they served is unchanged and enforced above instead: nothing
 * self-reports compliance, and the validator recomputes.
 */

describe('violations are written to be handed back to a model', () => {
  it('numbers them and names the code', () => {
    const p = proposal([{ slot: 'A', weekday: 4, ids: ['bb_deadlift'] }]);
    const text = formatViolationsForModel(validateBlock(p, CONTEXT));
    expect(text).toMatch(/previous response was rejected/);
    expect(text).toMatch(/\[grip_conflict\]/);
    expect(text).toMatch(/\[skill_too_advanced\]/);
  });

  it('is empty when nothing is wrong', () => {
    expect(formatViolationsForModel([])).toBe('');
  });
});

/* -------------------------------------------------------------------------- */

/*
 * The week the app actually builds, assembled the way the app assembles it:
 * one day at a time through generateDay, then the weekly set budget spent
 * across them. generateBlock used to do this in one call and chose the days
 * itself; it is gone, and building the fixture by hand is what keeps these
 * acceptance tests about the validator rather than about a dead function.
 */
function builtWeek() {
  const days = (['A', 'B'] as DaySlot[]).map((slot, index) =>
    generateDay({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: [],
      template: templateDayFor({
        slot,
        weekday: (index + 1) as never,
        intensity: 'heavy',
        index,
        minutesPerSession: 40,
        golfWeekdays: [6],
      }),
      exclude: [],
      hasHistory: false,
    }),
  );
  // The second day cannot reuse what the first took.
  const taken = new Set(days[0]?.exercises.map((entry) => entry.exerciseId) ?? []);
  days[1] = generateDay({
    blockId: 'b1',
    exercises: EXERCISES,
    focusMuscles: [],
    template: templateDayFor({
      slot: 'B',
      weekday: 2 as never,
      intensity: 'heavy',
      index: 1,
      minutesPerSession: 40,
      golfWeekdays: [6],
    }),
    exclude: [...taken],
    hasHistory: false,
  });

  const byIdLocal = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
  balanceSets(
    days,
    days.map((day) =>
      templateDayFor({
        slot: day.slot,
        weekday: day.weekday,
        intensity: day.intensity,
        minutesPerSession: 40,
        golfWeekdays: [6],
      }),
    ),
    byIdLocal,
    WEEKLY_SET_TARGET,
  );
  return days;
}

describe('the generated block passes its own validator', () => {
  const block = { days: builtWeek() };

  it('produces no violations at all', () => {
    const violations = validateBlock(
      { days: block.days.map((day) => ({ slot: day.slot, weekday: day.weekday, exercises: day.exercises })) },
      {
        exercisesById: byId,
        golfWeekdays: [6],
        weeklySetTarget: WEEKLY_SET_TARGET,
        sessionBudgetMinutes: 40,
        hasHistory: false,
        laddersFor: (exercise) => ladderFor(exercise, DEFAULT_INVENTORY),
      },
    );
    expect(violations).toEqual([]);
  });

  it('never prescribes an advanced lift in a first block (defect 3)', () => {
    const ids = block.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('bb_deadlift');
    for (const id of ids) expect(byId.get(id)?.skillLevel).not.toBe('advanced');
  });

  it('never stacks two heavy spinal lifts (defect 3)', () => {
    for (const day of block.days) {
      const heavy = day.exercises.filter((e) => byId.get(e.exerciseId)?.spinalLoad === 'high');
      expect(heavy.length, `day ${day.slot}`).toBeLessThanOrEqual(1);
    }
  });

  it('trains a squat somewhere in the week (defect 4)', () => {
    const ids = block.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(
      ids.some((id) => {
        const exercise = byId.get(id);
        return (
          exercise?.pattern === 'squat' &&
          exercise.primaryMuscles.some((m) => ['quads', 'glutes'].includes(m))
        );
      }),
    ).toBe(true);
  });

  it('lands inside the weekly set band (defect 5)', () => {
    const sets = block.days.reduce(
      (n, day) => n + day.exercises.reduce((m, e) => m + e.targetSets, 0),
      0,
    );
    expect(sets).toBeGreaterThanOrEqual(Math.round(WEEKLY_SET_TARGET * 0.8));
    expect(sets).toBeLessThanOrEqual(Math.round(WEEKLY_SET_TARGET * 1.2));
  });

  it('keeps every session inside the time budget, priced with real rest', () => {
    for (const day of block.days) {
      expect(day.estimatedMinutes, `day ${day.slot}`).toBeLessThanOrEqual(40);
      expect(day.estimatedMinutes).toBe(sessionMinutes(day.exercises, byId));
    }
  });

  it('prescribes every exercise inside its own rep bounds (defect 2)', () => {
    for (const day of block.days) {
      for (const e of day.exercises) {
        const exercise = byId.get(e.exerciseId);
        expect(e.repRangeLow, e.exerciseId).toBeGreaterThanOrEqual(exercise!.repMin);
        expect(e.repRangeHigh, e.exerciseId).toBeLessThanOrEqual(exercise!.repMax);
      }
    }
  });

  /*
   * "states only clearances the calendar actually gives" lived here and is
   * gone with the rationale it checked: generateBlock wrote that sentence
   * through scheduleSentence and stripScheduleClaims, and all three are
   * deleted. The rule it protected — nothing self-reports compliance — is now
   * carried by the validator tests above, which recompute rather than read a
   * claim.
   */

  it('puts a start weight on a real rung (rule h)', () => {
    for (const day of block.days) {
      for (const e of day.exercises) {
        if (e.startWeightKg === undefined) continue;
        expect(ladderFor(byId.get(e.exerciseId)!, DEFAULT_INVENTORY)).toContain(e.startWeightKg);
      }
    }
  });
});

describe('what counts as a rule', () => {
  it('separates things that cost you something from advice', () => {
    // The golf rule is the reason the app exists; a session running seven
    // minutes long is not the same kind of statement.
    expect(severityOf('grip_conflict')).toBe('problem');
    expect(severityOf('spinal_stacking')).toBe('problem');
    expect(severityOf('unloadable_weight')).toBe('problem');
    expect(severityOf('forbidden_day')).toBe('problem');

    expect(severityOf('over_time_budget')).toBe('suggestion');
    expect(severityOf('weekly_set_total')).toBe('suggestion');
    expect(severityOf('rep_range')).toBe('suggestion');
    expect(severityOf('pattern_coverage')).toBe('suggestion');
  });

  it('lets a hand-built day run long before saying anything', () => {
    const day = (n: number) =>
      proposal([{ slot: 'A', weekday: 1, ids: Array.from({ length: n }, () => 'bb_curl') }]);
    const complains = (n: number) =>
      validateBlock(day(n), CONTEXT).some((v) => v.message.includes('one session'));

    // Eight is a long session, not a broken one.
    expect(complains(8)).toBe(false);
    expect(complains(12)).toBe(true);
  });
});

describe('every problem carries its own fix', () => {
  it('offers a way out of each one, or is not a problem at all', () => {
    // A rule that cannot describe its own resolution has no business being
    // reported as something to fix.
    const stacked = proposal([
      { slot: 'A', weekday: 1, ids: ['bb_back_squat', 'bb_bent_over_row'] },
    ]);
    const friday = proposal([{ slot: 'A', weekday: 5, ids: ['bb_back_squat'] }]);
    // Built by hand: the helper resolves ids against the table, and this one
    // deliberately is not in it.
    const unknown: BlockProposal = {
      days: [
        {
          slot: 'A',
          weekday: 1,
          exercises: [
            {
              blockId: 'block_1',
              exerciseId: 'not_a_real_exercise',
              daySlot: 'A',
              targetSets: 3,
              repRangeLow: 8,
              repRangeHigh: 10,
              order: 0,
            },
          ],
        },
      ],
    };

    for (const p of [stacked, friday, unknown]) {
      for (const violation of validateBlock(p, CONTEXT)) {
        if (severityOf(violation.code) !== 'problem') continue;
        expect(violation.fix, violation.message).toBeDefined();
        expect(violation.fix?.label, violation.message).toBeTruthy();
      }
    }
  });

  it('drops the later of two stacked spinal lifts, not the lift the day was built on', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_back_squat', 'bb_deadlift'] }]);
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'spinal_stacking');
    expect(found?.fix).toMatchObject({ kind: 'remove_exercise', exerciseId: 'bb_deadlift' });
  });
});
