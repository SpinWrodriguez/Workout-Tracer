import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import { FREE_DB_IDS } from '../db/seed/freeDbIds';
import { CUES, STEPS } from '../db/seed/cues';
import {
  FREE_DB_IMAGE_BASE,
  fetchAndStoreFreeDb,
  getRecord,
  imageUrl,
  loadImageBlob,
  mappedIds,
  normaliseRecord,
  selectRecords,
} from './freeDb';

const UPSTREAM_IDS = new Set(FREE_DB_IDS);

/* -------------------------------------------------------------------------- */
/*  The check §9 asks for: a hand-mapped id that does not exist upstream fails */
/*  silently at runtime — the exercise just quietly loses its photo. This      */
/*  turns that into a red test, offline, against a snapshot of the real ids.   */
/* -------------------------------------------------------------------------- */

describe('hand-mapped freeDbId values (spec §9)', () => {
  it('all exist upstream', () => {
    const bad = EXERCISES.filter((e) => e.freeDbId && !UPSTREAM_IDS.has(e.freeDbId)).map(
      (e) => `${e.id} → ${e.freeDbId}`,
    );
    expect(bad).toEqual([]);
  });

  it('are unique, so two exercises never share one reference', () => {
    const used = EXERCISES.map((e) => e.freeDbId).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a minority deliberately unmapped, and every one of those has a cue', () => {
    const unmapped = EXERCISES.filter((e) => !e.freeDbId);
    expect(unmapped.length).toBeGreaterThan(0);
    // Most of the table resolves to a photo; the rest are movements with no
    // upstream record at all, checked one by one against all 876 of them.
    expect(unmapped.length).toBeLessThan(EXERCISES.length / 2);
    for (const exercise of unmapped) {
      expect(CUES[exercise.id], `${exercise.id} has no cue`).toBeTruthy();
    }
  });

  it('refuses a record for a DIFFERENT MOVEMENT, however well the name matches', () => {
    /*
     * The rule this replaced said no record from a different implement, and it
     * cost photos it did not need to: the detail sheet labels that block
     * "Reference", prints the upstream name beside it and says the cue wins
     * where the two disagree — so a dumbbell photo of a kickback still shows
     * the arm action, and the sheet is not pretending otherwise.
     *
     * What is still refused is a photo of something else. Upstream has a cable
     * kickback — same implement as ours, wrong exercise: a GLUTE kickback,
     * where ours is triceps. The name is the trap, not the equipment.
     */
    const kickback = EXERCISES.find((e) => e.id === 'cb_kickback');
    expect(kickback?.freeDbId).not.toBe('One-Legged_Cable_Kickback');
    expect(kickback?.freeDbId).toBe('Tricep_Dumbbell_Kickback');
  });

  it('writes out the ones nothing upstream describes, since no photo is coming', () => {
    /*
     * These have no upstream record worth showing and no licensable photo
     * anywhere — Commons carries generic squat and hip images under
     * share-alike terms and nothing for any of them. A one-line cue is not
     * enough to learn a scoop toss from, so they carry their own steps.
     */
    for (const exercise of EXERCISES.filter((e) => !e.freeDbId)) {
      const steps = STEPS[exercise.id];
      expect(steps, `${exercise.id} has no steps`).toBeTruthy();
      expect(steps?.length, `${exercise.id} has too few steps`).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not write out the ones that have a reference, which would go stale', () => {
    // Steps fill the gap; they are not a second description of every exercise.
    for (const id of Object.keys(STEPS)) {
      expect(EXERCISES.find((e) => e.id === id)?.freeDbId, id).toBeUndefined();
    }
  });

  it('gives every exercise a cue, mapped or not — it is the only offline text', () => {
    for (const exercise of EXERCISES) {
      expect(CUES[exercise.id], `${exercise.id} has no cue`).toBeTruthy();
    }
    expect(Object.keys(CUES)).toHaveLength(EXERCISES.length);
  });
});

describe('record normalisation', () => {
  it('allows null on the incomplete upstream fields, and never branches on them', () => {
    const record = normaliseRecord({
      id: 'Barbell_Squat',
      name: 'Barbell Squat',
      primaryMuscles: ['quadriceps'],
      instructions: ['step one'],
      images: ['Barbell_Squat/0.jpg'],
    });
    expect(record).toMatchObject({
      id: 'Barbell_Squat',
      force: null,
      mechanic: null,
      equipment: null,
      secondaryMuscles: [],
      category: null,
    });
  });

  it('rejects a record with no id', () => {
    expect(normaliseRecord({ name: 'Nameless' })).toBeUndefined();
    expect(normaliseRecord('nope')).toBeUndefined();
  });

  it('builds image URLs from the documented prefix', () => {
    expect(imageUrl('Air_Bike/0.jpg')).toBe(`${FREE_DB_IMAGE_BASE}Air_Bike/0.jpg`);
    expect(imageUrl('Air_Bike/0.jpg')).toContain('/main/exercises/');
  });
});

describe('selectRecords', () => {
  const upstream = [
    { id: 'Barbell_Squat', name: 'Barbell Squat', images: [], instructions: [] },
    { id: 'Air_Bike', name: 'Air Bike', images: [], instructions: [] },
    { id: 'Pullups', name: 'Pullups', images: [], instructions: [] },
  ];

  it('keeps only what the curated table asks for', () => {
    const { records } = selectRecords(upstream);
    expect(records.map((r) => r.id).sort()).toEqual(['Barbell_Squat', 'Pullups']);
  });

  it('reports mapped ids upstream does not have', () => {
    const { unknownIds } = selectRecords([{ id: 'Barbell_Squat', name: 'x' }]);
    expect(unknownIds).toContain('Pullups');
    expect(unknownIds).not.toContain('Barbell_Squat');
  });

  it('never uses the upstream equipment field to filter — station is authority', () => {
    const { records } = selectRecords([
      { id: 'Pullups', name: 'Pullups', equipment: 'machine', images: [], instructions: [] },
    ]);
    expect(records).toHaveLength(1);
  });
});

describe('fetch and store', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((t) => t.clear()));
    await seedDatabase();
  });

  const upstream = [
    {
      id: 'Barbell_Squat',
      name: 'Barbell Squat',
      force: 'push',
      level: 'beginner',
      mechanic: 'compound',
      equipment: 'barbell',
      primaryMuscles: ['quadriceps'],
      secondaryMuscles: ['glutes'],
      instructions: ['Set the bar.', 'Squat.'],
      category: 'strength',
      images: ['Barbell_Squat/0.jpg', 'Barbell_Squat/1.jpg'],
    },
    { id: 'Air_Bike', name: 'Air Bike', images: [], instructions: [] },
  ];

  const okFetch = (body: unknown) =>
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;

  it('stores the mapped records and reports the rest', async () => {
    const report = await fetchAndStoreFreeDb(okFetch(upstream));
    expect(report.scanned).toBe(2);
    expect(report.stored).toBe(1);
    expect(report.requested).toBe(mappedIds().length);
    expect(report.unknownIds).not.toContain('Barbell_Squat');
    expect(await db.freeDbCache.count()).toBe(1);
    expect((await getRecord('Barbell_Squat'))?.instructions).toEqual(['Set the bar.', 'Squat.']);
  });

  it('throws a readable error on a bad response', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 503, statusText: 'Unavailable' }));
    await expect(fetchAndStoreFreeDb(bad as unknown as typeof fetch)).rejects.toThrow(/503/);
  });

  it('keeps cached image blobs across a refetch', async () => {
    await fetchAndStoreFreeDb(okFetch(upstream));
    const blob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    const imageFetch = vi.fn(async () => new Response(blob, { status: 200 }));
    await loadImageBlob('Barbell_Squat', 'Barbell_Squat/0.jpg', imageFetch as unknown as typeof fetch);
    expect(imageFetch).toHaveBeenCalledTimes(1);

    await fetchAndStoreFreeDb(okFetch(upstream));
    const row = await db.freeDbCache.get('Barbell_Squat');
    expect(row?.imageBlobs?.['Barbell_Squat/0.jpg']).toBeInstanceOf(Blob);
  });

  it('caches an image on first view and never refetches it', async () => {
    await fetchAndStoreFreeDb(okFetch(upstream));
    const imageFetch = vi.fn(
      async () => new Response(new Blob(['bytes'], { type: 'image/jpeg' }), { status: 200 }),
    ) as unknown as typeof fetch;

    await loadImageBlob('Barbell_Squat', 'Barbell_Squat/0.jpg', imageFetch);
    await loadImageBlob('Barbell_Squat', 'Barbell_Squat/0.jpg', imageFetch);
    expect(imageFetch).toHaveBeenCalledTimes(1);
  });

  it('returns nothing rather than throwing when offline with no cache', async () => {
    await fetchAndStoreFreeDb(okFetch(upstream));
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(
      loadImageBlob('Barbell_Squat', 'Barbell_Squat/9.jpg', failing),
    ).resolves.toBeUndefined();
  });

  it('does not download images during the import — only on view', async () => {
    const fetchImpl = okFetch(upstream);
    await fetchAndStoreFreeDb(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await db.freeDbCache.get('Barbell_Squat'))?.imageBlobs).toBeUndefined();
  });
});
