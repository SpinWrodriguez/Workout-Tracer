import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise } from '../db/types';
import { generateDay } from './blockBuilder';
import { LIGHT_DAY_CUE, templateDayFor } from './weekTemplate';
import {
  addBlockExercise,
  assignSlot,
  clearDaySlot,
  daysUntilWeekday,
  draftFromPlan,
  normalisePlan,
  planDate,
  setUsualWeekday,
  entriesForSlot,
  nextSlot,
  normaliseSchedule,
  readBlockPlan,
  readSchedules,
  reorderBlockExercises,
  removeBlockExercise,
  slotForDate,
  slotsByWeekday,
  updateBlockExercise,
  writeSchedule,
  type BlockSchedule,
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

  it("keeps a workout's focus, so regenerating asks for the same thing again", () => {
    expect(
      normaliseSchedule({ b: { A: { weekday: 3, intensity: 'light', focus: 'upper' } } }),
    ).toEqual({
      b: { A: { weekday: 3, intensity: 'light', effortCue: LIGHT_DAY_CUE, focus: 'upper' } },
    });
  });

  it('drops a focus it does not recognise rather than indexing into nothing', () => {
    // A hand-edited row, or one written by a version that spelled these
    // differently. Absent means "infer from the week", which is safe.
    for (const focus of ['legs', '', null, 7, undefined]) {
      const parsed = normaliseSchedule({ b: { A: { weekday: 1, intensity: 'heavy', focus } } });
      expect(parsed.b?.A, String(focus)).not.toHaveProperty('focus');
    }
  });

  it('keeps which draw a day is showing, so a re-roll survives a reload', () => {
    expect(
      normaliseSchedule({ b: { A: { weekday: 1, intensity: 'heavy', variant: 2 } } }).b?.A,
    ).toMatchObject({ variant: 2 });
    // Variant 0 is a real value — the strongest draw — not an absent one.
    expect(
      normaliseSchedule({ b: { A: { weekday: 1, intensity: 'heavy', variant: 0 } } }).b?.A,
    ).toMatchObject({ variant: 0 });
  });

  it('drops a variant that is not a whole count', () => {
    for (const variant of [-1, 1.5, 'two', null]) {
      const parsed = normaliseSchedule({ b: { A: { weekday: 1, intensity: 'heavy', variant } } });
      expect(parsed.b?.A, String(variant)).not.toHaveProperty('variant');
    }
  });

  it('round-trips focus and variant through storage', async () => {
    await writeSchedule('block_1', {
      A: { weekday: 3, intensity: 'light', focus: 'upper', variant: 2 },
    });
    expect((await readSchedules()).block_1?.A).toMatchObject({
      focus: 'upper',
      variant: 2,
    });
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
    /* Built a day at a time, the way the app builds one — generateBlock, which
       chose the days itself, is deleted. What is under test is unchanged: a
       weekday written into the schedule is the weekday a date resolves back
       to. */
    const days = (['A', 'B'] as const).map((slot, index) =>
      generateDay({
        blockId: 'block_1',
        exercises: EXERCISES,
        focusMuscles: ['lats', 'quads'],
        template: templateDayFor({
          slot,
          weekday: (index + 1) as never,
          intensity: 'heavy',
          index,
          golfWeekdays: [6],
        }),
        hasHistory: true,
      }),
    );

    await db.blockExercise.bulkPut(days.flatMap((d) => d.exercises));
    await writeSchedule(
      'block_1',
      Object.fromEntries(days.map((d) => [d.slot, { weekday: d.weekday, intensity: d.intensity }])),
    );

    const plan = await readBlockPlan();
    expect(plan).toBeDefined();
    for (const day of days) {
      expect(plan?.schedule[day.slot]?.weekday).toBe(day.weekday);
      expect(plan?.schedule[day.slot]?.intensity).toBe(day.intensity);
    }

    // The whole point: a date now resolves to the day the builder placed.
    const first = days[0];
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

  it('takes a slot off the calendar without destroying the workout', () => {
    // Losing its day must not lose its name, its effort or its exercises —
    // an unplaced workout is a normal thing to have.
    expect(
      assignSlot(
        { A: { weekday: 1, intensity: 'heavy', name: 'Lower Pull' }, B: { weekday: 4, intensity: 'heavy' } },
        'A',
        undefined,
      ),
    ).toEqual({
      A: { weekday: undefined, intensity: 'heavy', name: 'Lower Pull' },
      B: { weekday: 4, intensity: 'heavy' },
    });
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
    // The hypertrophy range for a horizontal press, not a hardcoded 8-10.
    expect(rows[1]).toMatchObject({ order: 1, targetSets: 3, repRangeLow: 6, repRangeHigh: 12 });
  });

  /*
   * Adding by hand used to stamp 8-10 on everything, so a plank was prescribed
   * eight reps and a Turkish get-up ten — and the rule check then complained
   * about ranges the app had chosen itself.
   */
  it('gives a hand-added exercise a range it can actually take', async () => {
    for (const [id, low, high] of [
      // A hold gets a hold's target, not 'core reps' collapsed onto its bounds.
      ['bw_plank', 30, 60],
      ['kb_turkish_get_up', 1, 5],
      ['cb_lateral_raise', 10, 12],
    ] as const) {
      await addBlockExercise('block_1', 'B', id);
      const row = (await db.blockExercise.toArray()).find(
        (entry) => entry.exerciseId === id && entry.daySlot === 'B',
      );
      const exercise = await db.exercise.get(id);
      expect(row, id).toBeDefined();
      expect(row?.repRangeLow, id).toBeGreaterThanOrEqual(exercise?.repMin ?? 0);
      expect(row?.repRangeHigh, id).toBeLessThanOrEqual(exercise?.repMax ?? 99);
      expect([row?.repRangeLow, row?.repRangeHigh], id).toEqual([low, high]);
    }
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

  it('writes whatever order it is handed', async () => {
    for (const [i, id] of ['bb_back_squat', 'bb_bench_press', 'bb_rdl'].entries()) {
      await db.blockExercise.put(base('A', id, i));
    }
    /* A drag knows where the row landed, not how many places it travelled, so
       this takes the order rather than a direction. */
    await reorderBlockExercises('block_1', 'A', ['bb_rdl', 'bb_back_squat', 'bb_bench_press']);
    const rows = entriesForSlot(await db.blockExercise.toArray(), 'A');
    expect(rows.map((r) => r.exerciseId)).toEqual([
      'bb_rdl',
      'bb_back_squat',
      'bb_bench_press',
    ]);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('cannot lose an exercise the caller forgot to mention', async () => {
    for (const [i, id] of ['bb_back_squat', 'bb_bench_press', 'bb_rdl'].entries()) {
      await db.blockExercise.put(base('A', id, i));
    }
    // A stale list, from a render that predates an added exercise.
    await reorderBlockExercises('block_1', 'A', ['bb_rdl', 'bb_back_squat']);
    expect(
      entriesForSlot(await db.blockExercise.toArray(), 'A').map((r) => r.exerciseId),
    ).toEqual(['bb_rdl', 'bb_back_squat', 'bb_bench_press']);
  });

  it('ignores ids the workout does not hold', async () => {
    await db.blockExercise.put(base('A', 'bb_back_squat', 0));
    await reorderBlockExercises('block_1', 'A', ['not_an_exercise', 'bb_back_squat']);
    expect(
      entriesForSlot(await db.blockExercise.toArray(), 'A').map((r) => r.exerciseId),
    ).toEqual(['bb_back_squat']);
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

/*
 * configFromSchedule was tested here: it read the setup controls — how many
 * sessions, which are heavy — back out of the schedule so the Program screen
 * could show them. Those controls went with the starter week, and the function
 * followed them here: nothing in the app had called it since.
 */

describe('prescribing a hold', () => {
  it('lets a plank run past a minute', async () => {
    await addBlockExercise('block_1', 'A', 'bw_plank');
    const row = (await db.blockExercise.toArray()).find((e) => e.exerciseId === 'bw_plank');
    // A flat cap of 50 was a rep count wearing the wrong hat: on a plank it
    // read as fifty seconds and a two-minute hold was unreachable.
    await updateBlockExercise(row as BlockExercise, { repRangeHigh: 120 });
    const after = (await db.blockExercise.toArray()).find((e) => e.exerciseId === 'bw_plank');
    expect(after?.repRangeHigh).toBe(120);
  });

  it('still holds reps to a sane ceiling', async () => {
    await addBlockExercise('block_1', 'A', 'bb_back_squat');
    const row = (await db.blockExercise.toArray()).find((e) => e.exerciseId === 'bb_back_squat');
    await updateBlockExercise(row as BlockExercise, { repRangeHigh: 400 });
    const after = (await db.blockExercise.toArray()).find((e) => e.exerciseId === 'bb_back_squat');
    expect(after?.repRangeHigh).toBe(50);
  });
});

/*
 * The bug this guards: a workout's weekday used to be its only address, so
 * rescheduling one Wednesday rewrote every Wednesday in the block.
 */
describe('moving a session in one week', () => {
  const schedule: BlockSchedule = {
    A: { weekday: 1, intensity: 'heavy' }, // Mon
    B: { weekday: 3, intensity: 'heavy' }, // Wed
  };
  // A Monday-start week.
  const week = [
    '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
    '2026-09-04', '2026-09-05', '2026-09-06',
  ];

  it('resolves a date from the usual weekday when nothing was planned', () => {
    expect(slotForDate(schedule, '2026-09-02')).toBe('B');
    expect(slotForDate(schedule, '2026-09-03')).toBeUndefined();
  });

  it('leaves every other week alone', () => {
    // Wednesday's session pushed to Thursday, this week only.
    const plan = planDate({}, schedule, week, 'B', '2026-09-03');
    expect(slotForDate(schedule, '2026-09-03', plan)).toBe('B');
    expect(slotForDate(schedule, '2026-09-02', plan)).toBeUndefined();

    // Next Wednesday is untouched: the usual day never moved.
    expect(slotForDate(schedule, '2026-09-09', plan)).toBe('B');
  });

  it('does not shuffle the sessions it was not asked to move', () => {
    const plan = planDate({}, schedule, week, 'B', '2026-09-03');
    expect(slotForDate(schedule, '2026-08-31', plan)).toBe('A');
  });

  it('displaces whatever was already on the target date', () => {
    const plan = planDate({}, schedule, week, 'B', '2026-08-31');
    expect(slotForDate(schedule, '2026-08-31', plan)).toBe('B');
    // A is not silently doubled up on the same day.
    expect(slotForDate(schedule, '2026-09-02', plan)).toBeUndefined();
  });

  it('clears a date without disturbing the pattern', () => {
    const plan = planDate({}, schedule, week, undefined, '2026-09-02');
    expect(slotForDate(schedule, '2026-09-02', plan)).toBeUndefined();
    expect(slotForDate(schedule, '2026-09-09', plan)).toBe('B');
  });

  it('promotes a move to every week only when asked', () => {
    const moved = setUsualWeekday(schedule, 'B', 4);
    expect(slotForDate(moved, '2026-09-03')).toBe('B');
    expect(slotForDate(moved, '2026-09-10')).toBe('B');
    expect(slotForDate(moved, '2026-09-09')).toBeUndefined();
  });

  it('keeps only dates it understands', () => {
    expect(normalisePlan({ b: { '2026-09-02': 'B', nonsense: 'B', '2026-09-03': 'ZZ' } })).toEqual({
      b: { '2026-09-02': 'B' },
    });
    expect(normalisePlan({ b: { '2026-09-02': null } })).toEqual({ b: { '2026-09-02': null } });
  });
});
