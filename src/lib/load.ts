import type { Exercise, SetLog } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Load maths — spec §5, rule 2.                                             */
/*                                                                            */
/*  Log weightKg (what you actually selected or loaded); chart and compare on  */
/*  effectiveKg. Without this the 2:1 cable stack makes a 50 kg cable row look */
/*  stronger than a 50 kg squat, and every 1-RM estimate is nonsense.          */
/* -------------------------------------------------------------------------- */

/** Rounded to 0.01 kg — 50 × 0.49 must read 24.5, not 24.500000000000004. */
export function effectiveKg(exercise: Exercise, weightKg: number | undefined): number | undefined {
  if (exercise.loadMode === 'rpe_only') return undefined;
  if (weightKg === undefined || Number.isNaN(weightKg)) return undefined;
  return Math.round(weightKg * exercise.loadMultiplier * 100) / 100;
}

/**
 * True when the loaded number and the effective number differ enough to be
 * worth showing both. Only the cable station does this today.
 */
export function hasLoadTranslation(exercise: Exercise): boolean {
  return exercise.loadMode === 'weight' && Math.abs(exercise.loadMultiplier - 1) > 0.005;
}

/** What the weight column means for this exercise, shown as a column label. */
export function weightColumnLabel(exercise: Exercise): string {
  switch (exercise.station) {
    case 'cable':
      return 'stack kg';
    case 'free_bar':
    case 'smith':
      return 'total kg';
    default:
      return 'kg';
  }
}

export function volumeKg(sets: SetLog[]): number {
  return sets.reduce((sum, s) => sum + (s.effectiveKg ?? 0) * s.reps, 0);
}

/** RIR badge colour. Spec gives three tokens; 0 reads as "at failure". */
export function rirToken(rir: number | undefined): string | undefined {
  if (rir === undefined) return undefined;
  if (rir <= 1) return 'var(--color-rir-1)';
  if (rir === 2) return 'var(--color-rir-2)';
  return 'var(--color-rir-3)';
}

/** RPE and RIR are two views of the same number; keep them consistent. */
export function rirFromRpe(rpe: number): number {
  return Math.max(0, Math.round(10 - rpe));
}

export function rpeFromRir(rir: number): number {
  return Math.min(10, Math.max(6, 10 - rir));
}
