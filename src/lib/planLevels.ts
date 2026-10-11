import type { BlockExercise, DaySlot, Exercise } from '../db/types';
import { plannedSetsPerMuscle, volumeRows, type MuscleVolume } from './volume';

/** The sets one week of a plan's order would give each muscle. */
export function planWeekVolume(
  order: DaySlot[],
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
): MuscleVolume {
  return plannedSetsPerMuscle(
    entries.filter((row) => order.includes(row.daySlot)),
    exercisesById,
  );
}

/** The three muscles a single workout loads most, for a list row. */
export function workoutTopMuscles(
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
): string {
  const rows = volumeRows(plannedSetsPerMuscle(entries, exercisesById)).filter((row) => row.sets > 0);
  return rows
    .slice(0, 3)
    .map((row) => `${row.name.toLowerCase()} ${row.sets}`)
    .join(' · ');
}
