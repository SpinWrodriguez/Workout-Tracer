import type { Exercise } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Reps or seconds.                                                          */
/*                                                                            */
/*  A plank prescribed "3 × 20-60 reps" is not a rounding error, it is the     */
/*  wrong quantity — and it appears in four places (the prescription, the      */
/*  keypad, the logged set and the rule messages), so the unit is resolved     */
/*  once here rather than guessed at each of them.                            */
/* -------------------------------------------------------------------------- */

/* A hold is not capped by what a rep count would sensibly be. Ten minutes is
   past anything programmable, which is the right place for a guard rail. */
export const MAX_SECONDS = 600;
export const MAX_REPS = 50;

/** Stepping a two-minute plank one second at a time is not an interface. */
export const SECONDS_STEP = 5;
export const REPS_STEP = 1;

export function isTimed(exercise: Exercise | undefined): boolean {
  return exercise?.repUnit === 'seconds';
}

/** The short unit for a value already on screen: "12 reps" / "45 s". */
export function repUnitShort(exercise: Exercise | undefined): string {
  return isTimed(exercise) ? 's' : 'reps';
}

/** The word for prose and labels: "reps" / "seconds". */
export function repUnitWord(exercise: Exercise | undefined): string {
  return isTimed(exercise) ? 'seconds' : 'reps';
}

/** The most a prescription may be set to, in whatever unit it is counted. */
export function maxPrescription(exercise: Exercise | undefined): number {
  return isTimed(exercise) ? MAX_SECONDS : MAX_REPS;
}

export function stepFor(exercise: Exercise | undefined): number {
  return isTimed(exercise) ? SECONDS_STEP : REPS_STEP;
}

/**
 * Seconds as a person would say them: "45 s" under a minute, "1:30" over it.
 * A plank written as "150 s" is arithmetic homework.
 */
function clockFace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}:00` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** A range in the exercise's own units: "8-12", "30-45 s", "0:30-1:00". */
export function rangeLabel(exercise: Exercise | undefined, low: number, high: number): string {
  if (!isTimed(exercise)) return low === high ? String(low) : `${low}-${high}`;
  if (low === high) return formatDuration(low);
  // One form across the range: "30 s-1:00" makes the reader convert units
  // mid-sentence, so a range reaching a minute is clock-faced at both ends.
  return high < 60 ? `${low}-${high} s` : `${clockFace(low)}-${clockFace(high)}`;
}

/** A prescription as it should read, e.g. "3 × 8-12" or "3 × 30-45 s". */
export function prescription(
  exercise: Exercise | undefined,
  sets: number,
  low: number,
  high: number,
): string {
  return `${sets} × ${rangeLabel(exercise, low, high)}`;
}
