import type { Exercise } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Reps or seconds.                                                          */
/*                                                                            */
/*  A plank prescribed "3 × 20-60 reps" is not a rounding error, it is the     */
/*  wrong quantity — and it appears in four places (the prescription, the      */
/*  keypad, the logged set and the rule messages), so the unit is resolved     */
/*  once here rather than guessed at each of them.                            */
/* -------------------------------------------------------------------------- */

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

/** A prescription as it should read, e.g. "3 × 8-12" or "3 × 30-45 s". */
export function prescription(
  exercise: Exercise | undefined,
  sets: number,
  low: number,
  high: number,
): string {
  const range = low === high ? String(low) : `${low}-${high}`;
  return isTimed(exercise) ? `${sets} × ${range} s` : `${sets} × ${range}`;
}
