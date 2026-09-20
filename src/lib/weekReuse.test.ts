import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { ExistingWorkout } from './aiWorkout';
import type { Weekday } from './golf';
import { matchExistingWorkouts } from './weekReuse';

/*
 * The reuse pre-pass: a planned day whose focus and effort match a workout
 * already on the shelf takes that workout, and only the rest go to the model.
 * These pin the matching facts — focus, effort, the calendar, and one workout
 * one day — because every one of them is a way to silently hand the lifter
 * the wrong session.
 */

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
const GOLF_WEEKEND: Weekday[] = [6, 7];

/** 2026-09-14 is a Monday; the 18th the Friday before a weekend round. */
const MONDAY = '2026-09-14';
const FRIDAY = '2026-09-18';

const pullDay = { date: MONDAY, focus: 'pull', intensity: 'heavy' } as const;

const upperPull: ExistingWorkout = {
  slot: 'B',
  name: 'Upper Pull',
  focus: 'pull',
  intensity: 'heavy',
  // Pull-up carries gripLoad high, which is the calendar case below.
  exerciseIds: ['bw_pull_up', 'cb_seated_row'],
};

describe('reusing existing workouts for a planned week', () => {
  it('answers a matching day from the shelf instead of generating', () => {
    const { reused, toGenerate } = matchExistingWorkouts(
      [pullDay],
      [upperPull],
      byId,
      GOLF_WEEKEND,
      [],
    );
    expect(reused).toEqual([{ day: pullDay, slot: 'B', name: 'Upper Pull' }]);
    expect(toGenerate).toEqual([]);
  });

  it('matches on focus AND effort, not either alone', () => {
    const lightDay = { ...pullDay, intensity: 'light' } as const;
    const lowerDay = { ...pullDay, focus: 'lower' } as const;
    for (const day of [lightDay, lowerDay]) {
      const { reused, toGenerate } = matchExistingWorkouts(
        [day],
        [upperPull],
        byId,
        GOLF_WEEKEND,
        [],
      );
      expect(reused).toEqual([]);
      expect(toGenerate).toEqual([day]);
    }
  });

  it('never hands a grip-heavy workout to a day the calendar bans it on', () => {
    /* The Friday before a weekend round bans high grip work. The shelf does
       not outrank the calendar: this day generates fresh instead. */
    const friday = { ...pullDay, date: FRIDAY } as const;
    const { reused, toGenerate } = matchExistingWorkouts(
      [friday],
      [upperPull],
      byId,
      GOLF_WEEKEND,
      [],
    );
    expect(reused).toEqual([]);
    expect(toGenerate).toEqual([friday]);
  });

  it('places a workout once — a second matching day generates its own', () => {
    const tuesday = { ...pullDay, date: '2026-09-15' } as const;
    const { reused, toGenerate } = matchExistingWorkouts(
      [pullDay, tuesday],
      [upperPull],
      byId,
      GOLF_WEEKEND,
      [],
    );
    expect(reused.map((row) => row.slot)).toEqual(['B']);
    expect(toGenerate).toEqual([tuesday]);
  });

  it('leaves a workout already placed this week where it is', () => {
    const { reused, toGenerate } = matchExistingWorkouts(
      [pullDay],
      [upperPull],
      byId,
      GOLF_WEEKEND,
      ['B'],
    );
    expect(reused).toEqual([]);
    expect(toGenerate).toEqual([pullDay]);
  });

  it('never reuses an empty workout — a name with no exercises is not a session', () => {
    const empty: ExistingWorkout = { ...upperPull, exerciseIds: [] };
    const { reused } = matchExistingWorkouts([pullDay], [empty], byId, GOLF_WEEKEND, []);
    expect(reused).toEqual([]);
  });
});
