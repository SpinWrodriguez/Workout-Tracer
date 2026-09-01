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

/** Schedules carry an intensity now, so build them rather than inline them. */
const day = (a: number, b?: number) => ({
  A: { weekday: a as 1, intensity: 'heavy' as const },
  ...(b === undefined ? {} : { B: { weekday: b as 1, intensity: 'heavy' as const } }),
});

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
    await writeSchedule('block_1', { A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } });
    expect((await readSchedules()).block_1).toEqual({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } });
  });

  it('keeps schedules for other blocks when one is rewritten', async () => {
    await writeSchedule('block_1', { A: { weekday: 1, intensity: 'heavy' } });
    await writeSchedule('block_2', { A: { weekday: 3, intensity: 'heavy' } });
    await writeSchedule('block_1', { A: { weekday: 2, intensity: 'heavy' }, B: { weekday: 5, intensity: 'heavy' } });
    const all = await readSchedules();
    expect(all.block_1).toEqual({ A: { weekday: 2, intensity: 'heavy' }, B: { weekday: 5, intensity: 'heavy' } });
    expect(all.block_2).toEqual({ A: { weekday: 3, intensity: 'heavy' } });
  });

  it('reads a pre-intensity schedule as a heavy day', () => {
    expect(normaliseSchedule({ b: { A: 1 } })).toEqual({
      b: { A: { weekday: 1, intensity: 'heavy', effortCue: undefined } },
    });
  });

  it('discards junk rather than trusting a hand-edited row', () => {
    expect(normaliseSchedule({ b: { A: 9, B: 'x', C: 3 } })).toEqual({
      b: { C: { weekday: 3, intensity: 'heavy', effortCue: undefined } },
    });
    expect(normaliseSchedule('nope')).toEqual({});
    expect(normaliseSchedule({ b: {} })).toEqual({});
  });

  it('resolves the slot programmed for a date', () => {
    const schedule = day(1, 4);
    expect(slotForDate(schedule, MON)).toBe('A');
    expect(slotForDate(schedule, THU)).toBe('B');
    expect(slotForDate(schedule, TUE)).toBeUndefined();
  });

  it('names the soonest slot when today has none', () => {
    const schedule = day(1, 4);
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
      Object.fromEntries(
        generated.days.map((d) => [d.slot, { weekday: d.weekday, intensity: d.intensity }]),
      ),
    );

    const plan = await readBlockPlan();
    expect(plan).toBeDefined();
    for (const day of generated.days) {
      expect(plan?.schedule[day.slot]?.weekday).toBe(day.weekday);
      expect(plan?.schedule[day.slot]?.intensity).toBe(day.intensity);
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
    await writeSchedule('block_1', { A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } });

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
    expect(slotsByWeekday({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } })).toEqual({ 1: 'A', 4: 'B' });
    expect(slotsByWeekday({})).toEqual({});
  });

  it('moves a slot to a free weekday', () => {
    expect(assignSlot({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } }, 'B', 5)).toEqual({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 5, intensity: 'heavy' } });
  });

  it('swaps when the target weekday is already taken', () => {
    // Dropping A onto Thursday must not leave two sessions on one day.
    expect(assignSlot({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } }, 'A', 4)).toEqual({ A: { weekday: 4, intensity: 'heavy' }, B: { weekday: 1, intensity: 'heavy' } });
  });

  it('unschedules the displaced slot when the mover had no day', () => {
    expect(assignSlot({ B: { weekday: 4, intensity: 'heavy' } }, 'A', 4)).toEqual({ A: { weekday: 4, intensity: 'heavy' } });
  });

  it('clears a slot without touching the others', () => {
    expect(assignSlot({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } }, 'A', undefined)).toEqual({ B: { weekday: 4, intensity: 'heavy' } });
  });

  it('is a no-op when a slot is dropped back on its own day', () => {
    expect(assignSlot({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } }, 'A', 1)).toEqual({ A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } });
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
    await writeSchedule('block_1', { A: { weekday: 1, intensity: 'heavy' }, B: { weekday: 4, intensity: 'heavy' } });
    await clearDaySlot('block_1', 'A');
    expect(entriesForSlot(await db.blockExercise.toArray(), 'A')).toEqual([]);
    expect(entriesForSlot(await db.blockExercise.toArray(), 'B')).toHaveLength(1);
    expect((await readSchedules()).block_1).toEqual({ B: { weekday: 4, intensity: 'heavy' } });
  });
});

describe('remembering which days came from the generator', () => {
  it('keeps the flag across a round trip and leaves hand-built days without it', () => {
    const schedule = normaliseSchedule({
      b: {
        A: { weekday: 1, intensity: 'heavy', generated: true },
        B: { weekday: 2, intensity: 'heavy' },
      },
    });
    expect(schedule.b?.A?.generated).toBe(true);
    // Absent, not false: shuffling is offered only where it costs nothing.
    expect(schedule.b?.B?.generated).toBeUndefined();
  });
});
