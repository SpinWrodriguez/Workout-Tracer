import type { Exercise, GolfDay } from '../db/types';
import { daysBetween, fromIsoDate, shiftIso, toIsoDate, weekStart } from './format';

/* -------------------------------------------------------------------------- */
/*  The golf rule — spec Phase 3, and the reason this app exists.              */
/*                                                                            */
/*  Grip, lat and forearm work within three days of a round causes early wrist */
/*  release and arms-first sequencing in the swing. So high-grip work must not  */
/*  land in the three days before a round, or on the day itself.               */
/*                                                                            */
/*  The rule is one-directional. Training after a round is fine; it is the      */
/*  approach to the round that has to be protected.                            */
/* -------------------------------------------------------------------------- */

export const GRIP_BUFFER_DAYS = 3;

/** ISO weekday: Monday 1 … Sunday 7. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function weekdayOf(iso: string): Weekday {
  const day = fromIsoDate(iso).getDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as Weekday;
}

/** The date of `weekday` in the Monday-start week containing `iso`. */
export function dateOfWeekday(iso: string, weekday: Weekday): string {
  return shiftIso(weekStart(iso), weekday - 1);
}

/* --- the rule ------------------------------------------------------------- */

export interface GripConflict {
  golfDate: string;
  /** 0 = the round is that same day, 1 = the round is tomorrow. */
  daysBefore: number;
}

/**
 * The soonest round that `dateIso` falls foul of, if any. Only rounds ahead of
 * the date count, and only within the buffer.
 */
export function gripConflictOn(dateIso: string, golfDates: string[]): GripConflict | undefined {
  let best: GripConflict | undefined;
  for (const golfDate of golfDates) {
    const daysBefore = daysBetween(dateIso, golfDate);
    if (daysBefore < 0 || daysBefore > GRIP_BUFFER_DAYS) continue;
    if (!best || daysBefore < best.daysBefore) best = { golfDate, daysBefore };
  }
  return best;
}

/**
 * The rule in a sentence, for a date that falls in a buffer — or undefined for
 * one that does not.
 *
 * The buffer was silent everywhere it acted. Asking for a Thursday workout two
 * days before a Saturday round quietly produced a session with no pulling in
 * it, and nothing on any screen said why: the constraint reaches the model as
 * a bare prohibition, deliberately, because a model told the reason starts
 * reasoning about the calendar. The lifter is not a model.
 */
export function gripBufferNote(dateIso: string, golfDates: string[]): string | undefined {
  const conflict = gripConflictOn(dateIso, golfDates);
  if (!conflict) return undefined;
  const when =
    conflict.daysBefore === 0
      ? 'Golf today'
      : conflict.daysBefore === 1
        ? 'Golf tomorrow'
        : `Golf in ${conflict.daysBefore} days`;
  return `${when} (${WEEKDAY_LABEL[weekdayOf(conflict.golfDate)]}) — no grip, lat or forearm work.`;
}

export function isGripSafe(dateIso: string, golfDates: string[]): boolean {
  return gripConflictOn(dateIso, golfDates) === undefined;
}

/** Which weekdays can carry grip work, given the weekdays golf is played. */
export function gripSafeWeekdays(golfWeekdays: Weekday[]): Weekday[] {
  if (golfWeekdays.length === 0) return [...WEEKDAYS];
  return WEEKDAYS.filter((day) =>
    golfWeekdays.every((golf) => {
      // Distance forward around a repeating week, so Sunday reads as six days
      // before next Saturday rather than one day after this one.
      const forward = (golf - day + 7) % 7;
      return forward > GRIP_BUFFER_DAYS;
    }),
  );
}

/* --- session-level warnings ----------------------------------------------- */

export type WarningLevel = 'block' | 'warn' | 'note';

export interface RuleWarning {
  level: WarningLevel;
  exerciseId?: string;
  title: string;
  detail: string;
}

/**
 * Hinges are a form risk when fatigued, so the spec asks for a nudge when one
 * is scheduled late in a session rather than fresh.
 */
export const HINGE_LATE_POSITION = 3; // fourth exercise onward
export const HINGE_FATIGUE_SETS = 12;

export interface SessionShape {
  date: string;
  /** In the order they will be performed. */
  exercises: { exerciseId: string; loggedSets: number }[];
}

