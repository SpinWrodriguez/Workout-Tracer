import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { generateBlock } from './blockBuilder';
import {
  DEFAULT_THIRD_DAY,
  FORBIDDEN_WEEKDAYS,
  LIGHT_DAY_CUE,
  LIGHT_DAY_MINUTES,
  WORKOUT_FOCUSES,
  availableExtraDays,
  maxSessionsFor,
  templateDayFor,
  templateWeek,
  templateWeekdays,
  weekdayAllowed,
  workoutTemplate,
} from './weekTemplate';
import { sessionMinutes } from './blockValidation';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

const build = (sessionsPerWeek: number, over: Record<string, unknown> = {}) =>
  generateBlock({
    blockId: 'b1',
    exercises: EXERCISES,
    focusMuscles: [],
    sessionsPerWeek,
    golfWeekdays: [6],
    minutesPerSession: 40,
    hasHistory: false,
    laddersFor: (exercise) => ladderFor(exercise, DEFAULT_INVENTORY),
    ...over,
  });

describe('the week is a template, not a decision', () => {
  it('puts two sessions on Monday and Tuesday', () => {
    const week = templateWeek({ sessionsPerWeek: 2 });
    expect(week.map((day) => [day.slot, day.weekdayLabel, day.intensity])).toEqual([
      ['A', 'Mon', 'heavy'],
      ['B', 'Tue', 'heavy'],
    ]);
  });

  it('adds Wednesday as the light third session by default', () => {
    const week = templateWeek({ sessionsPerWeek: 3 });
    expect(week).toHaveLength(3);
    expect(week[2]).toMatchObject({ slot: 'C', weekdayLabel: 'Wed', intensity: 'light' });
    expect(DEFAULT_THIRD_DAY).toBe(3);
  });

  it('offers Thursday for the third session instead', () => {
    const week = templateWeek({ sessionsPerWeek: 3, thirdDay: 4 });
    expect(week[2]?.weekdayLabel).toBe('Thu');
  });

  it('never CHOOSES Friday or Saturday for a session', () => {
    expect(FORBIDDEN_WEEKDAYS).toEqual([5, 6]);
    expect(availableExtraDays()).not.toContain(5);
    expect(availableExtraDays()).not.toContain(6);
    // A Friday asked for explicitly is refused, not honoured.
    expect(templateWeek({ sessionsPerWeek: 3, thirdDay: 5 })[2]?.weekdayLabel).toBe('Wed');
  });

  it('still permits a Friday a lifter picks by hand', () => {
    /*
     * The template not choosing Friday is a preference about laying out a week.
     * It is not a rule about what may happen on one — and while it was both,
     * the week planner refused the days it had just asked the lifter to pick.
     */
    expect(weekdayAllowed(5)).toBe(true);
  });

  it('bars a session on a round, which is the one thing that does bar one', () => {
    expect(weekdayAllowed(6, [6])).toBe(false);
    expect(weekdayAllowed(7, [6, 7])).toBe(false);
    expect(availableExtraDays([6])).toContain(7);
    expect(availableExtraDays([6, 7])).not.toContain(7);
  });

  it('falls back off Wednesday when Wednesday is somehow a round', () => {
    expect(templateWeek({ sessionsPerWeek: 3, golfWeekdays: [3, 6] })[2]?.weekdayLabel).toBe('Thu');
  });
});

describe('pattern targets per day', () => {
  it('gives session A the hinge and both pulls, session B the squat and presses', () => {
    const week = templateWeek({ sessionsPerWeek: 2 });
    expect(week[0]?.patterns).toEqual(['hinge', 'pull_h', 'pull_v', 'core']);
    expect(week[1]?.patterns).toEqual(['squat', 'push_h', 'push_v', 'core']);
  });

  it('emphasises rotation on the light day', () => {
    expect(templateWeek({ sessionsPerWeek: 3 })[2]?.patterns).toContain('rotation');
  });
});

