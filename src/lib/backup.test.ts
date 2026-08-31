import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import { buildBackup, importBackup } from './backup';
import { loadDraft, saveSession, type SessionDraft } from './sessions';

const exercisesById = new Map(EXERCISES.map((e) => [e.id, e]));

/** The real nutrition export shape: v2, date-keyed maps. */
const V2_BACKUP = {
  _version: 2,
  selections: {
    '2026-06-14': { breakfast: ['oats'], dinner: ['chicken'] },
    '2026-06-15': { breakfast: ['eggs'] },
  },
  checked: { '2026-06-14': { breakfast: true } },
  weights: { '2026-06-14': 82.4, '2026-06-15': 82.1, '2026-06-16': 82.2 },
  savedMeals: [{ name: 'Chicken and rice', kcal: 640 }, { name: 'Oats', kcal: 420 }],
  exercise: {
    '2026-06-14': [{ name: 'Golf 18 holes', kcal: 900 }],
    '2026-06-15': [{ name: 'Walk', kcal: 180 }],
  },
  goals: {
    '2026-06-14': { kcal: 2000, protein: 165, carbs: 180, fat: 65, maintenance: 2250 },
  },
};

async function reset() {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDatabase();
}

beforeEach(reset);

describe('v2 → v3 migration (spec §10)', () => {
  it('routes every v2 key to its v3 destination', async () => {
    const report = await importBackup(V2_BACKUP);
    expect(report.sourceVersion).toBe(2);

    // weights → shared.bodyWeight
    const weights = await db.sharedBodyWeight.toArray();
    expect(weights).toHaveLength(3);
    expect(await db.sharedBodyWeight.get('2026-06-15')).toEqual({ date: '2026-06-15', kg: 82.1 });

    // exercise → shared.activity, source 'manual'
    const activity = await db.sharedActivity.toArray();
    expect(activity).toHaveLength(2);
    expect(activity.every((a) => a.source === 'manual')).toBe(true);
    expect(activity.find((a) => a.name === 'Golf 18 holes')?.kcal).toBe(900);

    // goals → shared.goals
    expect((await db.sharedGoals.get('2026-06-14'))?.maintenance).toBe(2250);

    // selections / checked / savedMeals → nutrition.*, unchanged
    expect(await db.nutritionSelections.count()).toBe(2);
    expect(await db.nutritionChecked.count()).toBe(1);
    expect(await db.nutritionSavedMeals.count()).toBe(2);
    expect((await db.nutritionSelections.get('2026-06-14'))?.meals).toEqual(
      V2_BACKUP.selections['2026-06-14'],
    );
  });

  it('is idempotent — re-importing the same file adds nothing', async () => {
    await importBackup(V2_BACKUP);
    const before = {
      bodyWeight: await db.sharedBodyWeight.count(),
      activity: await db.sharedActivity.count(),
      goals: await db.sharedGoals.count(),
      selections: await db.nutritionSelections.count(),
      savedMeals: await db.nutritionSavedMeals.count(),
    };

    await importBackup(V2_BACKUP);
    expect({
      bodyWeight: await db.sharedBodyWeight.count(),
      activity: await db.sharedActivity.count(),
      goals: await db.sharedGoals.count(),
      selections: await db.nutritionSelections.count(),
      savedMeals: await db.nutritionSavedMeals.count(),
    }).toEqual(before);
  });

  it('is additive — importing never deletes what is already there', async () => {
    await db.sharedBodyWeight.put({ date: '2026-01-01', kg: 85 });
    await importBackup(V2_BACKUP);
    expect(await db.sharedBodyWeight.get('2026-01-01')).toEqual({ date: '2026-01-01', kg: 85 });
  });

  it('upserts body weight on date rather than duplicating it', async () => {
    await importBackup(V2_BACKUP);
    await importBackup({ ...V2_BACKUP, weights: { '2026-06-15': 81.8 } });
    expect(await db.sharedBodyWeight.get('2026-06-15')).toEqual({ date: '2026-06-15', kg: 81.8 });
    expect(await db.sharedBodyWeight.count()).toBe(3);
  });

  it('also accepts array-shaped v2 data', async () => {
    await importBackup({
      _version: 2,
      weights: [{ date: '2026-07-01', kg: 81.5 }],
      exercise: [{ date: '2026-07-01', name: 'Golf 9 holes', kcal: 450 }],
      goals: [{ date: '2026-07-01', kcal: 2050 }],
    });
    expect(await db.sharedBodyWeight.get('2026-07-01')).toEqual({ date: '2026-07-01', kg: 81.5 });
    expect(await db.sharedActivity.count()).toBe(1);
    expect((await db.sharedGoals.get('2026-07-01'))?.kcal).toBe(2050);
  });

  it('rejects a file that is not a backup', async () => {
    await expect(importBackup({ hello: 'world' })).rejects.toThrow(/Unrecognised backup/);
    await expect(importBackup('nope')).rejects.toThrow(/not a backup/);
  });
});

