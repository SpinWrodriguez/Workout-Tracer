import type { Exercise, MuscleId, SetLog } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';

/* -------------------------------------------------------------------------- */
/*  Weekly set volume per muscle — spec Phase 4.                              */
/*                                                                            */
/*  A set counts 1 toward each primary muscle and 0.5 toward each secondary.   */
/*  This is a readout, not a target: it answers "what did I actually train     */
/*  this week", which is the question two sessions a week makes hard to hold   */
/*  in your head.                                                             */
/* -------------------------------------------------------------------------- */

export const PRIMARY_WEIGHT = 1;
export const SECONDARY_WEIGHT = 0.5;

/** Spec Phase 4: flag a muscle below 8 or above 20 sets in a week. */
export const VOLUME_LOW = 8;
export const VOLUME_HIGH = 20;

export type VolumeStatus = 'none' | 'low' | 'ok' | 'high';

export function volumeStatus(sets: number): VolumeStatus {
  if (sets <= 0) return 'none';
  if (sets < VOLUME_LOW) return 'low';
  if (sets > VOLUME_HIGH) return 'high';
  return 'ok';
}

export type MuscleVolume = Record<MuscleId, number>;

function emptyVolume(): MuscleVolume {
  return Object.fromEntries(MUSCLES.map((m) => [m.id, 0])) as MuscleVolume;
}

/**
 * Weighted set counts per muscle for whatever set logs are passed in — the
 * caller decides the window.
 */
export function setsPerMuscle(
  logs: SetLog[],
  exercisesById: Map<string, Exercise>,
): MuscleVolume {
  const out = emptyVolume();
  for (const log of logs) {
    const exercise = exercisesById.get(log.exerciseId);
    if (!exercise) continue;
    // Warm-up mobility is logged but never counted: a 90/90 hip switch is not
    // a set of training and would flatter every weekly total it touched.
    if (exercise.isMobility) continue;
    for (const muscle of exercise.primaryMuscles) out[muscle] += PRIMARY_WEIGHT;
    for (const muscle of exercise.secondaryMuscles) out[muscle] += SECONDARY_WEIGHT;
  }
  // Halves only; keep the arithmetic exact rather than trusting float sums.
  for (const key of Object.keys(out) as MuscleId[]) out[key] = Math.round(out[key] * 2) / 2;
  return out;
}

export interface MuscleVolumeRow {
  muscleId: MuscleId;
  name: string;
  region: 'upper' | 'lower' | 'core';
  sets: number;
  status: VolumeStatus;
}

/** Sorted heaviest first, so the list reads as a ranking. */
export function volumeRows(volume: MuscleVolume): MuscleVolumeRow[] {
  return MUSCLES.map((muscle) => ({
    muscleId: muscle.id,
    name: muscle.name,
    region: muscle.region,
    sets: volume[muscle.id] ?? 0,
    status: volumeStatus(volume[muscle.id] ?? 0),
  })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}

/** 0..1, for shading the silhouette. Full colour at the top of the range. */
export function volumeIntensity(sets: number): number {
  if (sets <= 0) return 0;
  return Math.min(1, sets / VOLUME_HIGH);
}
