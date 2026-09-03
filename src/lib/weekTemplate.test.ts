import { describe, expect, it } from 'vitest';
import {
  LIGHT_DAY_CUE,
  WORKOUT_FOCUSES,
  templateDayFor,
  weekdayAllowed,
  workoutTemplate,
} from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What is left of this file, and why it is so much shorter.                 */
/*                                                                           */
/*  Four hundred lines here tested a week-picking layer that no longer        */
/*  exists: templateWeek chose the weekdays itself, templateWeekdays laid     */
/*  them out, maxSessionsFor and availableExtraDays decided how many would    */
/*  fit, and generateBlock filled the lot in one call. The app has not worked */
/*  that way since placement became per-week and per-day — a workout is made, */
/*  then dropped on a date — so all of it was reachable only from these       */
/*  tests, and tests are not a reason to keep code.                          */
/*                                                                           */
/*  What survives is what the app still calls: one day's constraints on       */
/*  demand, and the one rule about which weekdays are allowed at all.        */
/* -------------------------------------------------------------------------- */

describe('which weekdays a session may sit on', () => {
  it('permits a Friday a lifter picks by hand', () => {
    /*
     * The old template never CHOSE Friday or Saturday, which was a preference
     * about laying out a week. It was never a rule about what may happen on
     * one — and while it was both, the week planner refused the days it had
     * just asked the lifter to pick.
     */
    expect(weekdayAllowed(5)).toBe(true);
    expect(weekdayAllowed(6)).toBe(true);
  });

  it('bars a session on a round, which is the one thing that does bar one', () => {
    expect(weekdayAllowed(6, [6])).toBe(false);
    expect(weekdayAllowed(7, [6, 7])).toBe(false);
    expect(weekdayAllowed(1, [6])).toBe(true);
  });
});

describe('what light means', () => {
  const light = templateDayFor({ slot: 'A', weekday: 3, intensity: 'light' });

  it('is two sets, not three', () => {
    expect(light.setsPerExercise).toBe(2);
  });

  it('shifts the rep range up', () => {
    expect(light.repShift.low).toBeGreaterThan(0);
    expect(light.repShift.high).toBeGreaterThan(0);
  });

  it('carries the effort cue', () => {
    expect(light.effortCue).toBe(LIGHT_DAY_CUE);
    expect(LIGHT_DAY_CUE).toMatch(/3-4 reps/);
  });

  it('excludes grip-heavy and heavy spinal work', () => {
    expect(light.excludeGripHigh).toBe(true);
    expect(light.excludeSpinalHigh).toBe(true);
  });

  it('gets a 25 minute budget and at most four exercises', () => {
    expect(light.minutesBudget).toBe(25);
    expect(light.maxExercises).toBe(4);
  });
});

describe('what heavy means', () => {
  it('is three sets, five exercises and the session budget it was given', () => {
    const heavy = templateDayFor({
      slot: 'A',
      weekday: 1,
      intensity: 'heavy',
      minutesPerSession: 40,
    });
    expect(heavy.setsPerExercise).toBe(3);
    expect(heavy.maxExercises).toBe(5);
    expect(heavy.minutesBudget).toBe(40);
    expect(heavy.repShift).toEqual({ low: 0, high: 0 });
  });

  it('loses grip work inside the golf buffer whatever its intensity', () => {
    // Thursday is two days from a Saturday round.
    expect(
      templateDayFor({ slot: 'A', weekday: 4, intensity: 'heavy', golfWeekdays: [6] })
        .excludeGripHigh,
    ).toBe(true);
    expect(
      templateDayFor({ slot: 'A', weekday: 1, intensity: 'heavy', golfWeekdays: [6] })
        .excludeGripHigh,
    ).toBe(false);
  });
});

describe('templateDayFor honours a stored focus', () => {
  const placed = (over: Record<string, unknown> = {}) =>
    templateDayFor({ slot: 'A', weekday: 3, intensity: 'light', ...over });

  it('asks for the same patterns creating a workout asked for', () => {
    for (const focus of WORKOUT_FOCUSES) {
      for (const intensity of ['heavy', 'light'] as const) {
        const created = workoutTemplate({ slot: 'A', focus, intensity });
        const regenerated = templateDayFor({ slot: 'A', weekday: 3, intensity, focus });
        expect(regenerated.patterns, `${focus}/${intensity}`).toEqual(created.patterns);
      }
    }
  });

  it('gives an upper-body focus upper-body patterns, not the weekday default', () => {
    expect(placed({ focus: 'upper' }).patterns).toEqual([
      'pull_h',
      'pull_v',
      'push_h',
      'push_v',
      'core',
    ]);
    // The Wednesday light default, which is what it used to hand back.
    expect(placed().patterns).toEqual(['squat', 'push_h', 'pull_h', 'rotation']);
  });

  it('distinguishes every focus, on a heavy day too', () => {
    const sets = WORKOUT_FOCUSES.map((focus) =>
      templateDayFor({ slot: 'A', weekday: 1, intensity: 'heavy', focus }).patterns.join(','),
    );
    expect(new Set(sets).size).toBe(WORKOUT_FOCUSES.length);
  });

  it('leaves placement to placement — the focus decides what, not what is excluded', () => {
    // Grip exclusion is derived from the weekday and the golf calendar, so it
    // must not change just because a focus was supplied.
    const golf = { golfWeekdays: [6 as const], intensity: 'heavy' as const };
    const withFocus = templateDayFor({ slot: 'A', weekday: 5, focus: 'pull', ...golf });
    const without = templateDayFor({ slot: 'A', weekday: 5, ...golf });
    expect(withFocus.excludeGripHigh).toBe(without.excludeGripHigh);
    expect(withFocus.excludeGripHigh).toBe(true); // Friday, inside the buffer
    expect(withFocus.setsPerExercise).toBe(without.setsPerExercise);
    expect(withFocus.minutesBudget).toBe(without.minutesBudget);
  });

  it('falls back to inference for a workout made before focus was stored', () => {
    const legacy = templateDayFor({ slot: 'A', weekday: 1, intensity: 'heavy', index: 0 });
    expect(legacy.patterns.length).toBeGreaterThan(0);
    expect(legacy.intensity).toBe('heavy');
  });

  it('keeps the light-day rep shift and effort cue whatever the focus', () => {
    const day = placed({ focus: 'pull' });
    expect(day.repShift).toEqual({ low: 4, high: 5 });
    expect(day.effortCue).toBe(LIGHT_DAY_CUE);
    expect(day.minutesBudget).toBe(25);
  });
});