describe('what light means', () => {
  const light = templateWeek({ sessionsPerWeek: 3 })[2]!;

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
    expect(light.minutesBudget).toBe(LIGHT_DAY_MINUTES);
    expect(LIGHT_DAY_MINUTES).toBe(25);
    expect(light.maxExercises).toBe(4);
  });
});

describe('a generated block obeys the template', () => {
  it('never places a session on a forbidden day', () => {
    for (const sessions of [2, 3]) {
      for (const day of build(sessions).days) {
        expect(FORBIDDEN_WEEKDAYS, `day ${day.slot}`).not.toContain(day.weekday);
      }
    }
  });

  it('keeps all grip-heavy work on Monday or Tuesday', () => {
    const gripDays = build(3).days.filter((day) =>
      day.exercises.some((entry) => byId.get(entry.exerciseId)?.gripLoad === 'high'),
    );
    expect(gripDays.length).toBeGreaterThan(0);
    for (const day of gripDays) {
      expect([1, 2], `grip work landed on ${day.weekdayLabel}`).toContain(day.weekday);
    }
  });

  it('builds a light Wednesday that honours every light rule', () => {
    const block = build(3);
    const light = block.days.find((day) => day.intensity === 'light');
    expect(light).toBeDefined();
    expect(light?.weekdayLabel).toBe('Wed');
    expect(light?.effortCue).toBe(LIGHT_DAY_CUE);
    expect(light?.exercises.length).toBeLessThanOrEqual(4);
    expect(sessionMinutes(light!.exercises, byId)).toBeLessThanOrEqual(LIGHT_DAY_MINUTES);
    for (const entry of light?.exercises ?? []) {
      const exercise = byId.get(entry.exerciseId)!;
      expect(entry.targetSets, exercise.name).toBeLessThanOrEqual(2);
      expect(exercise.gripLoad, exercise.name).not.toBe('high');
      expect(exercise.spinalLoad, exercise.name).not.toBe('high');
    }
  });

  it('prescribes higher reps on the light day than the heavy ones', () => {
    const block = build(3);
    const light = block.days.find((day) => day.intensity === 'light')!;
    const heavy = block.days.find((day) => day.intensity === 'heavy')!;
    const mean = (day: typeof light) =>
      day.exercises.reduce((n, e) => n + (e.repRangeLow + e.repRangeHigh) / 2, 0) /
      day.exercises.length;
    expect(mean(light)).toBeGreaterThan(mean(heavy));
  });

  it('surfaces the light session as a warning so it is never a surprise', () => {
    expect(build(3).warnings.join(' ')).toMatch(/light session/);
  });

  it('passes its own validator at two and three sessions', () => {
    expect(build(2).violations).toEqual([]);
    expect(build(3).violations).toEqual([]);
  });

  it('respects a 30 minute budget as readily as a 60 minute one', () => {
    for (const minutes of [30, 40, 60]) {
      for (const day of build(2, { minutesPerSession: minutes }).days) {
        expect(day.estimatedMinutes, `${minutes} min budget`).toBeLessThanOrEqual(minutes);
      }
    }
  });

  it('never returns an empty block', () => {
    for (const sessions of [2, 3]) {
      const block = build(sessions);
      expect(block.days.length).toBe(sessions);
      for (const day of block.days) expect(day.exercises.length).toBeGreaterThan(0);
    }
  });
});

