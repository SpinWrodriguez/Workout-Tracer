import { db } from '../db/db';
import { normaliseActivity, normaliseBodyWeight, normaliseGoals } from './backup';
import { todayIso } from './format';

/* -------------------------------------------------------------------------- */
/*  Reading the nutrition app's data straight from Supabase.                  */
/*                                                                            */
/*  The nutrition app keeps one JSONB row per user in `nutrition_data`, so     */
/*  that is the source of truth for the weigh-in history — not a JSON file     */
/*  carried between two apps by hand. Its shape is the same one the v2 backup  */
/*  had, so the normalisers written for that file are reused verbatim.         */
/*                                                                            */
/*  The row is behind RLS, so this needs the same signed-in account the        */
/*  nutrition app uses. On a shared origin the session is already in           */
/*  localStorage and nothing else is required.                                 */
/*                                                                            */
/*  Every failure here is survivable: the app opens and works from whatever    */
/*  is already cached, which is what a garage with patchy wifi demands.        */
/* -------------------------------------------------------------------------- */

export const NUTRITION_TABLE = 'nutrition_data';

/**
 * The slice of Supabase this needs, narrowed to an interface so the merge can
 * be tested without a project, a network, or a mock of the whole client.
 */
export interface WeightSource {
  /** Signed-in user id, or undefined when there is no session. */
  userId(): Promise<string | undefined>;
  /** The `data` column of this user's row. */
  nutritionData(userId: string): Promise<unknown>;
}

export interface SyncReport {
  ok: boolean;
  bodyWeight: number;
  activity: number;
  goals: number;
  at: string;
  /** Set when nothing could be read. Never thrown — the app carries on. */
  error?: string;
  /** True when there is simply nobody signed in yet. */
  needsSignIn?: boolean;
}

function emptyReport(at: string): SyncReport {
  return { ok: false, bodyWeight: 0, activity: 0, goals: 0, at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pulls the shared tables out of the nutrition blob. Body weight is the one
 * that matters most, but burn entries and goals ride along in the same payload
 * and cost nothing extra.
 */
export function extractShared(data: unknown) {
  const blob = isRecord(data) ? data : {};
  return {
    bodyWeight: normaliseBodyWeight(blob.weights),
    activity: normaliseActivity(blob.exercise, 'manual'),
    /* Dated today when the blob does not say: the nutrition app keeps one
       undated goals object, and today is when it was read. Without a date it
       matched no shape and was silently dropped. */
    goals: normaliseGoals(blob.goals, todayIso()),
  };
}

/**
 * Merges the nutrition app's shared data into the local tables. Additive and
 * idempotent — everything is keyed on its natural key and written with
 * bulkPut, so running this on every open never duplicates and never deletes
 * anything logged here.
 */
export async function pullShared(source: WeightSource): Promise<SyncReport> {
  const at = new Date().toISOString();
  const base = emptyReport(at);

  let userId: string | undefined;
  try {
    userId = await source.userId();
  } catch {
    return { ...base, error: 'Could not check the sign-in. Working from the local copy.' };
  }
  if (!userId) {
    return { ...base, needsSignIn: true, error: 'Not signed in.' };
  }

  let data: unknown;
  try {
    data = await source.nutritionData(userId);
  } catch (cause) {
    return {
      ...base,
      error: cause instanceof Error ? cause.message : 'Could not reach the nutrition data.',
    };
  }

  const shared = extractShared(data);

  await db.transaction('rw', [db.sharedBodyWeight, db.sharedActivity, db.sharedGoals], async () => {
    if (shared.bodyWeight.length) await db.sharedBodyWeight.bulkPut(shared.bodyWeight);
    if (shared.activity.length) await db.sharedActivity.bulkPut(shared.activity);
    if (shared.goals.length) await db.sharedGoals.bulkPut(shared.goals);
  });

  return {
    ok: true,
    bodyWeight: shared.bodyWeight.length,
    activity: shared.activity.length,
    goals: shared.goals.length,
    at,
  };
}
