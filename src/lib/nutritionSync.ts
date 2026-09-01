import { writeLastSync } from '../db/settings';
import { pullShared, type SyncReport } from './remoteSync';
import { getSupabase, supabaseSource, supabaseWorkoutStore } from './supabaseSource';
import { syncWorkout, type WorkoutSyncReport } from './workoutSync';

/**
 * One pull of the nutrition app's shared data, recording when it happened.
 * Never throws: the caller is usually app startup, which must not depend on
 * the network being there.
 */
export async function syncNow(): Promise<SyncReport> {
  const at = new Date().toISOString();
  const client = await getSupabase();
  if (!client) {
    return {
      ok: false,
      bodyWeight: 0,
      activity: 0,
      goals: 0,
      at,
      error: 'Supabase is not configured in this build.',
    };
  }
  const report = await pullShared(supabaseSource(client));
  if (report.ok) await writeLastSync(report.at);
  return report;
}

/** One reconciliation of the training data with the cloud copy. */
export async function syncWorkoutNow(): Promise<WorkoutSyncReport> {
  const client = await getSupabase();
  if (!client) {
    return {
      outcome: 'failed',
      at: new Date().toISOString(),
      error: 'Supabase is not configured in this build.',
    };
  }
  return syncWorkout(supabaseWorkoutStore(client));
}
