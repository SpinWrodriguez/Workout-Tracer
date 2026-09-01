import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise } from '../db/types';
import { generateBlock } from './blockBuilder';
import {
  addBlockExercise,
  assignSlot,
  clearDaySlot,
  daysUntilWeekday,
  draftFromPlan,
  entriesForSlot,
  nextSlot,
  normaliseSchedule,
  readBlockPlan,
  readSchedules,
  moveBlockExercise,
  removeBlockExercise,
  slotForDate,
  slotsByWeekday,
  updateBlockExercise,
  writeSchedule,
} from './program';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

/* Aug/Sep 2026: Mon 31 Aug, Tue 1, Wed 2, Thu 3, Fri 4, Sat 5, Sun 6. */
const MON = '2026-08-31';
const TUE = '2026-09-01';
const THU = '2026-09-03';
const SAT = '2026-09-05';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDatabase();
});

describe('block schedule', () => {
  it('round-trips the slot to weekday map', async () => {
    await writeSchedule('block_1', { A: 1, B: 4 });
    expect((await readSchedules()).block_1).toEqual({ A: 1, B: 4 });
  });

  it('keeps schedules for other blocks when one is rewritten', async () => {
    await writeSchedule('block_1', { A: 1 });
    await writeSchedule('block_2', { A: 3 });
    await writeSchedule('block_1', { A: 2, B: 5 });
    const all = await readSchedules();
    expect(all.block_1).toEqual({ A: 2, B: 5 });
    expect(all.block_2).toEqual({ A: 3 });
  });

  it('discards junk rather than trusting a hand-edited row', () => {
    expect(normaliseSchedule({ b: { A: 9, B: 'x', C: 3 } })).toEqual({ b: { C: 3 } });
    expect(normaliseSchedule('nope')).toEqual({});
    expect(normaliseSchedule({ b: {} })).toEqual({});
  });

  it('resolves the slot programmed for a date', () => {
    const schedule = { A: 1 as const, B: 4 as const };
    expect(slotForDate(schedule, MON)).toBe('A');
    expect(slotForDate(schedule, THU)).toBe('B');
    expect(slotForDate(schedule, TUE)).toBeUndefined();
  });

  it('names the soonest slot when today has none', () => {
    const schedule = { A: 1 as const, B: 4 as const };
    expect(nextSlot(schedule, TUE)).toMatchObject({ slot: 'B', inDays: 2 });
    // On a programmed day the soonest is today itself.
    expect(nextSlot(schedule, MON)).toMatchObject({ slot: 'A', inDays: 0 });
    // Wraps around the week rather than running off the end of it.
    expect(nextSlot(schedule, SAT)).toMatchObject({ slot: 'A', inDays: 2 });
  });

  it('measures the wait to a weekday around the week', () => {
    expect(daysUntilWeekday(MON, 1)).toBe(0);
    expect(daysUntilWeekday(MON, 4)).toBe(3);
    expect(daysUntilWeekday(SAT, 1)).toBe(2);
  });
});

