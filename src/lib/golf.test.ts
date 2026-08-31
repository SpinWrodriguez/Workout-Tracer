import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { GolfDay } from '../db/types';
import {
  GRIP_BUFFER_DAYS,
  buildWeek,
  gripConflictOn,
  gripSafeWeekdays,
  golfWeekdaysFrom,
  isGripSafe,
  sessionWarnings,
  weekdayOf,
} from './golf';
import { chooseTrainingWeekdays, generateBlock, patternOf } from './blockBuilder';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

/* Aug 2026: Mon 24, Tue 25, Wed 26, Thu 27, Fri 28, Sat 29, Sun 30. */
const MON = '2026-08-24';
const TUE = '2026-08-25';
const WED = '2026-08-26';
const THU = '2026-08-27';
const FRI = '2026-08-28';
const SAT = '2026-08-29';

const SATURDAY_GOLF: GolfDay[] = [{ date: SAT, status: 'planned', holes: 18 }];

describe('Phase 3 acceptance — the golf rule', () => {
  it('warns clearly about pull-ups on Friday with golf Saturday', () => {
    const warnings = sessionWarnings(
      { date: FRI, exercises: [{ exerciseId: 'bw_pull_up', loggedSets: 3 }] },
      byId,
      [SAT],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe('warn');
    expect(warnings[0]?.title).toMatch(/Pull-up is high grip load/);
    expect(warnings[0]?.detail).toMatch(/Golf is 1 day away/);
  });

  it('says nothing about the same pull-ups on Monday', () => {
    const warnings = sessionWarnings(
      { date: MON, exercises: [{ exerciseId: 'bw_pull_up', loggedSets: 3 }] },
      byId,
      [SAT],
    );
    expect(warnings).toEqual([]);
  });

  it('puts all high-grip work on Mon/Tue for two sessions plus Saturday golf', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['lats', 'quads', 'chest'],
      sessionsPerWeek: 2,
      golfWeekdays: [6],
    });

    const gripDays = block.days.filter((day) =>
      day.exercises.some((entry) => byId.get(entry.exerciseId)?.gripLoad === 'high'),
    );
    expect(gripDays.length).toBeGreaterThan(0);
    for (const day of gripDays) {
      expect([1, 2], `high-grip work landed on ${day.weekdayLabel}`).toContain(day.weekday);
    }
  });
});

describe('the buffer window', () => {
  it('covers the round itself and the three days before it', () => {
    expect(GRIP_BUFFER_DAYS).toBe(3);
    expect(gripConflictOn(SAT, [SAT])?.daysBefore).toBe(0);
    expect(gripConflictOn(FRI, [SAT])?.daysBefore).toBe(1);
    expect(gripConflictOn(THU, [SAT])?.daysBefore).toBe(2);
    expect(gripConflictOn(WED, [SAT])?.daysBefore).toBe(3);
    expect(gripConflictOn(TUE, [SAT])).toBeUndefined();
    expect(gripConflictOn(MON, [SAT])).toBeUndefined();
  });

  it('does not restrict the days after a round', () => {
    expect(isGripSafe('2026-08-30', [SAT])).toBe(true);
  });

  it('picks the soonest round when two are close together', () => {
    expect(gripConflictOn(THU, ['2026-08-30', SAT])?.golfDate).toBe(SAT);
  });

  it('leaves Sun, Mon and Tue as the grip-safe weekdays for Saturday golf', () => {
    expect(gripSafeWeekdays([6])).toEqual([1, 2, 7]);
  });

  it('shrinks the safe set to Mon and Tue when Sunday is played too', () => {
    // Wed is 3 days before Sat, and Sun is a round itself.
    expect(gripSafeWeekdays([6, 7])).toEqual([1, 2]);
  });

  it('leaves the whole week safe with no golf at all', () => {
    expect(gripSafeWeekdays([])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads weekdays as Monday 1 through Sunday 7', () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf(SAT)).toBe(6);
    expect(weekdayOf('2026-08-30')).toBe(7);
  });
});

describe('hinge fatigue note', () => {
  it('flags a hinge scheduled fourth or later', () => {
    const warnings = sessionWarnings(
      {
        date: MON,
        exercises: [
          { exerciseId: 'bb_bench_press', loggedSets: 3 },
          { exerciseId: 'bw_split_squat', loggedSets: 3 },
          { exerciseId: 'cb_fly', loggedSets: 3 },
          { exerciseId: 'bb_rdl', loggedSets: 3 },
        ],
      },
      byId,
      [],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe('note');
    expect(warnings[0]?.exerciseId).toBe('bb_rdl');
    expect(warnings[0]?.detail).toMatch(/9 sets in already/);
  });

  it('says nothing about a hinge done first', () => {
    const warnings = sessionWarnings(
      {
        date: MON,
        exercises: [
          { exerciseId: 'bb_rdl', loggedSets: 3 },
          { exerciseId: 'bb_bench_press', loggedSets: 3 },
        ],
      },
      byId,
      [],
    );
    expect(warnings).toEqual([]);
  });

  it('flags a hinge after a lot of volume even when it is third', () => {
    const warnings = sessionWarnings(
      {
        date: MON,
        exercises: [
          { exerciseId: 'bb_bench_press', loggedSets: 6 },
          { exerciseId: 'cb_fly', loggedSets: 6 },
          { exerciseId: 'bb_rdl', loggedSets: 3 },
        ],
      },
      byId,
      [],
    );
    expect(warnings.map((w) => w.exerciseId)).toEqual(['bb_rdl']);
  });
});

describe('weekly view', () => {
  const sessions = [
    { id: 's1', date: MON, exerciseIds: ['bw_pull_up', 'bb_bench_press'] },
    { id: 's2', date: FRI, exerciseIds: ['bw_pull_up'] },
  ];
  const week = buildWeek({
    anchorDate: WED,
    golfDays: SATURDAY_GOLF,
    sessions,
    exercisesById: byId,
  });

  it('labels every day of the Monday-start week', () => {
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.kind)).toEqual([
      'gym',
      'rest',
      'rest',
      'rest',
      'gym',
      'golf',
      'rest',
    ]);
  });

  it('flags the Friday session as a violation and leaves Monday clean', () => {
    expect(week.find((d) => d.date === MON)?.violation).toBe(false);
    expect(week.find((d) => d.date === FRI)?.violation).toBe(true);
    expect(week.find((d) => d.date === FRI)?.gripConflict?.daysBefore).toBe(1);
  });

  it('marks which days can carry grip work', () => {
    expect(week.filter((d) => d.gripSafe).map((d) => d.weekday)).toEqual([1, 2, 7]);
  });

  it('reads the golf weekdays back off the calendar', () => {
    expect(golfWeekdaysFrom(SATURDAY_GOLF)).toEqual([6]);
  });
});

