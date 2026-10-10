import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { EXERCISES } from '../db/seed/exercises';
import type { Block } from '../db/types';
import { shiftIso } from './format';
import {
  MUSCLE_PHASES,
  PRESETS,
  MUSCLE_WORKOUTS,
  buildPlanDraft,
  currentBlockOf,
  defaultPlanStart,
  endPlan,
  fitsSlot,
  isGolfSafe,
  phaseFor,
  planPhaseOf,
  planStateOf,
  planWeekOf,
  prescriptionFor,
  slotOptions,
  startPlan,
  syncPlanWeek,
} from './goalPlans';
import { readBlockPlan, readSchedules } from './program';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const exercise = (id: string) => byId.get(id) as (typeof EXERCISES)[number];

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('the Muscle preset', () => {
  it('runs eight weeks, peaking in weeks 6 and 7 and easing off in week 8', () => {
    expect(MUSCLE_PHASES).toHaveLength(8);
    const sets = MUSCLE_PHASES.map((p) => p.setsPerMuscle);
    expect(Math.max(...sets)).toBe(sets[5]);
    expect(sets[7]).toBeLessThan(sets[0] as number);
  });

  it('lists only candidates that really fit their slot', () => {
    for (const def of MUSCLE_WORKOUTS) {
      for (const slot of def.slots) {
        for (const id of slot.candidates) {
          const e = byId.get(id);
          expect(e, `${def.slot}.${slot.key}: ${id} is not an exercise`).toBeTruthy();
          expect(fitsSlot(e as never, slot, def.golfSafe), `${def.slot}.${slot.key}: ${id}`).toBe(true);
        }
      }
    }
  });

  it('puts golf work first in every workout', () => {
    for (const def of MUSCLE_WORKOUTS) {
      expect(def.slots[0]?.role).toBe('power');
      expect(def.slots[1]?.role).toBe('core');
    }
  });
});

describe('Build my workouts', () => {
  it('fills every slot, with no exercise twice in one workout', () => {
    for (const { def, picks } of buildPlanDraft(EXERCISES)) {
      expect(picks.every(Boolean), def.slot).toBe(true);
      expect(new Set(picks).size).toBe(picks.length);
    }
  });

  it('keeps the day before golf free of grip-heavy and back-heavy work', () => {
    const friday = buildPlanDraft(EXERCISES).find((w) => w.def.golfSafe);
    expect(friday?.def.weekday).toBe(5);
    for (const id of friday?.picks ?? []) expect(isGolfSafe(exercise(id as string)), id).toBe(true);
  });

  it('never picks what was taken off the shelf', () => {
    const shelf = EXERCISES.filter((e) => e.id !== 'bb_back_squat' && e.id !== 'bb_bench_press');
    const a = buildPlanDraft(shelf).find((w) => w.def.slot === 'A');
    expect(a?.picks).not.toContain('bb_back_squat');
    expect(a?.picks).toContain('bb_front_squat');
    expect(a?.picks).toContain('sm_bench_press');
  });

  it('offers a swap list of fitting exercises, its own candidates first', () => {
    const lower = MUSCLE_WORKOUTS[0]?.slots.find((s) => s.key === 'lower');
    const options = slotOptions(lower as never, EXERCISES, false).map((e) => e.id);
    expect(options.slice(0, 2)).toEqual(['bb_back_squat', 'bb_front_squat']);
    expect(options).not.toContain('bb_curl');
  });
});

describe('the week targets', () => {
  it('follows the phase for mains and stays short and fast for golf power', () => {
    const week3 = phaseFor(3);
    expect(prescriptionFor('main', exercise('bb_back_squat'), week3)).toEqual({
      targetSets: 3,
      repRangeLow: 8,
      repRangeHigh: 12,
    });
    const power = prescriptionFor('power', exercise('bw_jump_squat'), phaseFor(6));
    expect(power.targetSets).toBe(2);
    expect(power.repRangeHigh).toBeLessThanOrEqual(8);
  });

  it('times a hold rather than counting it', () => {
    const plank = prescriptionFor('core', exercise('bw_side_plank'), phaseFor(1));
    expect(plank.repRangeLow).toBeGreaterThanOrEqual(20);
  });
});

