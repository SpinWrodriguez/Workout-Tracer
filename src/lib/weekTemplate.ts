import type { DaySlot, MovementPattern } from '../db/types';
import { WEEKDAY_LABEL, gripSafeWeekdays, type Weekday } from './golf';

/* -------------------------------------------------------------------------- */
/*  The weekly template.                                                      */
/*                                                                            */
/*  The week shape is known, so it is a constant rather than something to     */
/*  generate. Code assigns the days and their intensity; whatever fills them   */
/*  with exercises — the deterministic selector today, a model later — never   */
/*  chooses a date. That removes the whole class of scheduling bugs: nothing   */
/*  can put a deadlift on a Friday because nothing picks the day.              */
/*                                                                            */
/*    Mon  A  heavy   full effort, all grip-heavy work lives here             */
/*    Tue  B  heavy   full effort                                             */
/*    Wed  C  light   optional, ~25 min, sub-maximal, no grip-heavy work      */
/*                                                                           */
/*  That layout is history: nothing here chooses a weekday any more. The      */
/*  lifter makes a workout and drops it on a date, and this module answers    */
/*  one question about the day it landed on — what it trains, how hard, what  */
/*  the calendar excludes. The sketch above survives only as the shape the    */
/*  defaults still assume.                                                   */
/* -------------------------------------------------------------------------- */

export type Intensity = 'heavy' | 'light';

/*
 * The stand-in weekday for a workout that has not been placed yet. Monday
 * because something has to be passed and Monday excludes nothing: an unplaced
 * workout has no calendar around it, so it must not inherit one day's
 * exclusions. See workoutTemplate below.
 */
const UNPLACED: Weekday = 1;

export interface TemplateDay {
  slot: DaySlot;
  weekday: Weekday;
  weekdayLabel: string;
  intensity: Intensity;
  /** Pattern targets for this day, in the order they will be performed. */
  patterns: MovementPattern[];
  /** Exercises of these grip loads are excluded. */
  excludeGripHigh: boolean;
  excludeSpinalHigh: boolean;
  setsPerExercise: number;
  repShift: { low: number; high: number };
  minutesBudget: number;
  maxExercises: number;
  /** Shown on the session screen; empty on a heavy day. */
  effortCue?: string;
}

const LIGHT_DAY_MINUTES = 25;
export const LIGHT_DAY_CUE = 'Leave 3-4 reps in the tank';

/* -------------------------------------------------------------------------- */
/*  Shape: what the two heavy days train.                                     */
/*                                                                            */
/*  The template still owns WHEN a session happens and HOW HARD it is. This    */
/*  is the one thing left worth choosing — whether the heavy pair splits by    */
/*  movement or by half of the body. Placement stays in code either way, so    */
/*  no scheduling bug can come back through it.                               */
/* -------------------------------------------------------------------------- */

export type SessionShape = 'mixed' | 'upper_lower';

/* -------------------------------------------------------------------------- */
/*  What one workout trains.                                                  */
/*                                                                            */
/*  A workout is a thing you make, not a by-product of laying out a week. It   */
/*  is described by what it trains and how hard, and by nothing about the      */
/*  calendar — a workout does not know what day it is, and cannot, because it  */
/*  has not been assigned to one yet.                                         */
/*                                                                            */
/*  The golf rule therefore cannot be applied here. That is correct rather     */
/*  than a gap: grip clearance is a fact about a DATE, so it belongs to        */
/*  assignment and is checked there.                                          */
/* -------------------------------------------------------------------------- */

export type WorkoutFocus = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'core';

export const WORKOUT_FOCUSES: WorkoutFocus[] = ['full', 'upper', 'lower', 'push', 'pull', 'core'];

export const WORKOUT_FOCUS_LABEL: Record<WorkoutFocus, string> = {
  full: 'Full body',
  upper: 'Upper',
  lower: 'Lower',
  push: 'Push',
  pull: 'Pull',
  core: 'Core & carries',
};

