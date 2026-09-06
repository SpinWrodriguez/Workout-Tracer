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

/**
 * Spec Phase 4: flag a muscle below 8 or above 20 weighted sets in a week.
 *
 * These are the evidence numbers, and they are kept as such — but 18 muscles
 * times a floor of 8 is 144 weighted sets, and a set is worth about 2.8 of
 * those, so clearing every muscle takes roughly 53 sets a week. A 36-set week
 * cannot get there: ten muscles were flagged permanently, by arithmetic, which
 * turns the one card meant to point at neglect into noise.
 *
 * So the floor is what a week SHOULD have, and `fairShare` below is what the
 * week actually asked for can give. The screen flags against the share and
 * says what the floor would need.
 */
export const VOLUME_LOW = 8;
export const VOLUME_HIGH = 20;

/**
 * Weighted muscle-sets one working set is worth, averaged over the library.
 *
 * Measured, not guessed: a set counts 1 for each muscle it trains directly and
 * 0.5 for each it trains indirectly, and the curated 70 non-mobility exercises
 * average 2.81 of those. Computed from whatever exercise table is passed in,
 * so adding exercises moves it.
 */
export function weightedPerSet(exercisesById: Map<string, Exercise>): number {
  const rows = [...exercisesById.values()].filter((exercise) => !exercise.isMobility);
  if (rows.length === 0) return 1;
  const total = rows.reduce(
    (sum, exercise) =>
      sum + exercise.primaryMuscles.length + exercise.secondaryMuscles.length * SECONDARY_WEIGHT,
    0,
  );
  return total / rows.length;
}

/**
 * An even share of the week's set target, per muscle.
 *
 * What "enough" can mean for the week that was actually asked for: 36 sets is
 * about 101 weighted sets, which across 18 muscles is 5.6 each. A muscle under
 * its share is under-served RELATIVE TO THIS WEEK — a real thing to act on —
 * where "under 8" was a verdict the target made unreachable.
 *
 * Never above the evidence floor: a 90-set week does not make 20 sets of
 * biceps a shortfall.
 */
/**
 * The weighted sets one muscle can expect from the week the lifter asked for.
 *
 * The target is a count of working sets; each one lands on about 2.81 weighted
 * muscle-sets, spread over 18 muscles. At the 36-set default that is 5.5 a
 * muscle — the floor of 8 everywhere would take about 53 sets a week, which is
 * not a three-day week. Capped at the floor, because past that the literature
 * has a real number and this arithmetic should get out of its way.
 *
 * Rounded to the half set, since that is the smallest amount a set can add.
 */
export function fairShare(weeklySetTarget: number, exercisesById: Map<string, Exercise>): number {
  const weighted = weeklySetTarget * weightedPerSet(exercisesById);
  const share = weighted / MUSCLES.length;
  return Math.min(VOLUME_LOW, Math.round(share * 2) / 2);
}

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
/** One exercise's worth of sets, spread over what it trains. */
function addSets(out: MuscleVolume, exercise: Exercise, sets: number): void {
  // Warm-up mobility is counted nowhere: a 90/90 hip switch is not a set of
  // training and would flatter every weekly total it touched.
  if (exercise.isMobility) return;
  for (const muscle of exercise.primaryMuscles) out[muscle] += PRIMARY_WEIGHT * sets;
  for (const muscle of exercise.secondaryMuscles) out[muscle] += SECONDARY_WEIGHT * sets;
}

/** Halves only; keep the arithmetic exact rather than trusting float sums. */
function toHalves(volume: MuscleVolume): MuscleVolume {
  for (const key of Object.keys(volume) as MuscleId[]) {
    volume[key] = Math.round(volume[key] * 2) / 2;
  }
  return volume;
}

export function setsPerMuscle(
  logs: SetLog[],
  exercisesById: Map<string, Exercise>,
): MuscleVolume {
  const out = emptyVolume();
  for (const log of logs) {
    const exercise = exercisesById.get(log.exerciseId);
    // One logged row is one set.
    if (exercise) addSets(out, exercise, 1);
  }
  return toHalves(out);
}

/**
 * The same weighting over PROGRAMMED sets: what a week intends to train rather
 * than what it has trained.
 *
 * The distinction is the whole point of showing this on the Program screen. A
 * logged map answers "how did the week go", which is a question for afterwards;
 * a planned map answers "what does this week miss", which is a question you can
 * still do something about. One entry is several sets, so it carries its
 * targetSets rather than counting as one the way a logged row does.
 */
export function plannedSetsPerMuscle(
  entries: { exerciseId: string; targetSets: number }[],
  exercisesById: Map<string, Exercise>,
): MuscleVolume {
  const out = emptyVolume();
  for (const entry of entries) {
    const exercise = exercisesById.get(entry.exerciseId);
    if (exercise) addSets(out, exercise, entry.targetSets);
  }
  return toHalves(out);
}

/**
 * Two volumes added together, muscle by muscle.
 *
 * The Program map is one week described two ways at once: the days already
 * trained are described by what was LOGGED, the days still ahead by what is
 * PLANNED. Neither alone is the week — a deleted workout erases a day you
 * actually did, and a plan alone ignores everything you changed on the floor.
 */
export function mergeVolume(a: MuscleVolume, b: MuscleVolume): MuscleVolume {
  const out = emptyVolume();
  for (const key of Object.keys(out) as MuscleId[]) {
    out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  }
  return toHalves(out);
}

export interface MuscleVolumeRow {
  muscleId: MuscleId;
  name: string;
  region: 'upper' | 'lower' | 'core';
  sets: number;
  status: VolumeStatus;
}

/**
 * The same volume, divided by the number of weeks it covers.
 *
 * The floor and the ceiling are WEEKLY numbers, so a three-month window has
 * to be averaged before it can be judged against them: 60 sets of abs is a
 * problem over one week and light over thirteen. Rounded to a half, which is
 * the smallest amount a set can be worth.
 */
export function perWeek(volume: MuscleVolume, weeks: number): MuscleVolume {
  if (weeks <= 1) return volume;
  const out = {} as MuscleVolume;
  for (const muscle of MUSCLES) {
    out[muscle.id] = Math.round(((volume[muscle.id] ?? 0) / weeks) * 2) / 2;
  }
  return out;
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

/**
/**
 * Where the body map's colour tops out.
 *
 * Between the two numbers that already mean something, and deliberately
 * neither of them. At the ceiling of 20 a real three-day week reads almost
 * entirely cold, because almost nothing in it gets near 20 sets. At the floor
 * of 8 the ramp saturates so early that a muscle on 8 and a muscle on 15 look
 * identical — and the difference between clearing the floor and having had a
 * genuinely full week is the thing worth seeing. So: full colour at a week's
 * real work, with the ceiling left to mean what it means.
 */
export const HEAT_FULL = 15;

/**
 * How hot a muscle reads on the body map: 0 untrained, 1 at HEAT_FULL.
 *
 * The screen's flags answer a different question — "is this muscle short of
 * what the week can give it" — against fairShare, which is smaller again.
 */
export function volumeHeat(sets: number): number {
  if (sets <= 0) return 0;
  return Math.min(1, sets / HEAT_FULL);
}

