import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { extractShared, pullShared, type WeightSource } from './remoteSync';

/*
 * The real `nutrition_data.data` payload, matching freshData() in the
 * nutrition app: { selections, checked, weights, savedMeals, exercise, goals }.
 * Weights are already [{ date, kg }], which is exactly the shared table shape.
 */
const BLOB = {
  selections: { '2026-06-14': { breakfast: ['oats'] } },
  checked: { '2026-06-14': { breakfast: true } },
  weights: [
    { date: '2026-06-14', kg: 82.4 },
    { date: '2026-06-15', kg: 82.1 },
    { date: '2026-06-16', kg: 82.2 },
  ],
  savedMeals: [{ id: 'm1', name: 'Chicken and rice' }],
  exercise: { '2026-06-14': [{ name: 'Golf 18 holes', kcal: 900 }] },
  goals: { kcal: 2000, protein: 165, maintenance: 2250, date: '2026-06-14' },
};

function source(over: Partial<WeightSource> = {}): WeightSource {
  return {
    userId: async () => 'user-1',
    nutritionData: async () => BLOB,
    ...over,
  };
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDatabase();
});

describe('reading the nutrition blob', () => {
  it('pulls the weigh-ins out of the JSONB payload', () => {
    const shared = extractShared(BLOB);
    expect(shared.bodyWeight).toHaveLength(3);
    expect(shared.bodyWeight[1]).toEqual({ date: '2026-06-15', kg: 82.1 });
  });

  it('takes the burn entries and goals riding along in the same payload', () => {
    const shared = extractShared(BLOB);
    expect(shared.activity[0]).toMatchObject({ name: 'Golf 18 holes', kcal: 900 });
    expect(shared.goals[0]?.maintenance).toBe(2250);
  });

  it('survives a row that is empty, null or the wrong shape', () => {
    for (const value of [undefined, null, {}, 'nope', 42, []]) {
      const shared = extractShared(value);
      expect(shared.bodyWeight).toEqual([]);
      expect(shared.activity).toEqual([]);
    }
  });

  it('ignores the nutrition-only sections entirely', () => {
    // Those live in Supabase and this app never reads them.
    expect(Object.keys(extractShared(BLOB))).toEqual(['bodyWeight', 'activity', 'goals']);
  });
});

describe('pullShared', () => {
  it('merges the shared tables and reports what it wrote', async () => {
    const report = await pullShared(source());
    expect(report.ok).toBe(true);
    expect(report.bodyWeight).toBe(3);
    expect(await db.sharedBodyWeight.count()).toBe(3);
    expect(await db.sharedBodyWeight.get('2026-06-15')).toEqual({ date: '2026-06-15', kg: 82.1 });
  });

  it('is idempotent, which matters because it runs on every open', async () => {
    await pullShared(source());
    await pullShared(source());
    await pullShared(source());
    expect(await db.sharedBodyWeight.count()).toBe(3);
    expect(await db.sharedActivity.count()).toBe(1);
  });

  it('takes a newer weight for a date without duplicating it', async () => {
    await pullShared(source());
    await pullShared(
      source({ nutritionData: async () => ({ weights: [{ date: '2026-06-15', kg: 81.6 }] }) }),
    );
    expect(await db.sharedBodyWeight.get('2026-06-15')).toEqual({ date: '2026-06-15', kg: 81.6 });
    expect(await db.sharedBodyWeight.count()).toBe(3);
  });

  it('never deletes anything logged locally', async () => {
    await db.sharedBodyWeight.put({ date: '2026-01-01', kg: 85 });
    await pullShared(source());
    expect(await db.sharedBodyWeight.get('2026-01-01')).toEqual({ date: '2026-01-01', kg: 85 });
  });

  it('says it needs a sign-in rather than failing, when there is no session', async () => {
    const report = await pullShared(source({ userId: async () => undefined }));
    expect(report.ok).toBe(false);
    expect(report.needsSignIn).toBe(true);
    expect(await db.sharedBodyWeight.count()).toBe(0);
  });

  it('reports a query failure without throwing into app startup', async () => {
    const report = await pullShared(
      source({
        nutritionData: async () => {
          throw new Error('JWT expired');
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.error).toBe('JWT expired');
  });

  it('survives being offline', async () => {
    const report = await pullShared(
      source({
        userId: async () => {
          throw new Error('network');
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/local copy/);
  });

  it('leaves the row untouched when the user has no nutrition data yet', async () => {
    const nutritionData = vi.fn(async () => null);
    const report = await pullShared(source({ nutritionData }));
    expect(report.ok).toBe(true);
    expect(report.bodyWeight).toBe(0);
    expect(nutritionData).toHaveBeenCalledWith('user-1');
  });
});
