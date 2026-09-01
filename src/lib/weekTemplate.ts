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
/*    Thu     rest    (or the light day, if preferred)                        */
/*    Fri     rest    never scheduled                                         */
/*    Sat     golf                                                            */
/*    Sun     golf, or the light day when no round is played                  */
/* -------------------------------------------------------------------------- */

export type Intensity = 'heavy' | 'light';

export const MONDAY: Weekday = 1;
export const TUESDAY: Weekday = 2;

/** Days a session may never land on, whatever else is true. */
export const FORBIDDEN_WEEKDAYS: Weekday[] = [5, 6]; // Fri, Sat

/** Candidate weekdays for sessions beyond the heavy pair, in preference order. */
export const EXTRA_DAY_OPTIONS: Weekday[] = [3, 4, 7]; // Wed, Thu, Sun
export const DEFAULT_THIRD_DAY: Weekday = 3; // Wed

/** Mon and Tue plus the three usable remaining days. */
export const MAX_SESSIONS = 5;

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

export const LIGHT_DAY_MINUTES = 25;
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

const FOCUS_PATTERNS: Record<WorkoutFocus, MovementPattern[]> = {
  full: ['hinge', 'squat', 'push_h', 'pull_h', 'core'],
  upper: ['pull_h', 'pull_v', 'push_h', 'push_v', 'core'],
  lower: ['squat', 'hinge', 'squat', 'core'],
  push: ['push_h', 'push_v', 'squat', 'core'],
  pull: ['pull_h', 'pull_v', 'hinge', 'core'],
  core: ['core', 'rotation', 'carry', 'core'],
};

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
      ? lightDay(slot, MONDAY)
      : heavyDay(slot, MONDAY, patterns, minutesPerSession, []);
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

export interface TemplateInput {
  sessionsPerWeek: number;
  /** What the two heavy days train. Placement is unaffected. */
  shape?: SessionShape;
  /** Which weekday the optional third session lands on. */
  thirdDay?: Weekday;
  /**
   * Weekdays to run at full effort. Absent means the app balances it — the
   * first two days are heavy and anything beyond them is light. An empty array
   * is a decision, not an absence: it means every session is light.
   */
  heavyWeekdays?: Weekday[];
  /** Weekdays a round is typically played; Sunday is only free when not golf. */
  golfWeekdays?: Weekday[];
  minutesPerSession?: number;
}

/** Weekdays beyond Mon and Tue that a session may actually use. */
export function availableExtraDays(golfWeekdays: Weekday[] = []): Weekday[] {
  return EXTRA_DAY_OPTIONS.filter(
    (weekday) => !FORBIDDEN_WEEKDAYS.includes(weekday) && !golfWeekdays.includes(weekday),
  );
}

/** The most sessions the calendar leaves room for. */
export function maxSessionsFor(golfWeekdays: Weekday[] = []): number {
  return 2 + availableExtraDays(golfWeekdays).length;
}

/**
 * The week, assigned from the template. Two sessions is Mon and Tue; a third
 * is the light day, on Wednesday unless another free day is chosen.
 */
const SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];

/** The weekdays a given number of sessions lands on, in calendar order. */
export function templateWeekdays(
  sessionsPerWeek: number,
  golfWeekdays: Weekday[] = [],
  thirdDay?: Weekday,
): Weekday[] {
  const wanted = Math.max(1, Math.min(sessionsPerWeek, MAX_SESSIONS));
  const anchors: Weekday[] = [MONDAY, TUESDAY];
  if (wanted <= 2) return anchors.slice(0, wanted);

  let extras = availableExtraDays(golfWeekdays);
  if (thirdDay !== undefined && extras.includes(thirdDay)) {
    extras = [thirdDay, ...extras.filter((weekday) => weekday !== thirdDay)];
  }
  return [...anchors, ...extras.slice(0, wanted - 2)].sort((a, b) => a - b);
}

export function templateWeek({
  sessionsPerWeek,
  shape = 'mixed',
  thirdDay,
  heavyWeekdays,
  golfWeekdays = [],
  minutesPerSession = 40,
}: TemplateInput): TemplateDay[] {
  const patterns = SHAPE_PATTERNS[shape];
  const weekdays = templateWeekdays(sessionsPerWeek, golfWeekdays, thirdDay);

  /*
   * Which days are full effort. Left to the app it is the first two, and
   * everything after them is light — four or five hard sessions a week is not
   * what a returning lifter with a weekend round recovers from. Chosen by
   * hand the choice stands, including choosing none: no day is compulsorily
   * heavy. Placement is still the template; only effort moves.
   */
  const chosen = heavyWeekdays?.filter((weekday) => weekdays.includes(weekday));
  const isHeavy = (weekday: Weekday, index: number) =>
    chosen === undefined ? index < 2 : chosen.includes(weekday);

  let heavySoFar = 0;
  let lightSoFar = 0;
  return weekdays.map((weekday, index) => {
    const slot = SLOTS[index] ?? 'Y';
    if (!isHeavy(weekday, index)) {
      const day = lightDay(slot, weekday, lightSoFar);
      lightSoFar += 1;
      return day;
    }
    // Heavy days alternate through the shape, so a third heavy day repeats the
    // first rather than inventing a pattern set nobody asked for.
    const set = heavySoFar % 2 === 0 ? patterns.a : patterns.b;
    heavySoFar += 1;
    return heavyDay(slot, weekday, set, minutesPerSession, golfWeekdays);
  });
}

/** True when a session may be scheduled on this weekday at all. */
export function weekdayAllowed(weekday: Weekday, golfWeekdays: Weekday[] = []): boolean {
  return !FORBIDDEN_WEEKDAYS.includes(weekday) && !golfWeekdays.includes(weekday);
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
}: {
  slot: DaySlot;
  weekday: Weekday;
  intensity: Intensity;
  index?: number;
  shape?: SessionShape;
  minutesPerSession?: number;
  golfWeekdays?: Weekday[];
}): TemplateDay {
  if (intensity === 'light') return lightDay(slot, weekday, index);
  const set = index % 2 === 0 ? SHAPE_PATTERNS[shape].a : SHAPE_PATTERNS[shape].b;
  return heavyDay(slot, weekday, set, minutesPerSession, golfWeekdays);
}
