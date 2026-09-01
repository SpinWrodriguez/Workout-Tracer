import { db } from '../db/db';
import { LAST_SYNC_KEY } from '../db/settings';
import type {
  Block,
  BlockExercise,
  GolfDay,
  Session,
  SetLog,
  SettingRow,
} from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Workout data in Supabase.                                                 */
/*                                                                            */
/*  Mirrors what the nutrition app does: one JSONB row per user, replaced      */
/*  whole, last write wins. IndexedDB is per-origin and cleared by "clear site */
/*  data", so without this the only copy of a training history lives in one    */
/*  browser profile.                                                          */
/*                                                                            */
/*  The exercise table is deliberately NOT synced: it is seeded from code and  */
/*  re-put on every boot, so shipping it would just carry a stale copy of the  */
/*  build. Nor are the shared tables — the nutrition app owns those and they   */
/*  come down the other pipe.                                                 */
/* -------------------------------------------------------------------------- */

export const WORKOUT_TABLE = 'workout_data';
export const SNAPSHOT_VERSION = 1;

export interface WorkoutSnapshot {
  version: number;
  block: Block[];
  blockExercise: BlockExercise[];
  session: Session[];
  setLog: SetLog[];
  settings: SettingRow[];
  golfDay: GolfDay[];
}

export interface WorkoutStore {
  userId(): Promise<string | undefined>;
  read(userId: string): Promise<{ data: unknown; updatedAt?: string } | undefined>;
  /** Returns the stamp the server recorded, so clock skew cannot cause a
      pointless pull on the very next open. */
  write(userId: string, data: WorkoutSnapshot): Promise<string | undefined>;
}

/* --- device-local sync state ---------------------------------------------- */

/*
 * Kept in localStorage rather than the database on purpose: writing it to
 * Dexie would trip the very change hooks that set it, and it describes this
 * browser rather than the training.
 */
const DIRTY_KEY = 'workout-sync-dirty';
const PUSHED_AT_KEY = 'workout-sync-pushed-at';

function readFlag(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeFlag(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked storage only costs an extra push, never data.
  }
}

export function isDirty(): boolean {
  return readFlag(DIRTY_KEY) === '1';
}

export function markDirty(): void {
  if (suspended > 0) return;
  writeFlag(DIRTY_KEY, '1');
}

/*
 * Restoring a snapshot and seeding the exercise table both write to synced
 * tables without being local edits. Suspending around them keeps a fresh
 * install from looking dirty before it has ever synced.
 */
let suspended = 0;

export function isSuspended(): boolean {
  return suspended > 0;
}

export async function withSyncSuspended<T>(work: () => Promise<T>): Promise<T> {
  suspended += 1;
  try {
    return await work();
  } finally {
    suspended -= 1;
  }
}

export function lastPushedAt(): string | undefined {
  return readFlag(PUSHED_AT_KEY);
}

/* -------------------------------------------------------------------------- */
/*  Telling somebody when it did not work.                                    */
/*                                                                            */
/*  The automatic push is fire-and-forget, which is right — it must never      */
/*  interrupt logging a set. But "signed out" and "the table does not exist"   */
/*  are outcomes where nothing is being saved at all, and swallowing those     */
/*  means the app looks like it is syncing for weeks while it is not. The      */
/*  last outcome is kept so a screen can say so.                              */
/* -------------------------------------------------------------------------- */

let latest: WorkoutSyncReport | undefined;
const listeners = new Set<(report: WorkoutSyncReport) => void>();

export function lastSyncReport(): WorkoutSyncReport | undefined {
  return latest;
}