describe('a generated block survives the round trip to a session', () => {
  it('keeps the weekday assignment the builder chose', async () => {
    const generated = generateBlock({
      blockId: 'block_1',
      exercises: EXERCISES,
      focusMuscles: ['lats', 'quads'],
      sessionsPerWeek: 2,
      golfWeekdays: [6],
    });

    await db.blockExercise.bulkPut(generated.days.flatMap((d) => d.exercises));
    await writeSchedule(
      'block_1',
      Object.fromEntries(generated.days.map((d) => [d.slot, d.weekday])),
    );

    const plan = await readBlockPlan();
    expect(plan).toBeDefined();
    for (const day of generated.days) {
      expect(plan?.schedule[day.slot]).toBe(day.weekday);
    }

    // The whole point: a date now resolves to the day the builder placed.
    const first = generated.days[0];
    expect(first).toBeDefined();
    const dateOfFirst = ['', MON, TUE, '2026-09-02', THU, '2026-09-04', SAT, '2026-09-06'][
      first?.weekday as number
    ] as string;
    expect(slotForDate(plan?.schedule ?? {}, dateOfFirst)).toBe(first?.slot);
  });

  it('builds a session pre-loaded with the day, in order, at target sets', async () => {
    const entries: BlockExercise[] = [
      { blockId: 'block_1', exerciseId: 'bb_bench_press', daySlot: 'A', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 1 },
      { blockId: 'block_1', exerciseId: 'bb_rdl', daySlot: 'A', targetSets: 4, repRangeLow: 8, repRangeHigh: 10, order: 0 },
      { blockId: 'block_1', exerciseId: 'bb_back_squat', daySlot: 'B', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 0 },
    ];
    await db.blockExercise.bulkPut(entries);
    await writeSchedule('block_1', { A: 1, B: 4 });

    const plan = await readBlockPlan();
    const draft = draftFromPlan({ plan: plan!, slot: 'A', exercisesById: byId, date: MON });

    expect(draft.daySlot).toBe('A');
    expect(draft.blockId).toBe('block_1');
    // Ordered by `order`, so the hinge leads as the builder intended.
    expect(draft.exercises.map((e) => e.exerciseId)).toEqual(['bb_rdl', 'bb_bench_press']);
    expect(draft.exercises[0]?.sets).toHaveLength(4);
    expect(draft.exercises[1]?.sets).toHaveLength(3);
    // Sets start empty — the progression suggestion decides the load.
    expect(draft.exercises[0]?.sets[0]).toMatchObject({ setNo: 1, done: false });
    expect(draft.exercises[0]?.sets[0]?.weightKg).toBeUndefined();
  });

  it('skips programmed ids that are not in the exercise table', async () => {
    await db.blockExercise.bulkPut([
      { blockId: 'block_1', exerciseId: 'ghost_lift', daySlot: 'A', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 0 },
      { blockId: 'block_1', exerciseId: 'bb_back_squat', daySlot: 'A', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 1 },
    ]);
    const plan = await readBlockPlan();
    const draft = draftFromPlan({ plan: plan!, slot: 'A', exercisesById: byId, date: MON });
    expect(draft.exercises.map((e) => e.exerciseId)).toEqual(['bb_back_squat']);
  });

  it('returns nothing for a slot with no programmed work', async () => {
    await db.blockExercise.bulkPut([
      { blockId: 'block_1', exerciseId: 'bb_back_squat', daySlot: 'A', targetSets: 3, repRangeLow: 8, repRangeHigh: 10, order: 0 },
    ]);
    const plan = await readBlockPlan();
    expect(entriesForSlot(plan?.entries ?? [], 'C')).toEqual([]);
    expect(draftFromPlan({ plan: plan!, slot: 'C', exercisesById: byId }).exercises).toEqual([]);
  });
});

describe('editing the week by hand', () => {
  it('inverts the schedule to weekday → slot', () => {
    expect(slotsByWeekday({ A: 1, B: 4 })).toEqual({ 1: 'A', 4: 'B' });
    expect(slotsByWeekday({})).toEqual({});
  });

  it('moves a slot to a free weekday', () => {
    expect(assignSlot({ A: 1, B: 4 }, 'B', 5)).toEqual({ A: 1, B: 5 });
  });

  it('swaps when the target weekday is already taken', () => {
    // Dropping A onto Thursday must not leave two sessions on one day.
    expect(assignSlot({ A: 1, B: 4 }, 'A', 4)).toEqual({ A: 4, B: 1 });
  });

  it('unschedules the displaced slot when the mover had no day', () => {
    expect(assignSlot({ B: 4 }, 'A', 4)).toEqual({ A: 4 });
  });

  it('clears a slot without touching the others', () => {
    expect(assignSlot({ A: 1, B: 4 }, 'A', undefined)).toEqual({ B: 4 });
  });

  it('is a no-op when a slot is dropped back on its own day', () => {
    expect(assignSlot({ A: 1, B: 4 }, 'A', 1)).toEqual({ A: 1, B: 4 });
  });
});

