import type { BlockExercise, Exercise, SetLog } from '../db/types';
import { db } from '../db/db';
import { isTimed } from './repUnit';
import { ladderFor, type Inventory } from './loadable';
import { suggestProgression, type HistorySet } from './progression';

/* -------------------------------------------------------------------------- */
/*  The two signals a coach programs from, computed where both consumers can   */
/*  reach them: the AI payload (so generation reasons about THIS lifter's      */
/*  month) and the Program screen (so a stalled lift is said out loud).        */
/*                                                                            */
/*  A coach's rule for changing an exercise is not "it was used lately" — it   */
/*  is "there is a reason": the lift stalled, or the block rolled over.        */
/*  usedLately is the data that lets accessories rotate without banning the    */
/*  staples; the stall flag is the reason the mains themselves get swapped.    */
/* -------------------------------------------------------------------------- */

/** Distinct sessions each exercise appeared in, over whatever logs are given. */
export function usageByExercise(logs: SetLog[]): Map<string, number> {
  const sessions = new Map<string, Set<string>>();
  for (const log of logs) {
    const seen = sessions.get(log.exerciseId) ?? new Set<string>();
    seen.add(log.sessionId);
    sessions.set(log.exerciseId, seen);
  }
  return new Map([...sessions].map(([id, seen]) => [id, seen.size]));
}

/**
 * The programmed exercises whose progression has stalled: missed the rep range
 * twice at the same weight, which is exactly the engine's hold_review outcome.
 * That outcome already renders as "review" on the workout sheet; this is the
 * same fact surfaced where rebuilding decisions actually get made.
 */
export async function stalledExerciseIds(
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
  inventory: Inventory,
): Promise<string[]> {
  const wanted = [...new Set(entries.map((entry) => entry.exerciseId))];
  if (wanted.length === 0) return [];

  const logs = await db.setLog.where('exerciseId').anyOf(wanted).toArray();
  if (logs.length === 0) return [];
  const sessions = await db.session.bulkGet([...new Set(logs.map((log) => log.sessionId))]);
  const dateById = new Map(
    sessions.filter((session) => session !== undefined).map((session) => [session.id, session.date]),
  );

  const history = new Map<string, HistorySet[]>();
  for (const log of logs) {
    const list = history.get(log.exerciseId) ?? [];
    list.push({
      sessionId: log.sessionId,
      date: dateById.get(log.sessionId) ?? '',
      weightKg: log.weightKg,
      reps: log.reps,
      rir: log.rir,
      rpe: log.rpe,
    });
    history.set(log.exerciseId, list);
  }

  const stalled = new Set<string>();
  for (const entry of entries) {
    if (stalled.has(entry.exerciseId)) continue;
    const exercise = exercisesById.get(entry.exerciseId);
    const rows = history.get(entry.exerciseId);
    if (!exercise || !rows || rows.length === 0) continue;
    const result = suggestProgression({
      ladder: ladderFor(exercise, inventory),
      history: rows,
      repRangeLow: entry.repRangeLow,
      repRangeHigh: entry.repRangeHigh,
      timed: isTimed(exercise),
      band: exercise.loadMode === 'band',
    });
    if (result.outcome === 'hold_review') stalled.add(entry.exerciseId);
  }
  return [...stalled];
}
