import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise, DaySlot } from '../db/types';
import { shiftIso } from './format';
import { forecastWeek, nextAfter, nextFrom, offerFor, queueFrom, rotationEnd, rotationWeekOf, type Rotation } from './rotation';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const MON = '2026-10-12';
const week = Array.from({ length: 7 }, (_, i) => shiftIso(MON, i));
const SAT = shiftIso(MON, 5);
const row = (slot: DaySlot, exerciseId: string): BlockExercise => ({
  blockId: 'b', exerciseId, daySlot: slot, targetSets: 3, repRangeLow: 8, repRangeHigh: 12, order: 0,
});
// A squat + RDL (grip, spine), B pulldown (grip), C bench + lateral raise (golf-safe), D lunge (golf-safe).
const entries = [
  row('A', 'bb_back_squat'), row('A', 'bb_rdl'),
  row('B', 'cb_lat_pulldown'),
  row('C', 'bb_bench_press'), row('C', 'cb_lateral_raise'),
  row('D', 'kb_reverse_lunge'),
];
const plan: Rotation = { order: ['A', 'B', 'C', 'D'], optional: ['D'], trainingDays: [1, 3, 5], start: MON, weeks: 8 };
const golf = [{ date: SAT }];
const input = (over: Partial<Parameters<typeof forecastWeek>[0]> = {}) => ({
  rotation: plan, weekDates: week, sessions: [], dates: {}, entries, exercisesById: byId, golf, today: MON, ...over,
});

describe('the order', () => {
  it('starts at the first and goes round', () => {
    expect(nextAfter(plan, undefined)).toBe('A');
    expect(nextAfter(plan, 'A')).toBe('B');
    expect(nextAfter(plan, 'D')).toBe('A');
  });

  it('is what follows the last workout logged since the plan began, skipping ones outside the order', () => {
    const sessions = [{ date: MON, slot: 'A' as DaySlot }, { date: shiftIso(MON, 2), slot: 'X' as DaySlot }];
    expect(nextFrom(plan, sessions, shiftIso(MON, 3))).toBe('B');
    // From before the session, the first.
    expect(nextFrom(plan, sessions, MON)).toBe('A');
    // Sessions before the plan started are the old block's business.
    expect(nextFrom(plan, [{ date: '2026-10-01', slot: 'C' as DaySlot }], MON)).toBe('A');
  });

  it('leaves the optional workout out on three-day weeks', () => {
    expect(queueFrom(plan, 'A')).toEqual(['A', 'B', 'C']);
    expect(queueFrom({ ...plan, trainingDays: [1, 2, 4, 5] }, 'B')).toEqual(['B', 'C', 'D', 'A']);
  });
});

describe('the week', () => {
  it('forecasts the usual days from the order, the first one marked next', () => {
    const out = forecastWeek(input());
    expect(out[MON]).toEqual({ slot: 'A', kind: 'next' });
    expect(out[shiftIso(MON, 2)]).toEqual({ slot: 'B', kind: 'forecast' });
    expect(out[shiftIso(MON, 4)]).toEqual({ slot: 'C', kind: 'forecast' });
    expect(out[shiftIso(MON, 1)]).toBeUndefined();
  });

  it('shows what was logged, and carries on from it', () => {
    const sessions = [{ date: MON, slot: 'A' as DaySlot }];
    const out = forecastWeek(input({ sessions, today: shiftIso(MON, 1) }));
    expect(out[MON]).toEqual({ slot: 'A', kind: 'done' });
    expect(out[shiftIso(MON, 2)]).toEqual({ slot: 'B', kind: 'next' });
  });

  it('gives the day before golf the first golf-safe workout in the queue', () => {
    // Train Mon, Wed, Fri with golf Saturday: C (bench, raises) goes to Friday
    // even when B is next, and B waits.
    const sessions = [{ date: MON, slot: 'A' as DaySlot }, { date: shiftIso(MON, 2), slot: 'B' as DaySlot }];
    const out = forecastWeek(input({ sessions, today: shiftIso(MON, 3), rotation: { ...plan, trainingDays: [1, 3, 5, 7] } }));
    expect(out[shiftIso(MON, 4)]).toEqual({ slot: 'C', kind: 'next' });
    expect(out[shiftIso(MON, 6)]).toEqual({ slot: 'D', kind: 'forecast' });
  });

  it('knows the golf eve from the usual golf weekday before a round is on the calendar', () => {
    const out = forecastWeek(input({ golf: [], golfWeekdays: [6], today: shiftIso(MON, 3), rotation: { ...plan, trainingDays: [4, 5] } }));
    expect(out[shiftIso(MON, 3)]?.slot).toBe('A');
    expect(out[shiftIso(MON, 4)]?.slot).toBe('C');
  });

  it('keeps a hand-placed date and an emptied one', () => {
    const out = forecastWeek(input({ dates: { [shiftIso(MON, 1)]: 'C', [shiftIso(MON, 2)]: null } }));
    expect(out[MON]?.slot).toBe('A');
    expect(out[shiftIso(MON, 1)]).toEqual({ slot: 'C', kind: 'forecast' });
    expect(out[shiftIso(MON, 2)]).toBeUndefined();
    // C was taken by hand and B carries grip work, so the golf eve takes the
    // next golf-safe one in the queue: C again, from the round after.
    expect(out[shiftIso(MON, 4)]).toEqual({ slot: 'C', kind: 'forecast' });
  });

  it('shows nothing before the plan starts or after it ends', () => {
    const late = { ...plan, start: shiftIso(MON, 2) };
    expect(forecastWeek(input({ rotation: late }))[MON]).toBeUndefined();
    expect(forecastWeek(input({ rotation: late }))[shiftIso(MON, 2)]?.slot).toBe('A');
    const after = Array.from({ length: 7 }, (_, i) => shiftIso(rotationEnd(plan), 1 + i));
    expect(forecastWeek(input({ weekDates: after, today: after[0] }))).toEqual({});
  });

  it('counts weeks from the Monday of the start week', () => {
    expect(rotationWeekOf(plan, MON)).toBe(1);
    expect(rotationWeekOf(plan, shiftIso(MON, 13))).toBe(2);
    expect(rotationWeekOf(plan, shiftIso(MON, -1))).toBe(0);
    expect(rotationEnd(plan)).toBe(shiftIso(MON, 55));
    expect(rotationWeekOf(plan, shiftIso(MON, 56))).toBe(9);
  });
});

describe('the day sheet offer', () => {
  it('puts the next workout first, and the golf-safe one first on a golf eve', () => {
    const base = { rotation: plan, sessions: [], dates: {}, entries, exercisesById: byId, golf, today: MON };
    expect(offerFor(shiftIso(MON, 1), base)).toMatchObject({ first: 'A', golfEve: false });
    expect(offerFor(shiftIso(MON, 4), base)).toMatchObject({ first: 'C', golfEve: true });
  });
});