/**
 * The patterns a focus asks for. Repeats are deliberate: 'lower' wants two
 * squat-pattern movements, not one squat mentioned twice.
 */
const FOCUS_PATTERNS: Record<WorkoutFocus, MovementPattern[]> = {
  full: ['hinge', 'squat', 'push_h', 'pull_h', 'core'],
  upper: ['pull_h', 'pull_v', 'push_h', 'push_v', 'core'],
  lower: ['squat', 'hinge', 'squat', 'core'],
  push: ['push_h', 'push_v', 'squat', 'core'],
  pull: ['pull_h', 'pull_v', 'hinge', 'core'],
  core: ['core', 'rotation', 'carry', 'core'],
};

/** The distinct patterns a focus covers, for telling a model what to aim at. */
export function patternsForFocus(focus: WorkoutFocus): MovementPattern[] {
  return [...new Set(FOCUS_PATTERNS[focus])];
}

/**
 * Constraints for a workout that has no day yet. The weekday is a placeholder
 * the filler never reads — it only ever reaches for the pattern targets, the
 * set count and the budget.
 */
export function workoutTemplate({
  slot,
  focus,
  intensity,
  minutesPerSession = 40,
}: {
  slot: DaySlot;
  focus: WorkoutFocus;
  intensity: Intensity;
  minutesPerSession?: number;
}): TemplateDay {
  const patterns = FOCUS_PATTERNS[focus];
  const base =
    intensity === 'light'
      ? lightDay(slot, UNPLACED)
      : heavyDay(slot, UNPLACED, patterns, minutesPerSession, []);
  return {
    ...base,
    patterns,
    /*
     * Nothing is excluded on grip grounds while a workout is unplaced: there
     * is no date to be clear of. Assigning it to a day inside the buffer is
     * what surfaces the conflict, and the rule check says so there.
     */
    excludeGripHigh: false,
    maxExercises: intensity === 'light' ? 5 : 7,
  };
}

export const SESSION_SHAPES: SessionShape[] = ['mixed', 'upper_lower'];

export const SESSION_SHAPE_LABEL: Record<SessionShape, string> = {
  mixed: 'Mixed',
  upper_lower: 'Upper / Lower',
};

export const SESSION_SHAPE_HINT: Record<SessionShape, string> = {
  mixed: 'Legs on both heavy days, upper work spread across the week.',
  upper_lower: 'Mon is upper body, Tue is lower body.',
};

/*
 * Mixed: session A carries the hinge and both pulls, session B the squat and
 * the presses. The grip-heavy movements sit on Monday, the furthest point in
 * the week from a weekend round.
 *
 * Upper / Lower: A is the whole upper body, B is the whole lower half. Both
 * still land on Mon and Tue, which are the two grip-safe days, so the hinge
 * moving to Tuesday costs nothing against the golf rule.
 */
const SHAPE_PATTERNS: Record<SessionShape, { a: MovementPattern[]; b: MovementPattern[] }> = {
  mixed: {
    a: ['hinge', 'pull_h', 'pull_v', 'core'],
    b: ['squat', 'push_h', 'push_v', 'core'],
  },
  upper_lower: {
    a: ['pull_h', 'pull_v', 'push_h', 'push_v', 'core'],
    b: ['squat', 'hinge', 'squat', 'core'],
  },
};

/*
 * Light days cycle through these. One light day in a normal week takes the
 * first set and the heavy pair covers the hinge and core; a week with several
 * light days — or nothing but light days — still reaches every pattern,
 * because the sets complement each other rather than repeating.
 */
const LIGHT_PATTERN_SETS: MovementPattern[][] = [
  ['squat', 'push_h', 'pull_h', 'rotation'],
  ['hinge', 'push_v', 'pull_v', 'core'],
  ['squat', 'rotation', 'core', 'carry'],
];

