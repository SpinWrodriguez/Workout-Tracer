import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { dayLabel, describeDay, shortDayLabels } from './dayLabel';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const pick = (...ids: string[]) =>
  ids.map((id) => {
    const exercise = byId.get(id);
    if (!exercise) throw new Error(`missing ${id}`);
    return exercise;
  });

describe('naming a day after what it trains', () => {
  it('names a hinge and row day the lower pull', () => {
    expect(describeDay(pick('bb_rdl', 'bb_deadlift'))).toBe('Lower Pull');
  });

  it('names a squat day the lower push', () => {
    expect(describeDay(pick('bb_back_squat', 'bb_front_squat'))).toBe('Lower Push');
  });

  it('adds the core work to the name when there is any', () => {
    expect(describeDay(pick('bb_bench_press', 'bb_overhead_press', 'cb_pallof_press'))).toBe(
      'Upper Push + Core',
    );
  });

  it('calls a session that mixes both halves a full body one, by effort', () => {
    const mixed = pick('bb_back_squat', 'bb_bench_press', 'bb_bent_over_row');
    expect(describeDay(mixed, 'heavy')).toBe('Full Body Heavy');
    expect(describeDay(mixed, 'light')).toBe('Full Body Light');
  });

  it('names a day spent entirely on the stack after the stack', () => {
    expect(describeDay(pick('cb_pallof_press', 'cb_single_arm_row'))).toBe('Cable Session');
  });

  it('calls a very short light day the minimum dose', () => {
    expect(describeDay(pick('bb_back_squat', 'bb_bench_press'), 'light')).toBe('Minimum Dose');
    // Three movements is a session, not a token effort.
    expect(
      describeDay(pick('bb_back_squat', 'bb_bench_press', 'bb_bent_over_row'), 'light'),
    ).toBe('Full Body Light');
  });

  it('has nothing to say about an empty day', () => {
    expect(describeDay([])).toBeUndefined();
  });
});

describe('what actually gets shown', () => {
  it('prefers a name the user typed over anything derived', () => {
    expect(dayLabel({ slot: 'A', name: 'Garage Grind', exercises: pick('bb_rdl') })).toBe(
      'Garage Grind',
    );
    // Whitespace is not a name.
    expect(dayLabel({ slot: 'A', name: '   ', exercises: pick('bb_rdl', 'bb_deadlift') })).toBe(
      'Lower Pull',
    );
  });

  it('falls back to the slot only when there is nothing to describe', () => {
    expect(dayLabel({ slot: 'B' })).toBe('Day B');
    expect(dayLabel({ slot: 'B', exercises: [] })).toBe('Day B');
  });
});

describe('telling two days of the same week apart', () => {
  it('names a mixed day that leans one way after the lean', () => {
    // The generator's two heavy days: a hinge-and-pull session and a
    // squat-and-press one. Both touch both halves, so both used to come back
    // "Full Body Heavy" — a week of identical names is no better than A and B.
    expect(describeDay(pick('kb_swing', 'bw_chin_up', 'bb_bent_over_row', 'cb_pallof_press'))).toBe(
      'Full Body Pull',
    );
    expect(
      describeDay(pick('bb_back_squat', 'sm_incline_press', 'bb_overhead_press', 'bw_ab_wheel')),
    ).toBe('Full Body Push');
  });

  it('still calls a genuinely balanced day what it is', () => {
    // Squat, press and row: one of each, leaning nowhere.
    expect(describeDay(pick('bb_back_squat', 'bb_bench_press', 'bb_bent_over_row'), 'light')).toBe(
      'Full Body Light',
    );
  });
});

describe('names small enough for a calendar pill', () => {
  it('keeps the part that tells the days apart', () => {
    // A week of full-body sessions: "Full Body" is the bit they share, so it
    // is the bit worth dropping.
    expect(shortDayLabels(['Full Body Pull', 'Full Body Push'])).toEqual(['Pull', 'Push']);
    expect(shortDayLabels(['Full Body Light', 'Full Body Heavy'])).toEqual(['Light', 'Heavy']);
  });

  it('drops a shared leading word even when it is not "Full Body"', () => {
    expect(shortDayLabels(['Upper Push', 'Upper Pull'])).toEqual(['Push', 'Pull']);
  });

  it('never strips a day down to nothing', () => {
    expect(shortDayLabels(['Upper', 'Upper'])).toEqual(['Upper', 'Upper']);
  });

  it('falls back to initials when the name is still too long', () => {
    expect(shortDayLabels(['Upper Push + Core', 'Lower Pull'])).toEqual(['UPC', 'Lower Pull']);
    expect(shortDayLabels(['Cable Session'])).toEqual(['CS']);
  });

  it('leaves an unnamed day as its letter', () => {
    expect(shortDayLabels(['Day A', 'Full Body Pull'])).toEqual(['A', 'Pull']);
  });

  it('shortens a lone workout the same way it would in company', () => {
    // Stable across weeks: Monday should not be called "Pull" one week and
    // "FBP" the next because of what else happened to be scheduled.
    expect(shortDayLabels(['Full Body Pull'])).toEqual(['Pull']);
  });
});
