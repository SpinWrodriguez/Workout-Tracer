import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { EXERCISES } from '../db/seed/exercises';
import type { Block, BlockExercise, DaySlot, GolfDay } from '../db/types';
import { shiftIso } from './format';
import { MUSCLE_WORKOUTS, buildPlanDraft, isGolfSafe, startPlan } from './goalPlans';
import { readPlans } from './program';
import { applyShortWeek, readWeekStatus, shortWeekPlan } from './shortWeek';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const MON = '2026-10-26';
const THU = shiftIso(MON, 3);
const FRI = shiftIso(MON, 4);
const SAT = shiftIso(MON, 5);
const golf: GolfDay[] = [{ date: SAT, status: 'planned', holes: 18 }];

let block: Block;
let entries: BlockExercise[];

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.exercise.bulkPut(EXERCISES);
  await db.golfDay.bulkPut(golf);
  const id = await startPlan({ start: MON, draft: buildPlanDraft(EXERCISES), exercisesById: byId });
  block = (await db.block.get(id)) as Block;
  entries = await db.blockExercise.where('blockId').equals(id).toArray();
});

const plan = (dates: string[], todo: DaySlot[] = ['A', 'B', 'C']) =>
  shortWeekPlan({ dates, todo, workouts: MUSCLE_WORKOUTS, entries, exercisesById: byId, golf });

describe('one day left', () => {
  it('makes one catch-up with the main lift of every workout still to do', () => {
    const [day] = plan([THU]);
    expect(day?.name).toBe('Catch-up');
    const ids = day?.rows?.map((r) => r.exerciseId) ?? [];
    for (const main of entries.filter((r) => r.role === 'main')) expect(ids).toContain(main.exerciseId);
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(day?.rows?.every((r) => r.targetSets <= 3)).toBe(true);
  });

  it('keeps grip- and back-heavy lifts off the day before golf, and says which went', () => {
    const [day] = plan([FRI]);
    for (const row of day?.rows ?? []) expect(isGolfSafe(byId.get(row.exerciseId) as never), row.exerciseId).toBe(true);
    expect(day?.dropped).toContain('Romanian deadlift');
  });
});

describe('two days left', () => {
  it('moves the two workouts themselves when they fit, the golf-safe one to Friday', () => {
    const days = plan([THU, FRI], ['B', 'C']);
    expect(days.map((d) => [d.date, d.slot])).toEqual([
      [THU, 'B'],
      [FRI, 'C'],
    ]);
  });

  it('merges three workouts into two short days, the heavy lifts on the earlier one', () => {
    const days = plan([THU, FRI]);
    expect(days.map((d) => d.slot)).toEqual(['X', 'Y']);
    const friday = days.find((d) => d.date === FRI);
    for (const row of friday?.rows ?? []) expect(isGolfSafe(byId.get(row.exerciseId) as never)).toBe(true);
    const thursday = days.find((d) => d.date === THU)?.rows?.map((r) => r.exerciseId);
    expect(thursday).toContain('bb_rdl');
  });
});

describe('putting it on the calendar', () => {
  it('writes the catch-up, places it, and clears the other days left', async () => {
    const days = plan([THU]);
    await applyShortWeek(block, days, THU);
    const dates = (await readPlans())[block.id] ?? {};
    expect(dates[THU]).toBe('X');
    expect(dates[FRI]).toBeNull();
    expect(await db.blockExercise.where('daySlot').equals('X').count()).toBeGreaterThan(0);
  });

  it('counts a catch-up as covering the workouts it stood in for', async () => {
    await db.session.put({ id: 's_x', blockId: block.id, daySlot: 'X', date: THU });
    const status = await readWeekStatus(block, FRI);
    expect(status.todo).toEqual([]);
  });

  it('notices a workout whose day has gone by', async () => {
    const status = await readWeekStatus(block, THU);
    expect(status.behind).toBe(true);
    expect(status.todo).toEqual(['A', 'B', 'C']);
    expect(status.daysLeft).toEqual([THU, FRI, shiftIso(MON, 6)]);
  });
});