describe('explosive work leads the session', () => {
  it('orders an explosive lift first, ahead even of the hinge', () => {
    // Traps and glutes pull the kettlebell high pull into session A.
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['traps', 'glutes', 'hamstrings'],
      sessionsPerWeek: 3,
      golfWeekdays: [6],
      minutesPerSession: 40,
      hasHistory: true,
      laddersFor: (exercise) => ladderFor(exercise, DEFAULT_INVENTORY),
    });

    let sawOne = false;
    for (const day of block.days) {
      const index = day.exercises.findIndex((e) => byId.get(e.exerciseId)?.isExplosive);
      if (index < 0) continue;
      sawOne = true;
      expect(index, `${day.slot}: explosive work is not first`).toBe(0);
    }
    expect(sawOne, 'no explosive exercise was programmed at all').toBe(true);
  });

  it('never programmes mobility as a working set', () => {
    for (const sessions of [2, 3]) {
      for (const day of build(sessions).days) {
        for (const entry of day.exercises) {
          expect(byId.get(entry.exerciseId)?.isMobility, entry.exerciseId).toBe(false);
        }
      }
    }
  });

  it('draws the light rotational slot from the new landmine and cable work', () => {
    const light = build(3).days.find((day) => day.intensity === 'light');
    const rotation = light?.exercises.find(
      (entry) => byId.get(entry.exerciseId)?.pattern === 'rotation',
    );
    expect(rotation).toBeDefined();
    expect([
      'lm_rotational_press',
      'lm_scoop',
      'cb_rotational_row',
      'cb_pallof_rotation',
      'cb_punch',
    ]).toContain(rotation?.exerciseId);
  });
});

describe('four and five sessions', () => {
  it('fills Wed, Thu and Sun after the heavy pair', () => {
    expect(templateWeek({ sessionsPerWeek: 4, golfWeekdays: [6] }).map((d) => d.weekdayLabel))
      .toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    expect(templateWeek({ sessionsPerWeek: 5, golfWeekdays: [6] }).map((d) => d.weekdayLabel))
      .toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Sun']);
  });

  it('keeps only Mon and Tue heavy however many sessions are asked for', () => {
    const week = templateWeek({ sessionsPerWeek: 5, golfWeekdays: [6] });
    expect(week.filter((d) => d.intensity === 'heavy').map((d) => d.slot)).toEqual(['A', 'B']);
    expect(week.filter((d) => d.intensity === 'light').map((d) => d.slot)).toEqual(['C', 'X', 'Y']);
  });

  it('caps at what the golf calendar leaves free', () => {
    expect(maxSessionsFor([6])).toBe(5);
    // Playing both weekend days costs the Sunday slot.
    expect(maxSessionsFor([6, 7])).toBe(4);
    expect(templateWeek({ sessionsPerWeek: 5, golfWeekdays: [6, 7] })).toHaveLength(4);
  });

  it('says so when it cannot place every session asked for', () => {
    const block = build(5, { golfWeekdays: [6, 7] });
    expect(block.days).toHaveLength(4);
    expect(block.warnings.join(' ')).toMatch(/Only 4 of 5 sessions/);
  });

  it('still validates cleanly at four and five', () => {
    expect(build(4).violations).toEqual([]);
    expect(build(5).violations).toEqual([]);
  });

  it('strips grip work from any extra day inside the buffer', () => {
    for (const day of build(5).days) {
      for (const entry of day.exercises) {
        if (byId.get(entry.exerciseId)?.gripLoad === 'high') {
          expect([1, 2], `grip work on ${day.weekdayLabel}`).toContain(day.weekday);
        }
      }
    }
  });
});

