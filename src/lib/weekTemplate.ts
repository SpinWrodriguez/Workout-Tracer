import type { DaySlot, MovementPattern } from '../db/types';
import { WEEKDAY_LABEL, type Weekday } from './golf';

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

/** Candidate weekdays for the optional third session, in preference order. */
export const THIRD_DAY_OPTIONS: Weekday[] = [3, 4, 7]; // Wed, Thu, Sun
export const DEFAULT_THIRD_DAY: Weekday = 3; // Wed

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

/*
 * Session A carries the hinge and both pulls. Those are the grip-heavy
 * movements, and Monday is the furthest point in the week from a weekend
 * round, so this is where they belong. Session B takes the squat and the
 * presses, which need no grip at all.
 */
const SESSION_A_PATTERNS: MovementPattern[] = ['hinge', 'pull_h', 'pull_v', 'core'];
const SESSION_B_PATTERNS: MovementPattern[] = ['squat', 'push_h', 'push_v', 'core'];
const SESSION_C_PATTERNS: MovementPattern[] = ['rotation', 'squat', 'push_h', 'core'];

function heavyDay(slot: DaySlot, weekday: Weekday, patterns: MovementPattern[], minutes: number): TemplateDay {
  return {
    slot,
    weekday,
    weekdayLabel: WEEKDAY_LABEL[weekday],
    intensity: 'heavy',
    patterns,
    excludeGripHigh: false,
    excludeSpinalHigh: false,
    setsPerExercise: 3,
    repShift: { low: 0, high: 0 },
    minutesBudget: minutes,
    maxExercises: 5,
  };
}

function lightDay(weekday: Weekday): TemplateDay {
  return {
    slot: 'C',
    weekday,
    weekdayLabel: WEEKDAY_LABEL[weekday],
    intensity: 'light',
    patterns: SESSION_C_PATTERNS,
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
  /** Which weekday the optional third session lands on. */
  thirdDay?: Weekday;
  /** Weekdays a round is typically played; Sunday is only free when not golf. */
  golfWeekdays?: Weekday[];
  minutesPerSession?: number;
}

/** Third-session weekdays that are actually available given the golf pattern. */
export function availableThirdDays(golfWeekdays: Weekday[] = []): Weekday[] {
  return THIRD_DAY_OPTIONS.filter(
    (weekday) => !FORBIDDEN_WEEKDAYS.includes(weekday) && !golfWeekdays.includes(weekday),
  );
}

/**
 * The week, assigned from the template. Two sessions is Mon and Tue; a third
 * is the light day, on Wednesday unless another free day is chosen.
 */
export function templateWeek({
  sessionsPerWeek,
  thirdDay,
  golfWeekdays = [],
  minutesPerSession = 40,
}: TemplateInput): TemplateDay[] {
  const days: TemplateDay[] = [
    heavyDay('A', MONDAY, SESSION_A_PATTERNS, minutesPerSession),
    heavyDay('B', TUESDAY, SESSION_B_PATTERNS, minutesPerSession),
  ];

  if (sessionsPerWeek <= 2) return days.slice(0, Math.max(1, sessionsPerWeek));

  const options = availableThirdDays(golfWeekdays);
  const chosen =
    thirdDay !== undefined && options.includes(thirdDay)
      ? thirdDay
      : (options[0] ?? DEFAULT_THIRD_DAY);
  days.push(lightDay(chosen));
  return days;
}

/** True when a session may be scheduled on this weekday at all. */
export function weekdayAllowed(weekday: Weekday, golfWeekdays: Weekday[] = []): boolean {
  return !FORBIDDEN_WEEKDAYS.includes(weekday) && !golfWeekdays.includes(weekday);
}
