// @vitest-environment jsdom

/*
 * Sync, driven through the card that runs it.
 *
 * The last flow in the app with no automated coverage, and the one with the
 * worst failure mode: everything else here can be wrong and cost you a
 * workout, this can be wrong and cost you a history. `workoutSync.test.ts`
 * already pins the reconciliation rules against a fake store; what it cannot
 * see is whether the screen wires the real thing up — whether pressing Sync
 * now actually snapshots this device, whether a restore lands in the database
 * the screens read, and whether a sync that saves nothing says so.
 *
 * Only the network boundary is faked. `WeightSource` and `WorkoutStore` are
 * the seams the app already defines for it, so everything above them —
 * snapshot, reconcile, apply, and the card itself — is the real code.
 */

import '../test/dom';

import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* --- the fake cloud -------------------------------------------------------- */

interface Row {
  data: unknown;
  updatedAt?: string;
}

const cloud: {
  userId?: string;
  workout?: Row;
  nutrition?: unknown;
  writes: unknown[];
  failWith?: string;
  signedInEmail?: string;
} = { writes: [] };

vi.mock('../lib/supabaseSource', () => ({
  isSupabaseConfigured: () => true,
  // Truthy: nutritionSync only checks that a client exists before using the
  // seams below, which is where the fake takes over.
  getSupabase: async () => ({}) as unknown,
  supabaseSource: () => ({
    userId: async () => cloud.userId,
    nutritionData: async () => cloud.nutrition,
  }),
  supabaseWorkoutStore: () => ({
    userId: async () => cloud.userId,
    read: async () => {
      if (cloud.failWith) throw new Error(cloud.failWith);
      return cloud.workout;
    },
    write: async (_id: string, snapshot: unknown) => {
      if (cloud.failWith) throw new Error(cloud.failWith);
      cloud.writes.push(snapshot);
      const at = new Date().toISOString();
      cloud.workout = { data: snapshot, updatedAt: at };
      return at;
    },
  }),
  currentSession: async () => ({
    signedIn: cloud.signedInEmail !== undefined,
    email: cloud.signedInEmail,
  }),
  sendCode: async () => undefined,
  verifySignIn: async (email: string) => {
    cloud.signedInEmail = email;
    cloud.userId = 'user_1';
    return undefined;
  },
  signOut: async () => {
    cloud.signedInEmail = undefined;
    cloud.userId = undefined;
  },
}));

import { db } from '../db/db';
import {
  forgetSyncReport,
  markDirty,
  snapshotWorkout,
  type WorkoutSnapshot,
} from '../lib/workoutSync';
import { draw, user } from '../test/dom';
import { NutritionSync } from './NutritionSync';

beforeEach(() => {
  /* The last outcome is module state, so without this the card opens showing
     the previous test's warning. */
  forgetSyncReport();
  cloud.userId = 'user_1';
  cloud.signedInEmail = 'lifter@example.com';
  cloud.workout = undefined;
  cloud.nutrition = undefined;
  cloud.writes = [];
  cloud.failWith = undefined;
});

/** One logged session, the thing that must never be lost. */
async function logSession(id: string, date: string) {
  await db.session.put({ id, blockId: 'block_1', daySlot: 'A', date, daySlotName: 'Lower' });
  await db.setLog.bulkPut(
    [1, 2, 3].map((setNo) => ({
      sessionId: id,
      exerciseId: 'bb_back_squat',
      setNo,
      weightKg: 90,
      reps: 5,
    })),
  );
}

/** A cloud row holding one session, stamped later than anything local. */
async function cloudHolds(sessionId: string, date: string): Promise<WorkoutSnapshot> {
  await logSession(sessionId, date);
  const snapshot = await snapshotWorkout();
  // Taken from a device that then forgets it: the state a fresh install is in.
  await db.session.clear();
  await db.setLog.clear();
  cloud.workout = { data: snapshot, updatedAt: '2099-01-01T00:00:00.000Z' };
  return snapshot;
}

async function openCard() {
  const view = draw(<NutritionSync />);
  const card = (await screen.findByRole('heading', { name: 'Cloud sync' })).closest('section');
  if (!card) throw new Error('the sync card has no section');
  return { card, ui: user(), view };
}

const syncNow = async (card: HTMLElement, ui: ReturnType<typeof user>) =>
  ui.click(await within(card).findByRole('button', { name: 'Sync now' }));