describe('block builder', () => {
  it('spreads two sessions instead of stacking them, starting grip-safe', () => {
    expect(chooseTrainingWeekdays(2, [6])).toEqual([1, 4]);
    expect(chooseTrainingWeekdays(3, [6])).toEqual([1, 3, 5]);
    expect(chooseTrainingWeekdays(2, [])).toEqual([1, 4]);
  });

  it('never places high-grip work on a day inside the buffer', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['lats', 'upper_back'],
      sessionsPerWeek: 3,
      golfWeekdays: [6, 7],
    });
    for (const day of block.days) {
      for (const entry of day.exercises) {
        if (byId.get(entry.exerciseId)?.gripLoad === 'high') {
          expect(day.gripSafe, `${entry.exerciseId} on ${day.weekdayLabel}`).toBe(true);
        }
      }
    }
  });

  it('leads every session with the hinge when one is programmed', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['hamstrings', 'glutes'],
      sessionsPerWeek: 2,
      golfWeekdays: [6],
    });
    for (const day of block.days) {
      const hingeIndex = day.exercises.findIndex(
        (entry) => byId.get(entry.exerciseId)?.isHinge,
      );
      if (hingeIndex >= 0) expect(hingeIndex).toBe(0);
    }
  });

  it('only ever returns ids that exist in the curated table', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['chest'],
      sessionsPerWeek: 3,
      golfWeekdays: [6],
    });
    for (const day of block.days) {
      for (const entry of day.exercises) expect(byId.has(entry.exerciseId)).toBe(true);
    }
  });

  it('does not repeat an exercise across the week', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['quads'],
      sessionsPerWeek: 3,
      golfWeekdays: [6],
    });
    const ids = block.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps each session inside the 40-minute budget', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['chest', 'lats'],
      sessionsPerWeek: 2,
      golfWeekdays: [6],
      minutesPerSession: 40,
    });
    for (const day of block.days) expect(day.estimatedMinutes).toBeLessThanOrEqual(40);
  });

  it('says so when the calendar leaves no room for grip work', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: ['lats'],
      sessionsPerWeek: 2,
      golfWeekdays: [1, 3, 5, 7],
    });
    expect(block.warnings.join(' ')).toMatch(/no high-grip work can be placed/i);
    const ids = block.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids.every((id) => byId.get(id)?.gripLoad !== 'high')).toBe(true);
  });

  it('classifies the seed into sensible patterns', () => {
    expect(patternOf(byId.get('bb_rdl') as never)).toBe('hinge');
    expect(patternOf(byId.get('bb_back_squat') as never)).toBe('squat');
    expect(patternOf(byId.get('bb_bench_press') as never)).toBe('push');
    expect(patternOf(byId.get('cb_lat_pulldown') as never)).toBe('pull');
    expect(patternOf(byId.get('kb_suitcase_carry') as never)).toBe('carry');
    expect(patternOf(byId.get('bw_plank') as never)).toBe('core');
  });
});

describe('exercise selection quality', () => {
  it('picks compounds over isolation for the pull slot, even with no focus set', () => {
    const block = generateBlock({
      blockId: 'b1',
      exercises: EXERCISES,
      focusMuscles: [],
      sessionsPerWeek: 2,
      golfWeekdays: [6],
    });
    const ids = block.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    // A curl in place of a row was the old alphabetical tie-break failing.
    expect(ids).not.toContain('bb_curl');
    expect(ids.some((id) => ['bb_bent_over_row', 'cb_seated_row', 'cb_lat_pulldown'].includes(id)))
      .toBe(true);
  });
});