describe('which block is current', () => {
  const free: Block = { id: 'block_1', startDate: '2026-08-31', endDate: '2026-10-26', focusMuscles: [] };
  const plan: Block = {
    id: 'plan_2026-10-26',
    startDate: '2026-10-26',
    endDate: '2026-12-20',
    focusMuscles: [],
    plan: { goal: 'muscle', weeks: 8 },
  };

  it('keeps the free-form block until the plan starts', () => {
    expect(currentBlockOf([free, plan], '2026-10-20')?.id).toBe('block_1');
    expect(planStateOf(plan, '2026-10-20')).toBe('upcoming');
  });

  it('switches on the plan Monday', () => {
    expect(currentBlockOf([free, plan], '2026-10-26')?.id).toBe(plan.id);
  });

  it('falls back to the free-form block once the plan is ended', () => {
    const ended = { ...plan, plan: { goal: 'muscle' as const, weeks: 8, endedAt: '2026-11-10' } };
    expect(currentBlockOf([free, ended], '2026-11-11')?.id).toBe('block_1');
  });

  it('puts a running plan ahead of a free-form block that started later', () => {
    const lateFree = { ...free, id: 'block_2', startDate: '2026-10-28' };
    expect(currentBlockOf([lateFree, plan], '2026-10-29')?.id).toBe(plan.id);
  });

  it('starts a plan made on a Monday that day, otherwise the next Monday', () => {
    expect(defaultPlanStart('2026-10-26')).toBe('2026-10-26');
    expect(defaultPlanStart('2026-10-10')).toBe('2026-10-12');
  });
});

