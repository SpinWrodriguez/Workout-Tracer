import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { generateBlock } from './blockBuilder';
import {
  DEFAULT_THIRD_DAY,
  FORBIDDEN_WEEKDAYS,
  LIGHT_DAY_CUE,
  LIGHT_DAY_MINUTES,
  availableExtraDays,
  maxSessionsFor,
  templateWeek,
  templateWeekdays,
  weekdayAllowed,
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

  it('never schedules a session on Friday or Saturday', () => {
    expect(FORBIDDEN_WEEKDAYS).toEqual([5, 6]);
    expect(weekdayAllowed(5)).toBe(false);
    expect(weekdayAllowed(6)).toBe(false);
    expect(availableExtraDays()).not.toContain(5);
    expect(availableExtraDays()).not.toContain(6);
    // A Friday asked for explicitly is refused, not honoured.
    expect(templateWeek({ sessionsPerWeek: 3, thirdDay: 5 })[2]?.weekdayLabel).toBe('Wed');
  });

  it('offers Sunday only when it is not a golf day', () => {
    expect(availableExtraDays([6])).toContain(7);
    expect(availableExtraDays([6, 7])).not.toContain(7);
    expect(weekdayAllowed(7, [6, 7])).toBe(false);
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

  it('ignores a chosen day that is not in the week', () => {
    const week = templateWeek({ sessionsPerWeek: 2, golfWeekdays: [6], heavyWeekdays: [7] });
    expect(week.map((d) => d.intensity)).toEqual(['heavy', 'heavy']);
  });

  it('generates a valid block with hand-picked heavy days', () => {
    expect(build(4, { heavyWeekdays: [1, 4] }).violations).toEqual([]);
  });
});