export function sessionWarnings(
  session: SessionShape,
  exercisesById: Map<string, Exercise>,
  golfDates: string[],
): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const conflict = gripConflictOn(session.date, golfDates);

  let setsBefore = 0;
  session.exercises.forEach((entry, index) => {
    const exercise = exercisesById.get(entry.exerciseId);
    if (!exercise) return;

    if (exercise.gripLoad === 'high' && conflict) {
      warnings.push({
        level: 'warn',
        exerciseId: exercise.id,
        title: `${exercise.name} is high grip load`,
        detail:
          conflict.daysBefore === 0
            ? `You are playing golf today. Grip and lat work now will show up in the swing.`
            : `Golf is ${conflict.daysBefore} day${conflict.daysBefore === 1 ? '' : 's'} away (${
                conflict.golfDate
              }). Keep grip, lat and forearm work at least ${GRIP_BUFFER_DAYS} days clear of a round.`,
      });
    }

    if (
      exercise.isHinge &&
      (index >= HINGE_LATE_POSITION || setsBefore >= HINGE_FATIGUE_SETS)
    ) {
      warnings.push({
        level: 'note',
        exerciseId: exercise.id,
        title: `${exercise.name} is a hinge, scheduled late`,
        detail: `${setsBefore} sets in already. Hinges belong early, while the position still holds.`,
      });
    }

    setsBefore += entry.loggedSets;
  });

  return warnings;
}

/* --- weekly view ---------------------------------------------------------- */

export type DayKind = 'gym' | 'golf' | 'gym_and_golf' | 'rest';

export interface WeekDay {
  date: string;
  weekday: Weekday;
  kind: DayKind;
  golf?: GolfDay;
  sessionIds: string[];
  /** High-grip exercises logged or planned that day. */
  highGripExercises: string[];
  gripConflict?: GripConflict;
  /** True when high-grip work actually lands inside a conflict window. */
  violation: boolean;
  /** No round ahead within the buffer — grip work is fine here. */
  gripSafe: boolean;
}

export interface WeekInput {
  anchorDate: string;
  golfDays: GolfDay[];
  sessions: { id: string; date: string; exerciseIds: string[] }[];
  exercisesById: Map<string, Exercise>;
}

export function buildWeek({
  anchorDate,
  golfDays,
  sessions,
  exercisesById,
}: WeekInput): WeekDay[] {
  const start = weekStart(anchorDate);
  // Rounds beyond the week still constrain its last days, so look ahead.
  const golfDates = golfDays.map((g) => g.date);
  const golfByDate = new Map(golfDays.map((g) => [g.date, g]));

  return WEEKDAYS.map((weekday) => {
    const date = shiftIso(start, weekday - 1);
    const daySessions = sessions.filter((s) => s.date === date);
    const golf = golfByDate.get(date);
    const conflict = gripConflictOn(date, golfDates);

    const highGrip = [
      ...new Set(
        daySessions
          .flatMap((s) => s.exerciseIds)
          .filter((id) => exercisesById.get(id)?.gripLoad === 'high'),
      ),
    ];

    const kind: DayKind =
      daySessions.length > 0 && golf
        ? 'gym_and_golf'
        : golf
          ? 'golf'
          : daySessions.length > 0
            ? 'gym'
            : 'rest';

    return {
      date,
      weekday,
      kind,
      golf,
      sessionIds: daySessions.map((s) => s.id),
      highGripExercises: highGrip,
      gripConflict: conflict,
      violation: highGrip.length > 0 && conflict !== undefined,
      gripSafe: conflict === undefined,
    };
  });
}

/* --- calendar helpers ----------------------------------------------------- */

/** Golf weekdays inferred from the calendar, for the block builder. */
export function golfWeekdaysFrom(golfDays: GolfDay[]): Weekday[] {
  const counts = new Map<Weekday, number>();
  for (const day of golfDays) {
    const weekday = weekdayOf(day.date);
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => a - b);
}

export function monthGrid(anchorDate: string): string[] {
  const anchor = fromIsoDate(anchorDate);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = fromIsoDate(weekStart(toIsoDate(first)));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toIsoDate(d);
  });
}
