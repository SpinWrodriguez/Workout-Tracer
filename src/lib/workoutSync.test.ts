import 'fake-indexeddb/auto';

/*
 * The sync state lives in localStorage, which node does not have. A shim keeps
 * these tests in the node environment rather than pulling in jsdom for four
 * string operations.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import type { Session, SetLog } from '../db/types';
import {
  applyWorkout,
  isDirty,
  markDirty,
  readSnapshot,
  snapshotWorkout,
  syncWorkout,
  withSyncSuspended,
  type WorkoutSnapshot,
  type WorkoutStore,
} from './workoutSync';

/** A store standing in for the Supabase row, so nothing needs a network. */
function fakeStore(initial?: { data: unknown; updatedAt?: string }) {
  const state = { row: initial, writes: 0 };
  const store: WorkoutStore = {
    userId: async () => 'user-1',
    read: async () => state.row,
    write: async (_userId, data) => {
      state.writes += 1;
      // A server clock deliberately ahead of the client, which is what caught
      // the app recording its own stamp instead of the returned one.
      const updatedAt = new Date(Date.now() + state.writes * 60_000).toISOString();
      state.row = { data, updatedAt };
      return updatedAt;
    },
  };
  return { store, state };
}

async function logSession(id: string, date = '2026-08-30') {
  const session: Session = { id, blockId: 'block_1', daySlot: 'A', date, durationMin: 40 };
  const log: SetLog = {
    sessionId: id,
    exerciseId: 'bb_back_squat',
    setNo: 1,
    weightKg: 60,
    effectiveKg: 60,
    reps: 8,
  };
  await db.session.put(session);
  await db.setLog.put(log);
}

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDatabase();
});

describe('what travels', () => {
  it('carries the training data but not the seeded exercise table', async () => {
    await logSession('s1');
    const snapshot = await snapshotWorkout();
    expect(snapshot.session).toHaveLength(1);
    expect(snapshot.setLog).toHaveLength(1);
    // Exercises come from the build, so a copy in the cloud would only go stale.
    expect(Object.keys(snapshot)).not.toContain('exercise');
  });

  it('leaves the last-weigh-in-sync stamp behind', async () => {
    await db.settings.bulkPut([
      { key: 'lastWeightSync', value: '2026-09-01T00:00:00Z' },
      { key: 'inventory', value: { plates: [] } },
    ]);
    const keys = (await snapshotWorkout()).settings.map((row) => row.key);
    expect(keys).toContain('inventory');
    expect(keys).not.toContain('lastWeightSync');
  });

  it('reads a snapshot back, and rejects a row that never held one', () => {
    expect(readSnapshot({ block: [], session: [], setLog: [] })).toBeTruthy();
    for (const value of [undefined, null, {}, 'nope', 42, []]) {
      expect(readSnapshot(value)).toBeUndefined();
    }
  });
});

describe('restoring', () => {
  it('replaces rather than merges, so a deletion elsewhere propagates', async () => {
    await logSession('s1');
    await logSession('s2');
    const snapshot = await snapshotWorkout();

    // Another device deleted s2 and pushed.
    const withoutS2: WorkoutSnapshot = {
      ...snapshot,
      session: snapshot.session.filter((s) => s.id !== 's2'),
      setLog: snapshot.setLog.filter((l) => l.sessionId !== 's2'),
    };
    await applyWorkout(withoutS2);

    expect(await db.session.count()).toBe(1);
    expect(await db.session.get('s2')).toBeUndefined();
  });

  it('does not mark the device dirty, because a restore is not an edit', async () => {
    await logSession('s1');
    const snapshot = await snapshotWorkout();
    localStorage.clear();
    await applyWorkout(snapshot);
    expect(isDirty()).toBe(false);
  });

  it('keeps the device local weigh-in stamp across a restore', async () => {
    await db.settings.put({ key: 'lastWeightSync', value: 'mine' });
    await applyWorkout({
      version: 1,
      block: [],
      blockExercise: [],
      session: [],
      setLog: [],
      settings: [{ key: 'inventory', value: { plates: [] } }],
      golfDay: [],
    });
    expect((await db.settings.get('lastWeightSync'))?.value).toBe('mine');
    expect(await db.settings.get('inventory')).toBeDefined();
  });
});