describe('signing in', () => {
  it('asks for an email until there is a session', async () => {
    cloud.signedInEmail = undefined;
    cloud.userId = undefined;
    const { card, ui } = await openCard();

    const email = await within(card).findByLabelText('Email');
    await ui.type(email, 'lifter@example.com');
    await ui.click(within(card).getByRole('button', { name: 'Send code' }));

    /* The code field only exists once a code has been sent: offering it first
       invites pasting a code from a previous email. */
    const code = await within(card).findByLabelText(/^Code/);
    await ui.type(code, '123456');
    await ui.click(within(card).getByRole('button', { name: 'Verify and sync' }));

    /* Asserted on the control that only exists once signed in, rather than on
       the email: the collapsed summary prints the account too, so matching the
       address now finds it twice. */
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Sync now' })).toBeTruthy(),
    );
  });
});

describe('saving this device to the cloud', () => {
  it('sends what is actually on the device, not an empty snapshot', async () => {
    await logSession('s1', '2026-02-02');
    markDirty();
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    await waitFor(() => expect(cloud.writes).toHaveLength(1));
    const sent = cloud.writes[0] as WorkoutSnapshot;
    expect(sent.session.map((row) => row.id)).toEqual(['s1']);
    expect(sent.setLog).toHaveLength(3);
    // And it says what went, because a silent success is how "nothing has
    // saved since March" hid for weeks.
    await waitFor(() =>
      expect(within(card).getByText(/Training data saved — 1 sessions, 3 set logs/)).toBeTruthy(),
    );
  });

  it('does not send the seeded exercise table', async () => {
    await logSession('s1', '2026-02-02');
    markDirty();
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    await waitFor(() => expect(cloud.writes).toHaveLength(1));
    /* 73 rows that are identical on every device and rebuilt on install. In a
       per-user JSONB row they are pure weight. */
    expect(Object.keys(cloud.writes[0] as object)).not.toContain('exercise');
  });
});

describe('restoring onto a device with nothing on it', () => {
  it('lands the cloud copy in the database the screens read', async () => {
    await cloudHolds('cloud_1', '2026-01-20');
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    /* The assertion that matters is the database, not the message: a restore
       that reports success and writes nothing is the exact failure this
       feature exists to prevent. */
    await waitFor(async () => {
      expect((await db.session.toArray()).map((row) => row.id)).toEqual(['cloud_1']);
    });
    await waitFor(() =>
      expect(within(card).getByText(/restored from the cloud — 1 sessions/)).toBeTruthy(),
    );
    expect(cloud.writes).toEqual([]);
  });
});

describe('when both sides have moved', () => {
  it('keeps the session logged here and overwrites the cloud with it', async () => {
    /* The worst possible failure: a session logged in the garage, replaced by
       a cloud copy that happens to carry a later stamp because a laptop
       synced afterwards. Local work wins, always. */
    cloud.workout = {
      data: { version: 1, at: '2099-01-01T00:00:00.000Z', session: [], setLog: [], block: [], blockExercise: [], settings: [], golfDay: [] },
      updatedAt: '2099-01-01T00:00:00.000Z',
    };
    await logSession('garage', '2026-03-03');
    markDirty();
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    await waitFor(() => expect(cloud.writes).toHaveLength(1));
    expect((await db.session.toArray()).map((row) => row.id)).toEqual(['garage']);
    expect((cloud.writes[0] as WorkoutSnapshot).session.map((row) => row.id)).toEqual(['garage']);
  });
});

describe('when nothing can be saved', () => {
  it('names the missing table as a setup step rather than a failure', async () => {
    cloud.failWith = 'relation "public.workout_data" does not exist';
    await logSession('s1', '2026-02-02');
    markDirty();
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    /* One SQL file, run once. Reported as the instruction it is, because the
       person reading it is holding a phone in a garage. */
    await waitFor(() =>
      expect(within(card).getByText(/workout_data.sql/)).toBeTruthy(),
    );
  });

  it('says so when the device is signed out, instead of looking idle', async () => {
    cloud.userId = undefined;
    await logSession('s1', '2026-02-02');
    markDirty();
    const { card, ui } = await openCard();

    await syncNow(card, ui);

    await waitFor(() =>
      expect(within(card).getByText(/Nothing is being saved/)).toBeTruthy(),
    );
    expect(cloud.writes).toEqual([]);
  });

  it('shows unsaved local changes while they are still only here', async () => {
    await logSession('s1', '2026-02-02');
    markDirty();
    const { card } = await openCard();
    await waitFor(() =>
      expect(within(card).getByText(/have not reached the cloud yet/)).toBeTruthy(),
    );
  });
});
