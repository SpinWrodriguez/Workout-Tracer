import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { generateBlock } from './blockBuilder';
import {
  DEFAULT_THIRD_DAY,
  FORBIDDEN_WEEKDAYS,
  LIGHT_DAY_CUE,
  LIGHT_DAY_MINUTES,
  availableThirdDays,
  templateWeek,
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
    expect(availableThirdDays()).not.toContain(5);
    expect(availableThirdDays()).not.toContain(6);
    // A Friday asked for explicitly is refused, not honoured.
    expect(templateWeek({ sessionsPerWeek: 3, thirdDay: 5 })[2]?.weekdayLabel).toBe('Wed');
  });

  it('offers Sunday only when it is not a golf day', () => {
    expect(availableThirdDays([6])).toContain(7);
    expect(availableThirdDays([6, 7])).not.toContain(7);
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