describe('session shape', () => {
  it('splits the heavy pair upper and lower on request', () => {
    const week = templateWeek({ sessionsPerWeek: 3, shape: 'upper_lower' });
    expect(week[0]?.patterns).toEqual(['pull_h', 'pull_v', 'push_h', 'push_v', 'core']);
    expect(week[1]?.patterns).toEqual(['squat', 'hinge', 'squat', 'core']);
    // The light day stays full body whatever the heavy pair does.
    expect(week[2]?.patterns).toEqual(['squat', 'push_h', 'pull_h', 'rotation']);
  });

  it('builds an upper Monday and a lower Tuesday', () => {
    const block = build(3, { shape: 'upper_lower' });
    const LOWER = ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'];
    const isLower = (id: string) =>
      byId.get(id)?.primaryMuscles.some((m) => LOWER.includes(m)) ?? false;

    const upperDay = block.days.find((d) => d.slot === 'A')!;
    const lowerDay = block.days.find((d) => d.slot === 'B')!;
    expect(upperDay.exercises.every((e) => !isLower(e.exerciseId))).toBe(true);
    expect(lowerDay.exercises.some((e) => isLower(e.exerciseId))).toBe(true);
  });

  it('leaves the week valid under either shape', () => {
    expect(build(3, { shape: 'mixed' }).violations).toEqual([]);
    expect(build(3, { shape: 'upper_lower' }).violations).toEqual([]);
  });
});

