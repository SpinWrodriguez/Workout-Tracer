import type { BlockExercise, Exercise } from '../db/types';
import { WEEKDAY_LABEL, type Weekday } from './golf';

/* -------------------------------------------------------------------------- */
/*  One line per workout on where it fits in a week.                          */
/*                                                                            */
/*  Read off the exercises, never typed: what a workout loads decides which    */
/*  days it can take. Heavy grip or a heavy spine keeps it off the day before  */
/*  a round; two lower days want a day between them; a golf-safe upper day    */
/*  can go anywhere, the eve of golf included. The line says that in words so */
/*  the order of a plan, and a moved workout, can be judged without opening   */
/*  the exercise list.                                                         */
/* -------------------------------------------------------------------------- */

export interface WorkoutGuide {
  /** 'Lower', 'Upper', 'Full body', or 'Core' by what the main work hits. */
  body: 'Lower' | 'Upper' | 'Full body' | 'Core';
  heavyLegs: boolean;
  grip: boolean;
  spine: boolean;
  /** Fine the day before a round: no heavy grip, no heavy spine. */
  golfSafe: boolean;
  /** Days the week can take it, given the usual golf weekdays. */
  fits: Weekday[];
  /** The whole thing in a sentence or two. */
  line: string;
}

const LOWER = new Set(['quads', 'glutes', 'hamstrings', 'adductors', 'calves']);
const UPPER = new Set([
  'chest', 'lats', 'upper_back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'traps', 'forearms',
]);

const dayList = (days: Weekday[]): string => {
  if (days.length === 7) return 'any day';
  if (days.length === 0) return 'no day';
  const names = days.map((d) => WEEKDAY_LABEL[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] as string);
};

export function workoutGuide(
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
  golfWeekdays: Weekday[] = [],
): WorkoutGuide | undefined {
  const rows = entries
    .map((row) => exercisesById.get(row.exerciseId))
    .filter((e): e is Exercise => e !== undefined);
  if (rows.length === 0) return undefined;

  let lower = 0;
  let upper = 0;
  for (const e of rows) {
    if (e.isMobility) continue;
    if (e.primaryMuscles.some((m) => LOWER.has(m))) lower += 1;
    if (e.primaryMuscles.some((m) => UPPER.has(m))) upper += 1;
  }
  const body: WorkoutGuide['body'] =
    lower === 0 && upper === 0 ? 'Core' : lower >= 2 && upper >= 2 ? 'Full body' : lower > upper ? 'Lower' : 'Upper';
  const heavyLegs = rows.some(
    (e) => (e.pattern === 'squat' || e.pattern === 'hinge') && e.spinalLoad === 'high' && !e.isExplosive,
  );
  const grip = rows.some((e) => e.gripLoad === 'high');
  const spine = rows.some((e) => e.spinalLoad === 'high');
  const golfSafe = !grip && !spine;

  // The eve of each golf weekday is out unless the workout is golf-safe.
  const eves = new Set(golfWeekdays.map((d) => (((d - 2 + 7) % 7) + 1) as Weekday));
  const fits = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((d) => golfSafe || !eves.has(d));

  const loads = [heavyLegs ? 'heavy legs' : '', grip ? 'grip' : '', spine && !heavyLegs ? 'heavy spine' : ''].filter(Boolean);
  const parts: string[] = [];
  if (golfSafe) {
    parts.push(`${body}, golf-safe: ${dayList(fits)}, the day before golf included.`);
  } else {
    const barred = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((d) => !fits.includes(d));
    parts.push(`${body}, ${loads.join(' and ')}: not ${dayList(barred)} (golf next day).`);
  }
  if (heavyLegs) parts.push('Keep a day between this and any other heavy lower day.');
  else if (body === 'Upper') parts.push('Fine the day after a lower day.');
  return { body, heavyLegs, grip, spine, golfSafe, fits, line: parts.join(' ') };
}
