import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise, SetLog } from '../db/types';
import { DEFAULT_INVENTORY } from './loadable';
import { stalledExerciseIds, usageByExercise } from './coachSignals';

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

const entry = (exerciseId: string): BlockExercise => ({
  blockId: 'block_1',
  exerciseId,
  daySlot: 'A',
  targetSets: 3,
  repRangeLow: 8,
  repRangeHigh: 10,
  order: 0,
});

async function logSession(id: string, date: string, sets: Partial<SetLog>[]) {
  await db.session.put({ id, blockId: 'block_1', daySlot: 'A', date, durationMin: 30 });
  await db.setLog.bulkPut(
    sets.map((set, i) => ({
      sessionId: id,
      exerciseId: 'bb_bench_press',
      setNo: i + 1,
      reps: 8,
      ...set,
    })),
  );
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('usageByExercise', () => {
  it('counts distinct sessions, not sets', () => {
    const logs = [
      { sessionId: 's1', exerciseId: 'bb_bench_press', setNo: 1, reps: 8 },
      { sessionId: 's1', exerciseId: 'bb_bench_press', setNo: 2, reps: 8 },
      { sessionId: 's2', exerciseId: 'bb_bench_press', setNo: 1, reps: 8 },
      { sessionId: 's2', exerciseId: 'cb_face_pull', setNo: 2, reps: 12 },
    ] as SetLog[];
    const usage = usageByExercise(logs);
    // Three bench sets across two sessions is 2 — the coach counts exposures.
    expect(usage.get('bb_bench_press')).toBe(2);
    expect(usage.get('cb_face_pull')).toBe(1);
    expect(usage.get('bb_back_squat')).toBeUndefined();
  });
});

describe('stalledExerciseIds', () => {
  it('flags a lift that missed its range twice at the same weight', async () => {
    /* The progression engine's own hold_review case: short of 8 reps in two
       consecutive sessions with the bar unchanged. */
    await logSession('s1', '2026-09-08', [{ weightKg: 60, effectiveKg: 60, reps: 6 }]);
    await logSession('s2', '2026-09-15', [{ weightKg: 60, effectiveKg: 60, reps: 7 }]);

    const stalled = await stalledExerciseIds([entry('bb_bench_press')], byId, DEFAULT_INVENTORY);
    expect(stalled).toEqual(['bb_bench_press']);
  });

  it('does not flag a lift that is progressing, or one never trained', async () => {
    await logSession('s1', '2026-09-08', [{ weightKg: 60, effectiveKg: 60, reps: 10, rir: 3 }]);

    const stalled = await stalledExerciseIds(
      [entry('bb_bench_press'), entry('bb_back_squat')],
      byId,
      DEFAULT_INVENTORY,
    );
    expect(stalled).toEqual([]);
  });

  it('does not call it a stall when the weight changed between the misses', async () => {
    await logSession('s1', '2026-09-08', [{ weightKg: 55, effectiveKg: 55, reps: 6 }]);
    await logSession('s2', '2026-09-15', [{ weightKg: 60, effectiveKg: 60, reps: 6 }]);

    const stalled = await stalledExerciseIds([entry('bb_bench_press')], byId, DEFAULT_INVENTORY);
    expect(stalled).toEqual([]);
  });
});
