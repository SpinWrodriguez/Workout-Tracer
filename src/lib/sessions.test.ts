import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import {
  emptySet,
  loadDraft,
  listSessionSummaries,
  plannedSetsOf,
  saveSession,
  workoutTotals,
  type SessionDraft,
  type SessionSummary,
} from './sessions';

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

/** Three sets of squats with only the first two done, and a bench never started. */
const partial = (): SessionDraft => ({
  id: 's_partial',
  blockId: 'block_1',
  daySlot: 'A',
  date: '2026-09-02',
  durationMin: 35,
  exercises: [
    {
      exerciseId: 'bb_back_squat',
      sets: [
        { setNo: 1, weightKg: 60, reps: 8, done: true },
        { setNo: 2, weightKg: 60, reps: 7, done: true },
        emptySet(3),
      ],
    },
    { exerciseId: 'bb_bench_press', sets: [emptySet(1), emptySet(2), emptySet(3)] },
  ],
});

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDatabase();
});

describe('what a session left behind', () => {
  it('records what every exercise was meant to have, started or not', async () => {
    expect(plannedSetsOf(partial())).toEqual({ bb_back_squat: 3, bb_bench_press: 3 });
  });

  it('keeps the plan on the saved session without inventing set logs', async () => {
    await saveSession(partial(), byId);

    const saved = await db.session.get('s_partial');
    expect(saved?.plannedSets).toEqual({ bb_back_squat: 3, bb_bench_press: 3 });

    /*
     * Two rows, not five. Storing the skipped sets would have counted them as
     * training: setsPerMuscle counts rows rather than reps, so the Levels
     * screen and the AI's weekly shortfall would both have been wrong.
     */
    const logs = await db.setLog.where('sessionId').equals('s_partial').toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.reps > 0)).toBe(true);
  });

  it('summarises as done-of-planned, and names what was never started', async () => {
    await saveSession(partial(), byId);

    const [summary] = await listSessionSummaries();
    expect(summary?.setCount).toBe(2);
    expect(summary?.plannedCount).toBe(6);
    expect(summary?.untouched).toEqual(['bb_bench_press']);
  });

  it('reads a finished session as finished, with nothing left over', async () => {
    const done: SessionDraft = {
      ...partial(),
      id: 's_done',
      exercises: [
        {
          exerciseId: 'bb_back_squat',
          sets: [
            { setNo: 1, weightKg: 60, reps: 8, done: true },
            { setNo: 2, weightKg: 60, reps: 8, done: true },
          ],
        },
      ],
    };
    await saveSession(done, byId);

    const summary = (await listSessionSummaries()).find((row) => row.session.id === 's_done');
    expect(summary?.setCount).toBe(2);
    expect(summary?.plannedCount).toBe(2);
    expect(summary?.untouched).toEqual([]);
  });

  it('reads a session saved before any of this as finished, not as unplanned', async () => {
    await db.session.put({ id: 's_old', blockId: 'block_1', daySlot: 'A', date: '2026-01-05' });
    await db.setLog.put({
      sessionId: 's_old',
      exerciseId: 'bb_back_squat',
      setNo: 1,
      reps: 8,
      weightKg: 60,
      effectiveKg: 60,
    });

    const summary = (await listSessionSummaries()).find((row) => row.session.id === 's_old');
    // No plannedSets on the row, so "1 of 1" rather than "1 of 0".
    expect(summary?.plannedCount).toBe(1);
    expect(summary?.untouched).toEqual([]);
  });

  it('reopens a partial session with the unfinished sets still on it', async () => {
    await saveSession(partial(), byId);

    const draft = await loadDraft('s_partial');
    const squat = draft?.exercises.find((e) => e.exerciseId === 'bb_back_squat');
    const bench = draft?.exercises.find((e) => e.exerciseId === 'bb_bench_press');

    /*
     * Three rows and three rows. Rebuilding from the set logs alone would have
     * shown two and none, and saving again would then have erased the record
     * of what was skipped.
     */
    expect(squat?.sets).toHaveLength(3);
    expect(squat?.sets.filter((set) => set.done)).toHaveLength(2);
    expect(bench?.sets).toHaveLength(3);
    expect(bench?.sets.some((set) => set.done)).toBe(false);
  });
});

describe('what every workout has added up to', () => {
  /*
   * The dashboard counts THIS week, so on a Monday morning it reads zero and
   * the week before it looks like it never happened. This is the all-time view
   * the History screen leads with.
   */
  const summary = (
    date: string,
    name: string | undefined,
    setCount: number,
    volumeKg = 0,
    durationMin = 40,
  ): SessionSummary => ({
    session: {
      id: `s_${date}_${name ?? 'x'}`,
      blockId: 'block_1',
      daySlot: 'A',
      daySlotName: name,
      date,
      durationMin,
    },
    setCount,
    exerciseIds: [],
    volumeKg,
    plannedCount: setCount,
    untouched: [],
  });

  it('adds up every time a workout was done, newest workout first', () => {
    const totals = workoutTotals([
      summary('2026-09-03', 'Golf Rotation Circuit', 12, 1936.9, 42),
      summary('2026-09-01', 'Upper Body', 18, 2531.1, 40),
      summary('2026-08-25', 'Upper Body', 15, 2200, 38),
    ]);

    expect(totals.map((row) => row.name)).toEqual(['Golf Rotation Circuit', 'Upper Body']);
    const upper = totals[1];
    expect(upper?.times).toBe(2);
    expect(upper?.sets).toBe(33);
    expect(upper?.minutes).toBe(78);
    expect(Math.round(upper?.volumeKg ?? 0)).toBe(4731);
    // The span it covers, both ends, so "last done" is never a guess.
    expect(upper?.firstDate).toBe('2026-08-25');
    expect(upper?.lastDate).toBe('2026-09-01');
  });

  it('groups by the name it was logged under, not by the slot', () => {
    /* A slot is reused: delete a workout, build another, and it takes the same
       letter. Two different sessions sharing a row because they landed on the
       same letter would be a lie about both. */
    const totals = workoutTotals([
      summary('2026-09-03', 'Lower Body', 12),
      summary('2026-08-20', 'Golf Prep', 9),
    ]);
    expect(totals).toHaveLength(2);
    expect(totals.map((row) => row.times)).toEqual([1, 1]);
  });

  it('names a session that was never named after its slot', () => {
    const totals = workoutTotals([summary('2026-09-03', undefined, 5)]);
    expect(totals[0]?.name).toBe('Day A');
  });

  it('is empty rather than absent when nothing has been logged', () => {
    expect(workoutTotals([])).toEqual([]);
  });
});
