import type { Exercise, GolfDay } from '../db/types';
import { daysBetween, fromIsoDate, shiftIso, toIsoDate, weekStart } from './format';

/* -------------------------------------------------------------------------- */
/*  The golf rule — spec Phase 3, and the reason this app exists.              */
/*                                                                            */
/*  Grip, lat and forearm work close to a round causes early wrist release and */
/*  arms-first sequencing in the swing. So high-grip work must not land on the  */
/*  round or on the day before it.                                            */
/*                                                                            */
/*  It was three days, which is most of a training week: on a Saturday round   */
/*  that took Wednesday, Thursday and Friday, so every pull in the week had to */
/*  fit into its first two days. The lifter's own read of their swing is that  */
/*  two days' clearance is plenty, and it is their swing. So the veto covers   */
/*  one day, and the day beyond it gets a heads-up instead — a round worth     */
/*  knowing about is not the same as a session worth refusing.                */
/*                                                                            */
/*  The rule is one-directional. Training after a round is fine; it is the      */
/*  approach to the round that has to be protected.                            */
/* -------------------------------------------------------------------------- */

/** Days before a round on which high-grip work is barred, plus the day itself. */
export const GRIP_BUFFER_DAYS = 1;

/**
 * How far out a round is still worth mentioning. Nothing is barred here: the
 * session is fine to do, and the note only says the round is close enough that
 * a heavy pull may show up in the swing.
 */
export const GRIP_ADVISORY_DAYS = 2;

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

/**
 * `blocked` bars high-grip work; `advised` permits it and says the round is
 * close. Callers must read this rather than treating any conflict as a veto.
 */
export type GripSeverity = 'blocked' | 'advised';

export interface GripConflict {
  golfDate: string;
  /** 0 = the round is that same day, 1 = the round is tomorrow. */
  daysBefore: number;
  severity: GripSeverity;
}

/**
 * The soonest round close enough to `dateIso` to matter, if any — barring or
 * merely worth mentioning, per `severity`. Only rounds ahead of the date count.
 */
export function gripConflictOn(dateIso: string, golfDates: string[]): GripConflict | undefined {
  let best: GripConflict | undefined;
  for (const golfDate of golfDates) {
    const daysBefore = daysBetween(dateIso, golfDate);
    if (daysBefore < 0 || daysBefore > GRIP_ADVISORY_DAYS) continue;
    const severity: GripSeverity = daysBefore <= GRIP_BUFFER_DAYS ? 'blocked' : 'advised';
    if (!best || daysBefore < best.daysBefore) best = { golfDate, daysBefore, severity };
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
export interface GripNote {
  text: string;
  /** So a screen can style information differently from an instruction. */
  severity: GripSeverity;
}

export function gripBufferNote(dateIso: string, golfDates: string[]): GripNote | undefined {
  const conflict = gripConflictOn(dateIso, golfDates);
  if (!conflict) return undefined;
  const when =
    conflict.daysBefore === 0
      ? 'Golf today'
      : conflict.daysBefore === 1
        ? 'Golf tomorrow'
        : `Golf in ${conflict.daysBefore} days`;
  const day = WEEKDAY_LABEL[weekdayOf(conflict.golfDate)];
  /* Two wordings for two different claims. Barred is an instruction; advised
     is information, and dressing information up as an instruction is how a
     rule stops being believed. */
  return {
    text:
      conflict.severity === 'blocked'
        ? `${when} (${day}) — no grip, lat or forearm work.`
        : `${when} (${day}) — may affect your swing.`,
    severity: conflict.severity,
  };
}

/** True when the rule permits high-grip work. An advisory day still does. */
export function isGripSafe(dateIso: string, golfDates: string[]): boolean {
  return gripConflictOn(dateIso, golfDates)?.severity !== 'blocked';
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
      const blocked = conflict.severity === 'blocked';
      warnings.push({
        /* A note, not a warning, on a day the rule allows: the badge has to
           match the claim or none of the badges get read. */
        level: blocked ? 'warn' : 'note',
        exerciseId: exercise.id,
        title: `${exercise.name} is high grip load`,
        detail:
          conflict.daysBefore === 0
            ? 'You are playing golf today. Grip and lat work now will show up in the swing.'
            : blocked
              ? `Golf is tomorrow (${conflict.golfDate}). Grip and lat work now will show up in the swing.`
              : `Golf is in ${conflict.daysBefore} days (${conflict.golfDate}). This may affect your swing.`,
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
      violation: highGrip.length > 0 && conflict?.severity === 'blocked',
      // Advised is not barred, so an advisory day is still a day for pulling.
      gripSafe: conflict?.severity !== 'blocked',
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