describe('volume never collapses to single sets', () => {
  it('keeps every exercise at two sets or more, even at five sessions', () => {
    for (const sessions of [2, 3, 4, 5]) {
      for (const day of build(sessions).days) {
        for (const entry of day.exercises) {
          expect(entry.targetSets, `${sessions} sessions, ${entry.exerciseId}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('says plainly when the weekly target will not stretch that far', () => {
    expect(build(5).warnings.join(' ')).toMatch(/does not stretch to 5 sessions/);
    expect(build(2).warnings.join(' ')).not.toMatch(/does not stretch/);
  });

  it('takes sets off the light days before the heavy ones', () => {
    const block = build(5, { weeklySetTarget: 40 });
    const heavy = block.days.filter((d) => d.intensity === 'heavy');
    const light = block.days.filter((d) => d.intensity === 'light');
    const mean = (days: typeof heavy) =>
      days.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.targetSets, 0), 0) /
      days.reduce((n, d) => n + d.exercises.length, 0);
    expect(mean(heavy)).toBeGreaterThanOrEqual(mean(light));
  });
});

describe('choosing the heavy days by hand', () => {
  it('lists the weekdays a session count lands on', () => {
    expect(templateWeekdays(2, [6])).toEqual([1, 2]);
    expect(templateWeekdays(4, [6])).toEqual([1, 2, 3, 4]);
    expect(templateWeekdays(5, [6])).toEqual([1, 2, 3, 4, 7]);
  });

  it('balances it when nothing is chosen', () => {
    const week = templateWeek({ sessionsPerWeek: 4, golfWeekdays: [6] });
    expect(week.map((d) => d.intensity)).toEqual(['heavy', 'heavy', 'light', 'light']);
  });

  it('honours the chosen days instead', () => {
    const week = templateWeek({
      sessionsPerWeek: 4,
      golfWeekdays: [6],
      heavyWeekdays: [1, 4],
    });
    expect(week.map((d) => [d.weekdayLabel, d.intensity])).toEqual([
      ['Mon', 'heavy'],
      ['Tue', 'light'],
      ['Wed', 'light'],
      ['Thu', 'heavy'],
    ]);
  });

  it('keeps slots in calendar order whatever the intensities', () => {
    const week = templateWeek({ sessionsPerWeek: 5, golfWeekdays: [6], heavyWeekdays: [7] });
    expect(week.map((d) => d.slot)).toEqual(['A', 'B', 'C', 'X', 'Y']);
    expect(week.find((d) => d.slot === 'Y')?.intensity).toBe('heavy');
  });

  it('still strips grip work from a heavy day inside the buffer', () => {
    // Thursday is two days from a Saturday round, so it loses grip work even
    // when the user calls it heavy.
    const week = templateWeek({ sessionsPerWeek: 4, golfWeekdays: [6], heavyWeekdays: [4] });
    const thursday = week.find((d) => d.weekdayLabel === 'Thu');
    expect(thursday?.intensity).toBe('heavy');
    expect(thursday?.excludeGripHigh).toBe(true);
  });

  it('alternates the shape across heavy days rather than repeating one', () => {
    const week = templateWeek({
      sessionsPerWeek: 4,
      shape: 'upper_lower',
      golfWeekdays: [6],
      heavyWeekdays: [1, 2, 3],
    });
    const heavy = week.filter((d) => d.intensity === 'heavy');
    expect(heavy[0]?.patterns).toContain('pull_v');
    expect(heavy[1]?.patterns).toContain('squat');
    expect(heavy[2]?.patterns).toContain('pull_v');
  });

  it('treats an omitted choice as auto and an empty one as a decision', () => {
    // Absent: the app balances it.
    expect(
      templateWeek({ sessionsPerWeek: 3, golfWeekdays: [6] }).map((d) => d.intensity),
    ).toEqual(['heavy', 'heavy', 'light']);
    // Empty: every session is light. No day is compulsorily heavy.
    expect(
      templateWeek({ sessionsPerWeek: 3, golfWeekdays: [6], heavyWeekdays: [] }).map(
        (d) => d.intensity,
      ),
    ).toEqual(['light', 'light', 'light']);
  });

  it('drops a chosen day that is not in the week rather than falling back', () => {
    // Sunday is not in a two-session week, so nothing is left heavy.
    const week = templateWeek({ sessionsPerWeek: 2, golfWeekdays: [6], heavyWeekdays: [7] });
    expect(week.map((d) => d.intensity)).toEqual(['light', 'light']);
  });

  it('lets Monday or Tuesday be light', () => {
    const week = templateWeek({ sessionsPerWeek: 3, golfWeekdays: [6], heavyWeekdays: [3] });
    expect(week.map((d) => [d.weekdayLabel, d.intensity])).toEqual([
      ['Mon', 'light'],
      ['Tue', 'light'],
      ['Wed', 'heavy'],
    ]);
  });

  it('still covers every pattern when the whole week is light', () => {
    const block = build(3, { heavyWeekdays: [] });
    expect(block.violations.map((v) => v.code)).not.toContain('pattern_coverage');
    expect(block.warnings.join(' ')).toMatch(/deload/);
    for (const day of block.days) {
      expect(day.intensity).toBe('light');
      for (const entry of day.exercises) expect(entry.targetSets).toBe(2);
    }
  });

  it('generates a valid block with hand-picked heavy days', () => {
    expect(build(4, { heavyWeekdays: [1, 4] }).violations).toEqual([]);
  });
});

describe('warnings match the week that was actually built', () => {
  it('names every light day, not just the first', () => {
    const warning = build(5).warnings.find((w) => w.includes('light session'));
    expect(warning).toMatch(/Wed and Thu and Sun are light sessions/);
  });

  it('says deload instead of naming light days when they are all light', () => {
    const warnings = build(3, { heavyWeekdays: [] }).warnings.join(' ');
    expect(warnings).toMatch(/deload/);
    expect(warnings).not.toMatch(/is a light session|are light sessions/);
  });

  it('never prescribes a single-value rep range anywhere in a week', () => {
    for (const sessions of [2, 3, 4, 5]) {
      for (const heavy of [undefined, [] as number[]]) {
        for (const day of build(sessions, { heavyWeekdays: heavy }).days) {
          for (const entry of day.exercises) {
            expect(
              entry.repRangeHigh,
              `${entry.exerciseId} at ${sessions} sessions`,
            ).toBeGreaterThan(entry.repRangeLow);
          }
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  A workout's focus has to survive being regenerated.                       */
/*                                                                            */
/*  It did not: creation asked workoutTemplate() for the focus's patterns,     */
/*  then the focus was dropped, and regenerating re-inferred the patterns from */
/*  the weekday. An "Upper Body + Core" workout placed on a Wednesday came     */
/*  back with a Bulgarian split squat at the top of it, every single press.    */
/* -------------------------------------------------------------------------- */

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
    expect(day.minutesBudget).toBe(LIGHT_DAY_MINUTES);
  });
});
