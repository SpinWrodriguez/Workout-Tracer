import type { DaySlot, Exercise, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import type { Intensity } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What a day is called.                                                     */
/*                                                                            */
/*  "Day A" is a spreadsheet column and "Alpha" is only a nicer spreadsheet    */
/*  column: neither tells you what you are about to do. A name is derived from */
/*  what the day ACTUALLY contains — "Lower Pull", "Upper Push + Core" — so it */
/*  cannot drift from the session the way a hand-typed label would, and it     */
/*  re-derives the moment the day is regenerated.                             */
/*                                                                            */
/*  A name the user types wins over all of this and is stored on the schedule. */
/*  The derivation is a good default, not a policy.                           */
/* -------------------------------------------------------------------------- */

const REGION = new Map(MUSCLES.map((muscle) => [muscle.id, muscle.region]));

/**
 * Push and pull in the gym sense rather than the taxonomy's: a squat is the
 * lower-body push and a hinge is the lower-body pull, which is what makes
 * "Lower Pull" mean the hamstring day to anybody who has trained.
 */
const PUSH_PATTERNS = ['push_h', 'push_v', 'squat'];
const PULL_PATTERNS = ['pull_h', 'pull_v', 'hinge'];
const CORE_PATTERNS = ['core', 'rotation'];

/** Above this share of the limb work, a day is that half of the body. */
const DOMINANCE = 0.7;
/*
 * How far push has to outnumber pull before the day is named after it. One
 * more of either is noise — a balanced light day covering squat, press and row
 * is not a push day — but a clean sweep is the whole character of the session.
 */
const EMPHASIS_MARGIN = 2;
/*
 * A light day of no more than this many exercises is the minimum dose. Kept
 * deliberately small: "minimum dose" is a claim about volume, and a light day
 * with three real movements in it is a session that deserves a real name.
 */
const MINIMUM_DOSE_EXERCISES = 2;

function regionsOf(muscles: MuscleId[]): (string | undefined)[] {
  return muscles.map((muscle) => REGION.get(muscle));
}

/**
 * A name for what this day trains, or undefined when there is nothing to
 * describe. Mobility work is ignored: a hip switch is a warm-up, and letting
 * it vote would name a squat day after it.
 */
export function describeDay(exercises: Exercise[], intensity: Intensity = 'heavy'): string | undefined {
  const working = exercises.filter((exercise) => !exercise.isMobility);
  if (working.length === 0) return undefined;

  // A day spent entirely on the stack is that, whatever it happens to train.
  if (working.every((exercise) => exercise.station === 'cable')) return 'Cable Session';

  if (intensity === 'light' && working.length <= MINIMUM_DOSE_EXERCISES) return 'Minimum Dose';

  let upper = 0;
  let lower = 0;
  let push = 0;
  let pull = 0;
  let core = 0;

  for (const exercise of working) {
    const regions = regionsOf(exercise.primaryMuscles);
    // Lower first: a movement that is primarily legs is a leg movement even
    // when it also loads the back.
    if (regions.includes('lower')) lower += 1;
    else if (regions.includes('upper')) upper += 1;

    if (PUSH_PATTERNS.includes(exercise.pattern)) push += 1;
    if (PULL_PATTERNS.includes(exercise.pattern)) pull += 1;
    if (CORE_PATTERNS.includes(exercise.pattern)) core += 1;
  }

  const limbs = upper + lower;
  if (limbs === 0) return 'Core';

  const emphasis =
    push - pull >= EMPHASIS_MARGIN ? 'Push' : pull - push >= EMPHASIS_MARGIN ? 'Pull' : undefined;
  const withCore = (name: string) => (core > 0 ? `${name} + Core` : name);

  if (lower / limbs >= DOMINANCE) return withCore(emphasis ? `Lower ${emphasis}` : 'Lower Body');
  if (upper / limbs >= DOMINANCE) return withCore(emphasis ? `Upper ${emphasis}` : 'Upper Body');

  /*
   * Both halves in one session. Naming every such day "Full Body Heavy" makes
   * a whole week of identical labels, which is the problem slot letters had —
   * so when the day leans clearly one way, say so. Only a genuinely balanced
   * day falls back to its effort.
   */
  if (emphasis) return `Full Body ${emphasis}`;
  return intensity === 'light' ? 'Full Body Light' : 'Full Body Heavy';
}

/** The bare identity of a slot, for a day with nothing in it yet. */
export function slotFallback(slot: DaySlot | string | undefined): string {
  return slot === undefined ? '' : `Day ${slot}`;
}

/**
 * What to show for a day. A name the user typed wins; otherwise the day
 * describes itself; an empty day falls back to its slot.
 */
export function dayLabel({
  slot,
  name,
  exercises,
  intensity,
}: {
  slot: DaySlot | string | undefined;
  name?: string;
  exercises?: Exercise[];
  intensity?: Intensity;
}): string {
  const typed = name?.trim();
  if (typed) return typed;
  const derived = exercises ? describeDay(exercises, intensity) : undefined;
  return derived ?? slotFallback(slot);
}

/* -------------------------------------------------------------------------- */
/*  Names small enough for a calendar pill.                                   */
/*                                                                            */
/*  A bare "X" meant something when a day WAS its letter. Now that days are    */
/*  named, the letter is the one thing on screen that says nothing — but the   */
/*  name does not fit either, so it is shortened by dropping what carries no   */
/*  information rather than by cutting characters off the end.                 */
/*                                                                            */
/*  "Full Body" first, because in a week of full-body sessions it is the part  */
/*  every day shares; then any leading word the whole week has in common. What */
/*  is left is what actually tells them apart.                                */
/* -------------------------------------------------------------------------- */

/** Longer than this and initials read better than a truncation. */
const PILL_CHARS = 11;

function words(label: string): string[] {
  return label
    .split(/\s+/)
    .filter((word) => word.length > 0 && word !== '+' && word !== '&');
}

function initials(parts: string[]): string {
  return parts
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4);
}

/**
 * Short forms for a row of day names, shortened against each other. Pass the
 * whole week: what to drop depends on what the other days are called.
 */
export function shortDayLabels(labels: string[]): string[] {
  const parts = labels.map((label) => {
    // An unnamed day is still just its letter, and that is the whole name.
    const bare = /^Day (\w+)$/.exec(label.trim());
    if (bare) return [bare[1] as string];
    const list = words(label);
    // Generic whatever else is in the week: every session trains the body.
    if (list.length > 2 && list[0]?.toLowerCase() === 'full' && list[1]?.toLowerCase() === 'body') {
      return list.slice(2);
    }
    return list;
  });

  // Then whatever leading word they all share, while each keeps something.
  let guard = 4;
  while (
    parts.length > 1 &&
    guard-- > 0 &&
    parts.every((list) => list.length > 1) &&
    parts.every((list) => list[0]?.toLowerCase() === parts[0]?.[0]?.toLowerCase())
  ) {
    for (let i = 0; i < parts.length; i += 1) parts[i] = (parts[i] as string[]).slice(1);
  }

  return parts.map((list) => {
    const joined = list.join(' ');
    if (joined.length === 0) return '--';
    return joined.length <= PILL_CHARS ? joined : initials(list);
  });
}
