import type { DaySlot, Exercise } from '../db/types';
import type { ExistingWorkout } from './aiWorkout';
import type { PlannedWeekDay } from '../components/WeekPlanSheet';
import { gripAllowed, spineAllowed } from './blockValidation';
import { weekdayOf, type Weekday } from './golf';

/* -------------------------------------------------------------------------- */
/*  Reuse before generating.                                                   */
/*                                                                            */
/*  A workout the lifter already built — same focus, same effort, clean        */
/*  against the day's calendar rules — is a better answer for a planned day    */
/*  than a freshly generated near-copy of it, and it costs nothing: no call,   */
/*  no tokens, no wait. Only the days nothing matches go to the model.         */
/*                                                                            */
/*  Deterministic on purpose. Asking the model whether to reuse would spend    */
/*  the money the reuse exists to save, and matching on focus + intensity is   */
/*  a fact the app can check, not a judgement.                                 */
/* -------------------------------------------------------------------------- */

export interface WeekReuse {
  /** Days answered from the shelf, with the workout that answers each. */
  reused: { day: PlannedWeekDay; slot: DaySlot; name: string }[];
  /** Days still needing a generated workout, in their original order. */
  toGenerate: PlannedWeekDay[];
}

/**
 * Matches each planned day against the existing workouts, first match wins.
 *
 * A candidate must match the day's focus AND intensity, hold at least one
 * exercise, and pass the day's own calendar rules — a light day or a
 * grip-buffered weekday must not inherit high-grip work just because it came
 * off the shelf; the shelf does not outrank the calendar. A workout already
 * placed this week (or claimed by an earlier day in this run) stays where it
 * is: one workout, one day.
 */
export function matchExistingWorkouts(
  days: PlannedWeekDay[],
  existing: ExistingWorkout[],
  exercisesById: Map<string, Exercise>,
  golfWeekdays: Weekday[],
  alreadyPlaced: Iterable<DaySlot>,
): WeekReuse {
  const claimed = new Set<DaySlot>(alreadyPlaced);
  const reused: WeekReuse['reused'] = [];
  const toGenerate: PlannedWeekDay[] = [];

  for (const day of days) {
    const light = day.intensity === 'light';
    const weekday = weekdayOf(day.date);
    const noHighGrip = light || !gripAllowed(weekday, golfWeekdays);
    const noHighSpine = light || !spineAllowed(weekday, golfWeekdays);

    const match = existing.find(
      (candidate) =>
        !claimed.has(candidate.slot) &&
        candidate.focus === day.focus &&
        candidate.intensity === day.intensity &&
        candidate.exerciseIds.length > 0 &&
        candidate.exerciseIds.every((id) => {
          const exercise = exercisesById.get(id);
          return (
            exercise !== undefined &&
            !(noHighGrip && exercise.gripLoad === 'high') &&
            !(noHighSpine && exercise.spinalLoad === 'high')
          );
        }),
    );

    if (match) {
      claimed.add(match.slot);
      reused.push({ day, slot: match.slot, name: match.name ?? match.slot });
    } else {
      toGenerate.push(day);
    }
  }

  return { reused, toGenerate };
}