describe('v3 envelope round trip', () => {
  it('exports the shape in §10', async () => {
    await importBackup(V2_BACKUP);
    const backup = await buildBackup();
    expect(backup._version).toBe(3);
    expect(backup._exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(Object.keys(backup)).toEqual([
      '_version',
      '_exportedAt',
      'shared',
      'nutrition',
      'workout',
    ]);
    expect(Object.keys(backup.shared)).toEqual(['bodyWeight', 'activity', 'goals']);
    expect(Object.keys(backup.nutrition)).toEqual(['selections', 'checked', 'savedMeals']);
    expect(Object.keys(backup.workout)).toEqual([
      'exercise',
      'block',
      'blockExercise',
      'session',
      'setLog',
      'settings',
      'golfDay',
    ]);
  });

  it('re-imports its own export cleanly and without duplication', async () => {
    await importBackup(V2_BACKUP);
    await saveSession(ACCEPTANCE_SESSION, exercisesById);

    const exported = JSON.parse(JSON.stringify(await buildBackup())) as unknown;
    const before = await snapshot();

    await importBackup(exported);
    expect(await snapshot()).toEqual(before);

    // ...and into an empty database, which is what a restore actually is.
    await Promise.all(db.tables.map((t) => t.clear()));
    await importBackup(exported);
    expect(await snapshot()).toEqual(before);
  });
});

async function snapshot() {
  return {
    bodyWeight: await db.sharedBodyWeight.count(),
    activity: await db.sharedActivity.count(),
    goals: await db.sharedGoals.count(),
    selections: await db.nutritionSelections.count(),
    checked: await db.nutritionChecked.count(),
    savedMeals: await db.nutritionSavedMeals.count(),
    exercise: await db.exercise.count(),
    block: await db.block.count(),
    session: await db.session.count(),
    setLog: await db.setLog.count(),
    settings: await db.settings.count(),
    golfDay: await db.golfDay.count(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Phase 1 acceptance (spec §6): yesterday's session, logged from memory.     */
/* -------------------------------------------------------------------------- */

const ACCEPTANCE_SESSION: SessionDraft = {
  id: 's_acceptance',
  blockId: 'block_1',
  daySlot: 'A',
  date: '2026-08-30',
  durationMin: 42,
  exercises: [
    {
      exerciseId: 'kb_goblet_squat',
      sets: [
        { setNo: 1, weightKg: 20, reps: 10, rir: 3, rpe: 7, done: true },
        { setNo: 2, weightKg: 20, reps: 10, rir: 3, rpe: 7, done: true },
        { setNo: 3, weightKg: 20, reps: 10, rir: 2, rpe: 8, done: true },
      ],
    },
    {
      exerciseId: 'kb_swing',
      sets: [
        { setNo: 1, weightKg: 10, reps: 15, rir: 3, rpe: 7, done: true },
        { setNo: 2, weightKg: 10, reps: 15, rir: 2, rpe: 8, done: true },
      ],
    },
    {
      exerciseId: 'bw_split_squat',
      sets: [
        { setNo: 1, weightKg: 10, reps: 12, rir: 2, rpe: 8, done: true },
        { setNo: 2, weightKg: 10, reps: 12, rir: 1, rpe: 9, done: true },
      ],
    },
    {
      exerciseId: 'bw_pull_up',
      sets: [
        { setNo: 1, reps: 6, rir: 1, rpe: 9, done: true },
        { setNo: 2, reps: 5, rir: 0, rpe: 10, done: true },
      ],
    },
    {
      exerciseId: 'cb_single_arm_row',
      sets: [
        { setNo: 1, weightKg: 50, reps: 12, rir: 2, rpe: 8, done: true },
        { setNo: 2, weightKg: 50, reps: 12, rir: 2, rpe: 8, done: true },
      ],
    },
    {
      exerciseId: 'bb_rdl',
      sets: [
        { setNo: 1, weightKg: 30, reps: 10, rir: 3, rpe: 7, done: true },
        { setNo: 2, weightKg: 30, reps: 10, rir: 3, rpe: 7, done: true },
      ],
    },
  ],
};

describe('Phase 1 acceptance — log yesterday from memory', () => {
  it('stores every set with the loaded and the effective weight', async () => {
    await saveSession(ACCEPTANCE_SESSION, exercisesById);
    const logs = await db.setLog.where('sessionId').equals('s_acceptance').toArray();
    expect(logs).toHaveLength(13);

    const row = (exerciseId: string, setNo: number) =>
      logs.find((l) => l.exerciseId === exerciseId && l.setNo === setNo);

    // The one that matters: cable row logs 50 kg selected, 24.5 kg effective.
    expect(row('cb_single_arm_row', 1)).toMatchObject({ weightKg: 50, effectiveKg: 24.5, reps: 12 });
    expect(row('kb_goblet_squat', 1)).toMatchObject({ weightKg: 20, effectiveKg: 20 });
    expect(row('kb_swing', 1)).toMatchObject({ weightKg: 10, effectiveKg: 10 });
    expect(row('bw_split_squat', 1)).toMatchObject({ weightKg: 10, effectiveKg: 10 });
    expect(row('bb_rdl', 1)).toMatchObject({ weightKg: 30, effectiveKg: 30 });

    // Bodyweight pull-ups carry reps and effort but no load.
    expect(row('bw_pull_up', 1)?.weightKg).toBeUndefined();
    expect(row('bw_pull_up', 1)).toMatchObject({ reps: 6, rir: 1, rpe: 9 });
  });

  it('reopens for editing with the same numbers', async () => {
    await saveSession(ACCEPTANCE_SESSION, exercisesById);
    const draft = await loadDraft('s_acceptance');
    expect(draft?.date).toBe('2026-08-30');
    expect(draft?.durationMin).toBe(42);
    const row = draft?.exercises.find((e) => e.exerciseId === 'cb_single_arm_row');
    expect(row?.sets[0]).toMatchObject({ weightKg: 50, reps: 12, rir: 2 });
  });

  it('replaces rather than appends when an edited session is saved again', async () => {
    await saveSession(ACCEPTANCE_SESSION, exercisesById);
    const edited: SessionDraft = {
      ...ACCEPTANCE_SESSION,
      exercises: ACCEPTANCE_SESSION.exercises.map((e) =>
        e.exerciseId === 'cb_single_arm_row'
          ? { ...e, sets: [{ setNo: 1, weightKg: 55, reps: 10, done: true }] }
          : e,
      ),
    };
    await saveSession(edited, exercisesById);

    const logs = await db.setLog.where('sessionId').equals('s_acceptance').toArray();
    expect(logs.filter((l) => l.exerciseId === 'cb_single_arm_row')).toHaveLength(1);
    expect(logs).toHaveLength(12);
    expect(logs.find((l) => l.exerciseId === 'cb_single_arm_row')?.effectiveKg).toBe(26.95);
  });

  it('drops empty sets and renumbers what is left', async () => {
    await saveSession(
      {
        ...ACCEPTANCE_SESSION,
        id: 's_partial',
        exercises: [
          {
            exerciseId: 'kb_goblet_squat',
            sets: [
              { setNo: 1, weightKg: 20, reps: 10, done: true },
              { setNo: 2, weightKg: 20, done: false },
              { setNo: 3, weightKg: 20, reps: 8, done: true },
            ],
          },
        ],
      },
      exercisesById,
    );
    const logs = await db.setLog.where('sessionId').equals('s_partial').toArray();
    expect(logs.map((l) => l.setNo)).toEqual([1, 2]);
    expect(logs.map((l) => l.reps)).toEqual([10, 8]);
  });

  it('writes the shared activity row the nutrition app reads, labelled an estimate', async () => {
    await db.sharedBodyWeight.put({ date: '2026-08-29', kg: 82 });
    await saveSession(ACCEPTANCE_SESSION, exercisesById);

    const activity = await db.sharedActivity.where('source').equals('workout').toArray();
    expect(activity).toHaveLength(1);
    expect(activity[0]?.date).toBe('2026-08-30');
    expect(activity[0]?.name).toContain('(est.)');
    // 3.5 METs × 3.5 × 82 kg / 200 × 42 min ≈ 211 kcal — deliberately low.
    expect(activity[0]?.kcal).toBe(211);
  });

  it('moves the activity row when the session date changes', async () => {
    await saveSession(ACCEPTANCE_SESSION, exercisesById);
    await saveSession({ ...ACCEPTANCE_SESSION, date: '2026-08-28' }, exercisesById);
    const activity = await db.sharedActivity.where('source').equals('workout').toArray();
    expect(activity).toHaveLength(1);
    expect(activity[0]?.date).toBe('2026-08-28');
  });
});
