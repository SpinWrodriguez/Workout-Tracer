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
