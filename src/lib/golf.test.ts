import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { GolfDay } from '../db/types';
import { shiftIso } from './format';
import {
  GRIP_ADVISORY_DAYS,
  GRIP_BUFFER_DAYS,
  buildWeek,
  gripBufferNote,
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
    expect(warnings[0]?.detail).toMatch(/Golf is tomorrow/);
  });

  it('only notes the same pull-ups two days out, where the rule allows them', () => {
    /* The rule was three days, which took the whole back half of the week for
       pulling. Two days' clearance is enough for this swing, so a Thursday
       pull before a Saturday round is a session to do with a heads-up, not one
       to refuse — and the badge has to say which. */
    const warnings = sessionWarnings(
      { date: THU, exercises: [{ exerciseId: 'bw_pull_up', loggedSets: 3 }] },
      byId,
      [SAT],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe('note');
    expect(warnings[0]?.detail).toMatch(/Golf is in 2 days/);
    expect(warnings[0]?.detail).toMatch(/may affect your swing/);
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
  it('bars the round itself and the day before it', () => {
    expect(GRIP_BUFFER_DAYS).toBe(1);
    expect(gripConflictOn(SAT, [SAT])).toMatchObject({ daysBefore: 0, severity: 'blocked' });
    expect(gripConflictOn(FRI, [SAT])).toMatchObject({ daysBefore: 1, severity: 'blocked' });
    expect(isGripSafe(SAT, [SAT])).toBe(false);
    expect(isGripSafe(FRI, [SAT])).toBe(false);
  });

  it('advises rather than bars two days out', () => {
    /* The change that made the rule usable: three days took Wednesday,
       Thursday and Friday off a Saturday round, leaving every pull in the week
       to fit into Monday and Tuesday. */
    expect(GRIP_ADVISORY_DAYS).toBe(2);
    expect(gripConflictOn(THU, [SAT])).toMatchObject({ daysBefore: 2, severity: 'advised' });
    // Advised is not barred: the session is fine to train.
    expect(isGripSafe(THU, [SAT])).toBe(true);
  });

  it('says nothing at all three days out or more', () => {
    expect(gripConflictOn(WED, [SAT])).toBeUndefined();
    expect(gripConflictOn(TUE, [SAT])).toBeUndefined();
    expect(gripConflictOn(MON, [SAT])).toBeUndefined();
  });

  it('does not restrict the days after a round', () => {
    expect(isGripSafe('2026-08-30', [SAT])).toBe(true);
    expect(gripConflictOn('2026-08-30', [SAT])).toBeUndefined();
  });

  it('picks the soonest round when two are close together', () => {
    expect(gripConflictOn(THU, ['2026-08-30', SAT])?.golfDate).toBe(SAT);
  });

  it('leaves every day but Friday and Saturday safe for Saturday golf', () => {
    // Only the round and the day before it are out.
    expect(gripSafeWeekdays([6])).toEqual([1, 2, 3, 4, 7]);
  });

  it('shrinks the safe set to Mon through Thu when Sunday is played too', () => {
    // Fri is the day before Sat, and Sat is the day before Sun.
    expect(gripSafeWeekdays([6, 7])).toEqual([1, 2, 3, 4]);
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

describe('saying the buffer out loud', () => {
  /* The rule acted and said nothing: a workout in the buffer came back with no
     pulling in it and no screen explained why. The model is still told the
     bare prohibition — it reasons badly about calendars — but the lifter is
     not a model. */
  it('states the prohibition on a day that is barred', () => {
    expect(gripBufferNote(FRI, [SAT])).toEqual({
      text: 'Golf tomorrow (Sat) — no grip, lat or forearm work.',
      severity: 'blocked',
    });
    expect(gripBufferNote(SAT, [SAT])).toEqual({
      text: 'Golf today (Sat) — no grip, lat or forearm work.',
      severity: 'blocked',
    });
  });

  it('offers information, not an instruction, on a day that is merely close', () => {
    /* Two days out the session is fine to train. Wording it as a veto is how
       a rule stops being believed. */
    expect(gripBufferNote(THU, [SAT])).toEqual({
      text: 'Golf in 2 days (Sat) — may affect your swing.',
      severity: 'advised',
    });
  });

  it('says nothing on a day the rule does not touch', () => {
    expect(gripBufferNote(WED, [SAT])).toBeUndefined();
    expect(gripBufferNote(TUE, [SAT])).toBeUndefined();
    expect(gripBufferNote(MON, [SAT])).toBeUndefined();
    // The day after a round is free: the rule is one-directional.
    expect(gripBufferNote('2026-08-30', [SAT])).toBeUndefined();
    expect(gripBufferNote(THU, [])).toBeUndefined();
  });

  it('never words an advisory day as a prohibition, across a fortnight', () => {
    for (let offset = -7; offset <= 7; offset += 1) {
      const date = shiftIso(SAT, offset);
      const note = gripBufferNote(date, [SAT]);
      const barred = !isGripSafe(date, [SAT]);
      // The wording and the severity can never disagree about what is allowed.
      expect(barred, date).toBe(note?.severity === 'blocked');
      expect(note === undefined || note.text.includes('no grip') === barred, date).toBe(true);
    }
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
    // Everything but Friday and the round itself: advised is not barred.
    expect(week.filter((d) => d.gripSafe).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 7]);
  });

  it('reads the golf weekdays back off the calendar', () => {
    expect(golfWeekdaysFrom(SATURDAY_GOLF)).toEqual([6]);
  });
});