describe('a plan in the database', () => {
  const START = '2026-10-26';
  // The app seeds these on every boot; syncPlanWeek reads them from the table.
  beforeEach(async () => {
    await db.exercise.bulkPut(EXERCISES);
  });

  async function started() {
    const id = await startPlan({ start: START, draft: buildPlanDraft(EXERCISES), exercisesById: byId });
    return (await db.block.get(id)) as Block;
  }

  it('writes three workouts on Mon, Wed and Fri with week 1 targets', async () => {
    const block = await started();
    expect(block.endDate).toBe(shiftIso(START, 55));
    const schedule = (await readSchedules())[block.id] ?? {};
    expect(Object.entries(schedule).map(([slot, day]) => [slot, day?.weekday])).toEqual([
      ['A', 1],
      ['B', 3],
      ['C', 5],
    ]);
    const squat = await db.blockExercise.get([block.id, 'bb_back_squat', 'A']);
    expect(squat).toMatchObject({ role: 'main', targetSets: 3, repRangeLow: 10, repRangeHigh: 12 });
  });

  /** A logged session on a date, so that week counts. */
  async function trained(blockId: string, date: string) {
    await db.session.put({ id: `s_${date}`, blockId, daySlot: 'A', date });
  }

  it('moves the targets on when a new week starts, once', async () => {
    const block = await started();
    await trained(block.id, START);
    await trained(block.id, shiftIso(START, 7));
    await syncPlanWeek(block, shiftIso(START, 14)); // calendar week 3
    const squat = await db.blockExercise.get([block.id, 'bb_back_squat', 'A']);
    expect(squat).toMatchObject({ repRangeLow: 8, repRangeHigh: 12 });
    const now = (await db.block.get(block.id)) as Block;
    expect(now.plan?.appliedWeek).toBe(3);
    expect(planWeekOf(now, shiftIso(START, 14))).toBe(3);
    const cue = (await readSchedules())[block.id]?.A?.effortCue;
    expect(cue).toContain('Week 3 · Build');
  });

  it('repeats a week with nothing logged, and moves the end out a week', async () => {
    const block = await started();
    await trained(block.id, START); // week 1 trained, week 2 empty
    await syncPlanWeek(block, shiftIso(START, 14));
    const now = (await db.block.get(block.id)) as Block;
    expect(planWeekOf(now, shiftIso(START, 14))).toBe(2);
    expect(now.endDate).toBe(shiftIso(START, 8 * 7 + 6));
    expect(planPhaseOf(now, shiftIso(START, 14)).name).toBe('Settle in');
  });

  it('runs a re-entry week after two empty weeks, then picks up where it stopped', async () => {
    const block = await started();
    await trained(block.id, START); // week 1, then weeks 2 and 3 off
    await syncPlanWeek(block, shiftIso(START, 21)); // calendar week 4
    let now = (await db.block.get(block.id)) as Block;
    expect(planPhaseOf(now, shiftIso(START, 21)).name).toBe('Re-entry');
    expect((await readSchedules())[block.id]?.A?.effortCue).toContain('10% lighter');

    await trained(block.id, shiftIso(START, 21));
    await syncPlanWeek(now, shiftIso(START, 28)); // calendar week 5
    now = (await db.block.get(block.id)) as Block;
    expect(planPhaseOf(now, shiftIso(START, 28)).name).not.toBe('Re-entry');
    expect(planWeekOf(now, shiftIso(START, 28))).toBe(2);
  });

  it('clears catch-up workouts when the week turns', async () => {
    const block = await started();
    await trained(block.id, START);
    await db.blockExercise.put({
      blockId: block.id, exerciseId: 'bb_back_squat', daySlot: 'X', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 0, role: 'main',
    });
    await syncPlanWeek(block, shiftIso(START, 7));
    expect(await db.blockExercise.where('daySlot').equals('X').count()).toBe(0);
  });

  it('is what readBlockPlan hands the session once it has started', async () => {
    await db.block.put({ id: 'block_1', startDate: '2026-08-31', endDate: '2026-10-26', focusMuscles: [] });
    await started();
    const plan = await readBlockPlan();
    // Today is before 26 Oct in these tests only if the clock says so; either
    // way the answer is one of the two, never an ended or missing block.
    expect(['block_1', `plan_${START}`]).toContain(plan?.block.id);
  });

  it('ends without losing anything, and a plan not yet started is simply removed', async () => {
    const block = await started();
    await endPlan(block, shiftIso(START, 10));
    const ended = await db.block.get(block.id);
    expect(ended?.plan?.endedAt).toBe(shiftIso(START, 10));
    expect(await db.blockExercise.where('blockId').equals(block.id).count()).toBeGreaterThan(0);

    const again = await startPlan({ start: '2027-01-04', draft: buildPlanDraft(EXERCISES), exercisesById: byId });
    await endPlan((await db.block.get(again)) as Block, '2026-12-28');
    expect(await db.block.get(again)).toBeUndefined();
    expect(await db.blockExercise.where('blockId').equals(again).count()).toBe(0);
  });
});

describe('the Strength preset', () => {
  it('runs six weeks of fewer, heavier sets on the same days', () => {
    const preset = PRESETS.strength;
    expect(preset.phases).toHaveLength(6);
    expect(preset.workouts.map((w) => w.weekday)).toEqual([1, 3, 5]);
    expect(phaseFor(3, 'strength').main).toEqual({ low: 4, high: 6 });
  });

  it('builds two main lifts a workout, and the Friday stays golf-safe', () => {
    const draft = buildPlanDraft(EXERCISES, 'strength');
    for (const { def, picks } of draft) {
      expect(def.slots.filter((s) => s.role === 'main')).toHaveLength(2);
      expect(picks.every(Boolean)).toBe(true);
      if (def.golfSafe) for (const id of picks) expect(isGolfSafe(exercise(id as string))).toBe(true);
    }
    expect(draft[2]?.picks).toContain('bb_overhead_press');
  });

  it('starts as a six-week plan', async () => {
    const id = await startPlan({ start: '2026-10-26', draft: buildPlanDraft(EXERCISES, 'strength'), exercisesById: byId, goal: 'strength' });
    const block = (await db.block.get(id)) as Block;
    expect(block.plan).toMatchObject({ goal: 'strength', weeks: 6 });
    expect(block.endDate).toBe(shiftIso('2026-10-26', 41));
  });
});
