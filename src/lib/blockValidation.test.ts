import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise, DaySlot } from '../db/types';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { generateBlock, WEEKLY_SET_TARGET } from './blockBuilder';
import {
  SET_DURATION_SECONDS,
  SET_TOTAL_TOLERANCE,
  daysClearOfGolf,
  formatViolationsForModel,
  scheduleSentence,
  sessionMinutes,
  stripScheduleClaims,
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
    expect(found?.message).toMatch(/Turkish get-up prescribed 10-15 reps, but it only takes 1-5/);
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
    expect(found?.message).toMatch(/Thu, 2 days before the next round/);
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
  it('rejects 27 kg on the free bar and names the neighbours', () => {
    const p = proposal([{ slot: 'A', weekday: 1, ids: ['bb_back_squat'] }]);
    p.days[0]!.exercises[0]!.startWeightKg = 27;
    const found = validateBlock(p, CONTEXT).find((v) => v.code === 'unloadable_weight');
    expect(found?.message).toMatch(/27 kg cannot be loaded.*26 or 30 kg/);
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

describe('rationale (defect 1)', () => {
  it('strips a model claim about spacing or compliance', () => {
    const text =
      'Pull volume is prioritised for the lats. All grip work is clear of Sat and Sun by at least 3 days. Pressing stays horizontal to spare the shoulder.';
    const kept = stripScheduleClaims(text);
    expect(kept).toContain('Pull volume is prioritised');
    expect(kept).toContain('Pressing stays horizontal');
    expect(kept).not.toMatch(/at least 3 days/);
  });

  it('generates the schedule sentence from the calendar instead', () => {
    const p = proposal([
      { slot: 'A', weekday: 1, ids: ['bb_bent_over_row', 'bb_bench_press'] },
    ]);
    const sentence = scheduleSentence(p, CONTEXT);
    expect(sentence).toMatch(/Mon day A/);
    expect(sentence).toMatch(/Grip work sits on Mon — 5 days clear of the next round/);
    expect(sentence).toMatch(/sets across the week/);
  });

  it('never claims clearance a Thursday does not have', () => {
    const p = proposal([{ slot: 'A', weekday: 4, ids: ['bb_bent_over_row'] }]);
    // States the real number even though the validator will reject the day.
    expect(scheduleSentence(p, CONTEXT)).toMatch(/on Thu — 2 days clear/);
  });
});

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

describe('the generated block passes its own validator', () => {
  const block = generateBlock({
    blockId: 'b1',
    exercises: EXERCISES,
    focusMuscles: [],
    sessionsPerWeek: 2,
    golfWeekdays: [6],
    split: 'full_body',
    minutesPerSession: 40,
    hasHistory: false,
    laddersFor: (exercise) => ladderFor(exercise, DEFAULT_INVENTORY),
  });

  it('produces no violations at all', () => {
    expect(block.violations).toEqual([]);
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

  it('states only clearances the calendar actually gives (defect 1)', () => {
    const claim = block.rationale.match(/Grip work sits on (.+?) — (\d+) days clear/);
    if (claim) {
      const labels = (claim[1] as string).split(' and ');
      const clear = Number(claim[2]);
      for (const label of labels) {
        const day = block.days.find((d) => d.weekdayLabel === label);
        expect(day, label).toBeDefined();
        expect(daysClearOfGolf(day!.weekday, [6])).toBeGreaterThan(3);
      }
      expect(clear).toBeGreaterThan(3);
    }
  });

  it('puts a start weight on a real rung (rule h)', () => {
    for (const day of block.days) {
      for (const e of day.exercises) {
        if (e.startWeightKg === undefined) continue;
        expect(ladderFor(byId.get(e.exerciseId)!, DEFAULT_INVENTORY)).toContain(e.startWeightKg);
      }
    }
  });
});