export function onSyncReport(listener: (report: WorkoutSyncReport) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(report: WorkoutSyncReport): WorkoutSyncReport {
  latest = report;
  for (const listener of listeners) listener(report);
  return report;
}

/* --- snapshot ------------------------------------------------------------- */

export async function snapshotWorkout(): Promise<WorkoutSnapshot> {
  const [block, blockExercise, session, setLog, settings, golfDay] = await Promise.all([
    db.block.toArray(),
    db.blockExercise.toArray(),
    db.session.toArray(),
    db.setLog.toArray(),
    db.settings.toArray(),
    db.golfDay.toArray(),
  ]);
  return {
    version: SNAPSHOT_VERSION,
    block,
    blockExercise,
    session,
    setLog,
    // When the weigh-ins were last pulled is true of one device, not of the
    // account, so it never travels.
    settings: settings.filter((row) => row.key !== LAST_SYNC_KEY),
    golfDay,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function readSnapshot(raw: unknown): WorkoutSnapshot | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  // An empty row is a real state — the table exists but nothing was pushed yet.
  if (
    value.block === undefined &&
    value.session === undefined &&
    value.setLog === undefined
  ) {
    return undefined;
  }
  return {
    version: typeof value.version === 'number' ? value.version : SNAPSHOT_VERSION,
    block: asArray<Block>(value.block),
    blockExercise: asArray<BlockExercise>(value.blockExercise),
    session: asArray<Session>(value.session),
    setLog: asArray<SetLog>(value.setLog),
    settings: asArray<SettingRow>(value.settings),
    golfDay: asArray<GolfDay>(value.golfDay),
  };
}

/**
 * Replaces the local training data with a snapshot. Replace rather than merge
 * so a deletion made on another device actually propagates; the dirty flag is
 * what stops this running over unpushed local work.
 */
export async function applyWorkout(snapshot: WorkoutSnapshot): Promise<void> {
  await withSyncSuspended(async () => {
  await db.transaction(
    'rw',
    [db.block, db.blockExercise, db.session, db.setLog, db.settings, db.golfDay],
    async () => {
      const keepLocal = await db.settings.get(LAST_SYNC_KEY);
      await Promise.all([
        db.block.clear(),
        db.blockExercise.clear(),
        db.session.clear(),
        db.setLog.clear(),
        db.settings.clear(),
        db.golfDay.clear(),
      ]);
      await Promise.all([
        db.block.bulkPut(snapshot.block),
        db.blockExercise.bulkPut(snapshot.blockExercise),
        db.session.bulkPut(snapshot.session),
        db.setLog.bulkPut(snapshot.setLog),
        db.settings.bulkPut(snapshot.settings),
        db.golfDay.bulkPut(snapshot.golfDay),
      ]);
      if (keepLocal) await db.settings.put(keepLocal);
    },
  );
  });
}

/* --- pull and push --------------------------------------------------------- */

export type WorkoutSyncOutcome =
  | 'pushed'
  | 'pulled'
  | 'up-to-date'
  | 'needs-sign-in'
  | 'no-table'
  | 'failed';

export interface WorkoutSyncReport {
  outcome: WorkoutSyncOutcome;
  at: string;
  sessions?: number;
  setLogs?: number;
  error?: string;
}

/**
 * One reconciliation. Local edits win if there are any — losing a session
 * logged in the garage because the phone came back online after the laptop
 * would be the worst possible failure — otherwise the cloud copy is taken if
 * it is newer than what this device last pushed.
 */
export async function syncWorkout(store: WorkoutStore): Promise<WorkoutSyncReport> {
  return publish(await reconcile(store));
}

async function reconcile(store: WorkoutStore): Promise<WorkoutSyncReport> {
  const at = new Date().toISOString();

  let userId: string | undefined;
  try {
    userId = await store.userId();
  } catch {
    return { outcome: 'failed', at, error: 'Could not check the sign-in.' };
  }
  if (!userId) return { outcome: 'needs-sign-in', at };

  const push = async (): Promise<WorkoutSyncReport> => {
    const snapshot = await snapshotWorkout();
    // Record what the SERVER stamped, not this device's clock: a phone a few
    // seconds behind would otherwise see its own push as newer and pull it
    // straight back on the next open.
    const serverAt = await store.write(userId as string, snapshot);
    writeFlag(DIRTY_KEY, undefined);
    writeFlag(PUSHED_AT_KEY, serverAt ?? at);
    return {
      outcome: 'pushed',
      at,
      sessions: snapshot.session.length,
      setLogs: snapshot.setLog.length,
    };
  };

  try {
    const remote = await store.read(userId);

    /*
     * A fresh install seeds a starter block, which marks the device dirty
     * before it has ever synced. Pushing that would replace a real history
     * with an empty one, so nothing-here never wins over something.
     *
     * "Nothing here" has to mean nothing the USER made, not merely nothing
     * logged: a program built over a week has no sessions against it yet and
     * is still real work. Counting only sessions meant those edits never
     * pushed and were quietly replaced by whatever the cloud held.
     */
    const [sessions, setLogs, blockExercises] = await Promise.all([
      db.session.count(),
      db.setLog.count(),
      db.blockExercise.count(),
    ]);
    const localIsEmpty = sessions === 0 && setLogs === 0 && blockExercises === 0;

    // Unpushed local work is never overwritten, whatever the cloud says.
    if (isDirty() && !localIsEmpty) return await push();
    const snapshot = remote ? readSnapshot(remote.data) : undefined;
    if (!snapshot) return await push();

    const pushedAt = lastPushedAt();
    const remoteIsNewer =
      remote?.updatedAt !== undefined && (pushedAt === undefined || remote.updatedAt > pushedAt);

    if (!remoteIsNewer) return { outcome: 'up-to-date', at };

    await applyWorkout(snapshot);
    writeFlag(DIRTY_KEY, undefined);
    writeFlag(PUSHED_AT_KEY, remote?.updatedAt ?? at);
    return {
      outcome: 'pulled',
      at,
      sessions: snapshot.session.length,
      setLogs: snapshot.setLog.length,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The table not existing is a setup step, not a fault worth alarming about.
    if (/relation .*workout_data.* does not exist|Could not find the table/i.test(message)) {
      return { outcome: 'no-table', at, error: message };
    }
    return { outcome: 'failed', at, error: message };
  }
}
