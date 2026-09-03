import { MUSCLE_BY_ID } from '../db/seed/muscles';
import type { Exercise, MuscleId } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Colour by what a movement trains.                                        */
/*                                                                           */
/*  Three colours, one per region, taken from tokens that already exist       */
/*  rather than invented: the silhouette blue for upper, the volume orange    */
/*  for lower, the strength cyan for core. Both themes already darken these   */
/*  for light mode, so this needs no palette work and cannot drift from it.   */
/*                                                                           */
/*  The region comes from the muscle table, so it is a fact about the         */
/*  exercise rather than a decision taken in a component — and a chip that    */
/*  reads "Chest" in upper-body blue is telling you something, which is the   */
/*  only reason to add colour to a screen this plain.                        */
/* -------------------------------------------------------------------------- */

export type Region = 'upper' | 'lower' | 'core';

const REGION_COLOR: Record<Region, string> = {
  upper: 'var(--color-muscle)',
  lower: 'var(--color-volume)',
  core: 'var(--color-strength)',
};

export function regionOf(muscle: MuscleId): Region {
  return MUSCLE_BY_ID[muscle]?.region ?? 'core';
}

export function colorForRegion(region: Region): string {
  return REGION_COLOR[region];
}

/** The colour of an exercise, from the first muscle it trains directly. */
export function regionColor(exercise: Exercise): string {
  const first = exercise.primaryMuscles[0];
  return colorForRegion(first ? regionOf(first) : 'core');
}