describe('hand-editing a block', () => {
  const base = (slot: 'A' | 'B', exerciseId: string, order: number): BlockExercise => ({
    blockId: 'block_1',
    exerciseId,
    daySlot: slot,
    targetSets: 3,
    repRangeLow: 8,
    repRangeHigh: 10,
    order,
  });

  it('appends a new exercise at the end of its day', async () => {
    await db.blockExercise.put(base('A', 'bb_back_squat', 0));
    await addBlockExercise('block_1', 'A', 'bb_bench_press');
    const rows = entriesForSlot(await db.blockExercise.toArray(), 'A');
    expect(rows.map((r) => r.exerciseId)).toEqual(['bb_back_squat', 'bb_bench_press']);
    expect(rows[1]).toMatchObject({ order: 1, targetSets: 3, repRangeLow: 8, repRangeHigh: 10 });
  });

  it('will not add the same exercise to a day twice', async () => {
    await addBlockExercise('block_1', 'A', 'bb_back_squat');
    await addBlockExercise('block_1', 'A', 'bb_back_squat');
    expect(entriesForSlot(await db.blockExercise.toArray(), 'A')).toHaveLength(1);
  });

  it('closes the gap in order when one is removed', async () => {
    for (const [i, id] of ['bb_back_squat', 'bb_bench_press', 'bb_rdl'].entries()) {
      await db.blockExercise.put(base('A', id, i));
    }
    await removeBlockExercise('block_1', 'A', 'bb_bench_press');
    const rows = entriesForSlot(await db.blockExercise.toArray(), 'A');
    expect(rows.map((r) => r.exerciseId)).toEqual(['bb_back_squat', 'bb_rdl']);
    expect(rows.map((r) => r.order)).toEqual([0, 1]);
  });

  it('reorders within the day and stops at the ends', async () => {
    for (const [i, id] of ['bb_back_squat', 'bb_bench_press', 'bb_rdl'].entries()) {
      await db.blockExercise.put(base('A', id, i));
    }
    await moveBlockExercise('block_1', 'A', 'bb_rdl', -1);
    expect(entriesForSlot(await db.blockExercise.toArray(), 'A').map((r) => r.exerciseId)).toEqual([
      'bb_back_squat',
      'bb_rdl',
      'bb_bench_press',
    ]);
    await moveBlockExercise('block_1', 'A', 'bb_back_squat', -1);
    expect(entriesForSlot(await db.blockExercise.toArray(), 'A')[0]?.exerciseId).toBe(
      'bb_back_squat',
    );
  });

  it('keeps the rep range from crossing over', async () => {
    const entry = base('A', 'bb_back_squat', 0);
    await db.blockExercise.put(entry);
    await updateBlockExercise(entry, { repRangeLow: 14 });
    expect(await db.blockExercise.get(['block_1', 'bb_back_squat', 'A'])).toMatchObject({
      repRangeLow: 14,
      repRangeHigh: 14,
    });
  });

  it('clamps sets to something a human would actually do', async () => {
    const entry = base('A', 'bb_back_squat', 0);
    await db.blockExercise.put(entry);
    await updateBlockExercise(entry, { targetSets: 99 });
    expect((await db.blockExercise.get(['block_1', 'bb_back_squat', 'A']))?.targetSets).toBe(10);
  });

  it('deleting a day clears its exercises and its place in the week', async () => {
    await db.blockExercise.bulkPut([base('A', 'bb_back_squat', 0), base('B', 'bb_bench_press', 0)]);
    await writeSchedule('block_1', { A: 1, B: 4 });
    await clearDaySlot('block_1', 'A');
    expect(entriesForSlot(await db.blockExercise.toArray(), 'A')).toEqual([]);
    expect(entriesForSlot(await db.blockExercise.toArray(), 'B')).toHaveLength(1);
    expect((await readSchedules()).block_1).toEqual({ B: 4 });
  });
});