describe('reconciling', () => {
  it('pushes when the cloud row is empty', async () => {
    await logSession('s1');
    markDirty();
    const { store, state } = fakeStore();
    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pushed');
    expect(state.writes).toBe(1);
    expect(isDirty()).toBe(false);
  });

  it('never lets unpushed local work be overwritten', async () => {
    const { store, state } = fakeStore();
    await logSession('cloud-only');
    await syncWorkout(store); // seed the cloud
    await db.session.clear();
    await db.setLog.clear();

    // A session logged offline, while the cloud copy moved on.
    await logSession('logged-in-the-garage');
    markDirty();
    state.row = { data: state.row?.data, updatedAt: '2099-01-01T00:00:00.000Z' };

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pushed');
    expect(await db.session.get('logged-in-the-garage')).toBeDefined();
  });

  it('pulls onto a fresh device rather than pushing its empty state over the top', async () => {
    // Another device has a history.
    await logSession('s1');
    const { store } = fakeStore({
      data: await snapshotWorkout(),
      updatedAt: '2099-01-01T00:00:00.000Z',
    });

    // This one has only the starter block, and the seed marked it dirty.
    await db.session.clear();
    await db.setLog.clear();
    markDirty();

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pulled');
    expect(await db.session.get('s1')).toBeDefined();
  });

  it('does nothing when neither side has moved', async () => {
    await logSession('s1');
    const { store, state } = fakeStore();
    await syncWorkout(store);
    const writes = state.writes;

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('up-to-date');
    expect(state.writes).toBe(writes);
  });

  it('takes the cloud copy when another device pushed after this one', async () => {
    await logSession('s1');
    const { store, state } = fakeStore();
    await syncWorkout(store);

    const remote = (await snapshotWorkout()) as WorkoutSnapshot;
    remote.session = [...remote.session, { id: 's-from-laptop', blockId: 'block_1', daySlot: 'B', date: '2026-08-31' }];
    state.row = { data: remote, updatedAt: '2099-01-01T00:00:00.000Z' };

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pulled');
    expect(await db.session.get('s-from-laptop')).toBeDefined();
  });

  it('says so rather than throwing when nobody is signed in', async () => {
    const { store } = fakeStore();
    const report = await syncWorkout({ ...store, userId: async () => undefined });
    expect(report.outcome).toBe('needs-sign-in');
  });

  it('names a missing table as setup rather than failure', async () => {
    const { store } = fakeStore();
    const report = await syncWorkout({
      ...store,
      read: async () => {
        throw new Error('relation "public.workout_data" does not exist');
      },
    });
    expect(report.outcome).toBe('no-table');
  });

  it('survives the network being down and stays dirty for the next attempt', async () => {
    await logSession('s1');
    markDirty();
    const { store } = fakeStore();
    const report = await syncWorkout({
      ...store,
      read: async () => {
        throw new Error('Failed to fetch');
      },
    });
    expect(report.outcome).toBe('failed');
    expect(isDirty()).toBe(true);
  });
});

describe('suspension', () => {
  it('ignores writes made while restoring or seeding', async () => {
    localStorage.clear();
    await withSyncSuspended(async () => {
      markDirty();
      await db.session.put({ id: 'x', blockId: 'b', daySlot: 'A', date: '2026-08-30' });
    });
    expect(isDirty()).toBe(false);
  });

  it('is not left suspended when the work throws', async () => {
    await expect(
      withSyncSuspended(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    markDirty();
    expect(isDirty()).toBe(true);
  });

  it('seeding a fresh database leaves it clean', async () => {
    localStorage.clear();
    await db.block.clear();
    await seedDatabase();
    expect(isDirty()).toBe(false);
    expect(await db.block.count()).toBe(1);
  });
});

describe('the store contract', () => {
  it('writes the row under the signed-in user id', async () => {
    await logSession('s1');
    markDirty();
    const write = vi.fn<WorkoutStore['write']>(async () => '2026-09-01T00:00:00.000Z');
    await syncWorkout({ userId: async () => 'user-9', read: async () => undefined, write });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('user-9');
  });
});

/*
 * The empty-local guard exists to stop a fresh install pushing its seeded
 * starter block over a real history. It used to ask only "have any sessions
 * been logged", which is not the same question: a week spent building a
 * program is real work that has logged nothing yet, and treating it as empty
 * meant those edits never pushed AND could be overwritten by a pull.
 */
describe('a program built but not yet trained', () => {
  async function buildProgram() {
    await db.blockExercise.bulkPut([
      {
        blockId: 'block_1',
        exerciseId: 'bb_back_squat',
        daySlot: 'A',
        targetSets: 3,
        repRangeLow: 8,
        repRangeHigh: 10,
        order: 0,
      },
    ]);
    await db.settings.put({
      key: 'blockSchedule',
      value: { block_1: { A: { weekday: 1, intensity: 'heavy', name: 'Lower Push' } } },
    });
  }

  it('pushes the program even though nothing has been logged against it', async () => {
    await buildProgram();
    markDirty();
    const { store, state } = fakeStore({ data: {}, updatedAt: '2099-01-01T00:00:00.000Z' });

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pushed');
    expect(state.writes).toBe(1);
  });

  it('is not overwritten by an older cloud copy that happens to be stamped later', async () => {
    // The cloud holds a previous block; this device has just been rebuilt.
    const { store, state } = fakeStore();
    await logSession('old');
    await syncWorkout(store);
    await db.session.clear();
    await db.setLog.clear();
    await db.blockExercise.clear();

    await buildProgram();
    markDirty();
    state.row = { data: state.row?.data, updatedAt: '2099-01-01T00:00:00.000Z' };

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pushed');
    expect((await db.settings.get('blockSchedule'))?.value).toMatchObject({
      block_1: { A: { name: 'Lower Push' } },
    });
    expect(await db.blockExercise.count()).toBe(1);
  });

  it('still lets a genuinely fresh install take the cloud copy', async () => {
    // Nothing but the seeded starter block: no program, no history.
    await db.blockExercise.clear();
    await logSession('from-the-other-device');
    const { store } = fakeStore({
      data: await snapshotWorkout(),
      updatedAt: '2099-01-01T00:00:00.000Z',
    });
    await db.session.clear();
    await db.setLog.clear();
    await db.blockExercise.clear();
    markDirty();

    const report = await syncWorkout(store);
    expect(report.outcome).toBe('pulled');
    expect(await db.session.get('from-the-other-device')).toBeDefined();
  });
});
