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
  type SessionDraft,
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
