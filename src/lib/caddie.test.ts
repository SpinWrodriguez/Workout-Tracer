import { describe, expect, it } from 'vitest';
import { caddieLine } from './caddie';

/*
 * One sentence, chosen by priority: what happened beats what is planned, a
 * record beats every other clause, and silence is allowed. These pin the
 * priorities and the length discipline — the line is the anti-wall-of-text.
 */

const quiet = { golfToday: false, golfTomorrow: false, weekEmpty: false };

describe('the caddie line', () => {
  it('leads with what was done, and a record outranks everything', () => {
    expect(
      caddieLine({ ...quiet, trainedToday: 'Upper Push', pr: '45 kg bench press, heaviest yet' }),
    ).toBe('Upper Push done — 45 kg bench press, heaviest yet.');
    expect(caddieLine({ ...quiet, trainedToday: 'Upper Push' })).toBe('Upper Push done.');
    // Done wins even when something is still planned on paper.
    expect(
      caddieLine({
        ...quiet,
        trainedToday: 'Upper Push',
        plannedToday: { name: 'Leg Day', light: false },
      }),
    ).toBe('Upper Push done.');
  });

  it('says a round day plainly, pointing at the next session', () => {
    expect(
      caddieLine({ ...quiet, golfToday: true, next: { name: 'Leg Day', weekday: 'Mon' } }),
    ).toBe('Round today — next session Leg Day, Mon.');
    expect(caddieLine({ ...quiet, golfToday: true })).toBe('Round today.');
  });

  it('warns about tomorrow\'s round on a planned day, once', () => {
    expect(
      caddieLine({
        ...quiet,
        golfTomorrow: true,
        plannedToday: { name: 'Upper Push', light: false },
      }),
    ).toBe('Upper Push today — round tomorrow, grip stays light.');
    // The buffer clause outranks the light clause; one clause only.
    expect(
      caddieLine({ ...quiet, plannedToday: { name: 'Easy Pull', light: true } }),
    ).toBe('Easy Pull today — light day.');
  });

  it('names the next day on a rest day, and stays quiet with nothing to say', () => {
    expect(caddieLine({ ...quiet, next: { name: 'Leg Day', weekday: 'Thu' } })).toBe(
      'Rest today — Leg Day on Thu.',
    );
    expect(caddieLine({ ...quiet, weekEmpty: true })).toBe('Nothing planned this week yet.');
    expect(caddieLine(quiet)).toBeUndefined();
  });

  it('never exceeds one sentence of reasonable length', () => {
    const line = caddieLine({
      ...quiet,
      trainedToday: 'Hip Mobility Plus Chest Delts',
      pr: '52.5 kg smith incline press, heaviest yet',
    });
    expect(line).toBeDefined();
    expect((line as string).length).toBeLessThan(120);
    expect((line as string).split('. ').length).toBe(1);
  });
});