function heavyDay(
  slot: DaySlot,
  weekday: Weekday,
  patterns: MovementPattern[],
  minutes: number,
  golfWeekdays: Weekday[],
): TemplateDay {
  return {
    slot,
    weekday,
    weekdayLabel: WEEKDAY_LABEL[weekday],
    intensity: 'heavy',
    patterns,
    // Derived, not assumed: any day inside the buffer loses grip work whatever
    // its intensity. Mon and Tue are clear, so this changes nothing for them.
    excludeGripHigh: !gripSafeWeekdays(golfWeekdays).includes(weekday),
    excludeSpinalHigh: false,
    setsPerExercise: 3,
    repShift: { low: 0, high: 0 },
    minutesBudget: minutes,
    maxExercises: 5,
  };
}

function lightDay(slot: DaySlot, weekday: Weekday, index = 0): TemplateDay {
  return {
    slot,
    weekday,
    weekdayLabel: WEEKDAY_LABEL[weekday],
    intensity: 'light',
    patterns: LIGHT_PATTERN_SETS[index % LIGHT_PATTERN_SETS.length] as MovementPattern[],
    // Sub-maximal by construction: nothing that taxes grip or the spine.
    excludeGripHigh: true,
    excludeSpinalHigh: true,
    setsPerExercise: 2,
    // Shifted up: 12-15 where a heavy day would ask for 8-10.
    repShift: { low: 4, high: 5 },
    minutesBudget: LIGHT_DAY_MINUTES,
    maxExercises: 4,
    effortCue: LIGHT_DAY_CUE,
  };
}

/** True when a session may be scheduled on this weekday at all. */
/**
 * Whether a session may sit on a weekday AT ALL.
 *
 * A round is the only thing that bars one now. Friday and Saturday used to be
 * barred outright, which was a fact about where a template put sessions when it
 * chose the days itself — never a fact about what a lifter is allowed to do.
 * That template is gone, and treating "it would not have chosen Friday" as a
 * violation had the app refusing the answer to a question it had just asked.
 */
export function weekdayAllowed(weekday: Weekday, golfWeekdays: Weekday[] = []): boolean {
  return !golfWeekdays.includes(weekday);
}

/* -------------------------------------------------------------------------- */
/*  One day of the template, on demand.                                       */
/*                                                                            */
/*  Regenerating a single day needs the same constraints templateWeek() would  */
/*  have handed it, but the day may not be in the current week at all — a slot */
/*  built by hand on a Sunday has no entry in a two-session template. This     */
/*  rebuilds the constraints from what the slot actually is, so per-day        */
/*  generation runs through exactly the same rules as the weekly pass.         */
/*                                                                            */
/*  `index` is the day's position among days of ITS OWN intensity: it selects  */
/*  which pattern set to use, so two heavy days complement rather than repeat. */
/* -------------------------------------------------------------------------- */
export function templateDayFor({
  slot,
  weekday,
  intensity,
  index = 0,
  shape = 'mixed',
  minutesPerSession = 40,
  golfWeekdays = [],
  focus,
}: {
  slot: DaySlot;
  weekday: Weekday;
  intensity: Intensity;
  index?: number;
  shape?: SessionShape;
  minutesPerSession?: number;
  golfWeekdays?: Weekday[];
  /**
   * What the workout is FOR, as chosen when it was made. Given one, it decides
   * the pattern targets; without one they are inferred from the day's position
   * in the week, which is all a workout made before the focus was stored has.
   *
   * Splitting it this way is the point: the focus says what the day trains and
   * belongs to the workout, while the weekday and the golf calendar say what
   * is excluded and belong to where it was placed. Inferring the patterns from
   * the weekday conflated the two, so regenerating an upper-body day on a
   * Wednesday handed back a squat day.
   */
  focus?: WorkoutFocus;
}): TemplateDay {
  if (intensity === 'light') {
    const base = lightDay(slot, weekday, index);
    return focus ? { ...base, patterns: FOCUS_PATTERNS[focus] } : base;
  }
  const set = focus
    ? FOCUS_PATTERNS[focus]
    : index % 2 === 0
      ? SHAPE_PATTERNS[shape].a
      : SHAPE_PATTERNS[shape].b;
  return heavyDay(slot, weekday, set, minutesPerSession, golfWeekdays);
}
