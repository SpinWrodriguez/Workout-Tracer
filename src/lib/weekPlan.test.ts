import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import type { BlockExercise, DaySlot } from '../db/types';
import { writeSchedule } from './program';
import { readWeekPlan } from './weekPlan';
import { dateOfWeekday, type Weekday } from './golf';

const BLOCK = 'block_1';
/* A Wednesday, so there is a real past, present and future inside one week. */
const TODAY = '2026-09-02';

function entry(slot: DaySlot, exerciseId: string): BlockExercise {
  return {
    blockId: BLOCK,
    exerciseId,
    daySlot: slot,
    targetSets: 3,
    repRangeLow: 8,
    repRangeHigh: 10,
    order: 0,
  };
}

/* The app's own helper: hand-rolling this with toISOString silently shifts a
   day in any timezone behind UTC, which is exactly the bug it would be
   testing for. */
const dateOf = (weekday: Weekday) => dateOfWeekday(TODAY, weekday);

beforeEach(async () => {
  // Only Date is faked: Dexie's own work runs on real timers, and faking those
  // deadlocks every IndexedDB call in this file.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.block.put({
    id: BLOCK,
    startDate: '2026-08-31',
    endDate: '2026-10-12',
    focusMuscles: [],
  });
  await db.blockExercise.bulkPut([
    entry('A', 'bb_back_squat'),
    entry('B', 'bb_bench_press'),
    entry('C', 'bb_rdl'),
  ]);
  await writeSchedule(BLOCK, {
    A: { weekday: 1, intensity: 'heavy' }, // Mon, in the past
    B: { weekday: 3, intensity: 'heavy' }, // Wed, today
    C: { weekday: 4, intensity: 'light' }, // Thu, ahead
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('what to do next', () => {
  it("points at today's session when nothing is logged", async () => {
    const plan = await readWeekPlan();
    expect(plan?.next).toBe('B');
    expect(plan?.todaySlot).toBe('B');
  });

  it('moves on once today is done', async () => {
    await db.session.put({ id: 's1', blockId: BLOCK, daySlot: 'B', date: TODAY });
    const plan = await readWeekPlan();
    expect(plan?.next).toBe('C');
    expect(plan?.days.find((day) => day.slot === 'B')?.done).toBe(true);
  });

  it('falls back to a missed day rather than offering nothing', async () => {
    // Wednesday and Thursday done, Monday never was: there is no upcoming
    // session left, so the one still owed is better than silence.
    await db.session.bulkPut([
      { id: 's1', blockId: BLOCK, daySlot: 'B', date: TODAY },
      { id: 's2', blockId: BLOCK, daySlot: 'C', date: dateOf(4) },
    ]);
    const plan = await readWeekPlan();
    expect(plan?.next).toBe('A');
  });

  it('has no next when the whole week is done', async () => {
    await db.session.bulkPut([
      { id: 's1', blockId: BLOCK, daySlot: 'A', date: dateOf(1) },
      { id: 's2', blockId: BLOCK, daySlot: 'B', date: TODAY },
      { id: 's3', blockId: BLOCK, daySlot: 'C', date: dateOf(4) },
    ]);
    const plan = await readWeekPlan();
    expect(plan?.next).toBeUndefined();
    expect(plan?.days.every((day) => day.done)).toBe(true);
  });

  it('never points at a day with nothing in it', async () => {
    await db.blockExercise.clear();
    await db.blockExercise.put(entry('C', 'bb_rdl'));
    const plan = await readWeekPlan();
    expect(plan?.next).toBe('C');
  });

  it('dates every scheduled day so the week reads as a calendar', async () => {
    const plan = await readWeekPlan();
    expect(plan?.days.map((day) => day.date)).toEqual([dateOf(1), TODAY, dateOf(4)]);
    // Weekday order, so the list is the week rather than the slot alphabet.
    expect(plan?.days.map((day) => day.slot)).toEqual(['A', 'B', 'C']);
  });

  it('counts a session logged in a previous week as still owed', async () => {
    await db.session.put({ id: 'old', blockId: BLOCK, daySlot: 'B', date: '2026-08-26' });
    const plan = await readWeekPlan();
    expect(plan?.days.find((day) => day.slot === 'B')?.done).toBe(false);
    expect(plan?.next).toBe('B');
  });
});

describe('what belongs on the dashboard', () => {
  it('leaves out workouts that are not in this week', async () => {
    // A workout you own but have not placed is a thing you have, not a thing
    // you are doing — listing it beside Monday says the week contains it.
    await db.blockExercise.put(entry('D', 'bb_overhead_press'));
    const before = await readWeekPlan();
    expect(before?.days.map((day) => day.slot)).toEqual(['A', 'B', 'C']);
    expect(before?.all.map((day) => day.slot)).toContain('D');
  });

  it('never points at an unplaced workout as what to do next', async () => {
    await db.blockExercise.put(entry('D', 'bb_overhead_press'));
    await db.session.bulkPut([
      { id: 's1', blockId: BLOCK, daySlot: 'A', date: dateOf(1) },
      { id: 's2', blockId: BLOCK, daySlot: 'B', date: TODAY },
      { id: 's3', blockId: BLOCK, daySlot: 'C', date: dateOf(4) },
    ]);
    const plan = await readWeekPlan();
    expect(plan?.next).toBeUndefined();
  });
});
