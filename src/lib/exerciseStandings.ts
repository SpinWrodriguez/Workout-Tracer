import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { readDeletedExercises, readRetiredExercises } from '../db/settings';
import { readBlockPlan } from './program';
import { slotFallback } from './dayLabel';

export interface ExerciseStanding {
  exercise: Exercise;
  /** Sets ever logged against it. Zero is "never used". */
  sets: number;
  lastDate?: string;
  /** Names of the current block's workouts that hold it. */
  workouts: string[];
  retired: boolean;
  deleted: boolean;
}

/** Every exercise with what it is doing. Shared by the card summary and the page. */
export async function readExerciseStandings(): Promise<ExerciseStanding[]> {
  const [exercises, logs, sessions, plan, retired, deleted] = await Promise.all([
    db.exercise.orderBy('name').toArray(),
    db.setLog.toArray(),
    db.session.toArray(),
    readBlockPlan(),
    readRetiredExercises(),
    readDeletedExercises(),
  ]);
  const dateBySession = new Map(sessions.map((session) => [session.id, session.date]));
  const sets = new Map<string, number>();
  const last = new Map<string, string>();
  for (const log of logs) {
    sets.set(log.exerciseId, (sets.get(log.exerciseId) ?? 0) + 1);
    const date = dateBySession.get(log.sessionId);
    if (date && date > (last.get(log.exerciseId) ?? '')) last.set(log.exerciseId, date);
  }
  const workouts = new Map<string, Set<string>>();
  for (const entry of plan?.entries ?? []) {
    const name = plan?.schedule[entry.daySlot]?.name ?? slotFallback(entry.daySlot);
    const set = workouts.get(entry.exerciseId) ?? new Set<string>();
    set.add(name);
    workouts.set(entry.exerciseId, set);
  }
  const retiredIds = new Set(retired);
  const deletedIds = new Set(deleted);
  return exercises.map((exercise) => ({
    exercise,
    sets: sets.get(exercise.id) ?? 0,
    lastDate: last.get(exercise.id),
    workouts: [...(workouts.get(exercise.id) ?? [])],
    retired: retiredIds.has(exercise.id),
    deleted: deletedIds.has(exercise.id),
  }));
}
