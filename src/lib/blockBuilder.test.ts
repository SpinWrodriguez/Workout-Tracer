import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { generateDay } from './blockBuilder';
import { templateDayFor } from './weekTemplate';
import type { DaySlot } from '../db/types';

const GOLF: number[] = [6]; // Saturday

const heavyMonday = (slot: DaySlot = 'A') =>
  templateDayFor({
    slot,
    weekday: 1,
    intensity: 'heavy',
    shape: 'mixed',
    minutesPerSession: 40,
    golfWeekdays: GOLF as never,
  });

const day = (over: Partial<Parameters<typeof generateDay>[0]> = {}) =>
  generateDay({
    blockId: 'block_1',
    exercises: EXERCISES,
    focusMuscles: [],
    template: heavyMonday(),
    hasHistory: true,
    ...over,
  });

const ids = (d: ReturnType<typeof generateDay>) => d.exercises.map((e) => e.exerciseId);

describe('generating one day', () => {
  it('fills the slot it was handed and no other', () => {
    const built = day({ template: heavyMonday('C') });
    expect(built.slot).toBe('C');
    expect(built.exercises.every((entry) => entry.daySlot === 'C')).toBe(true);
    expect(built.exercises.length).toBeGreaterThan(0);
  });

  it('never picks an exercise another day already holds', () => {
    const first = day();
    const second = day({ template: heavyMonday('B'), exclude: ids(first) });
    // This is the whole point of per-day generation: day two complements day
    // one instead of proposing the same session again.
    expect(second.exercises.length).toBeGreaterThan(0);
    for (const id of ids(second)) expect(ids(first)).not.toContain(id);
  });

  it('still produces a real session when most of the table is spoken for', () => {
    // Everything bar a handful excluded: it may have to reuse, but it must not
    // hand back an empty day.
    const keep = new Set(EXERCISES.slice(0, 6).map((e) => e.id));
    const built = day({ exclude: EXERCISES.filter((e) => !keep.has(e.id)).map((e) => e.id) });
    expect(built.exercises.length).toBeGreaterThan(0);
  });

  it('honours the light day constraints it is given', () => {
    const light = templateDayFor({
      slot: 'C',
      weekday: 3,
      intensity: 'light',
      golfWeekdays: GOLF as never,
    });
    const built = generateDay({
      blockId: 'block_1',
      exercises: EXERCISES,
      focusMuscles: [],
      template: light,
      hasHistory: true,
    });
    const byId = new Map(EXERCISES.map((e) => [e.id, e]));
    for (const id of ids(built)) {
      expect(byId.get(id)?.gripLoad).not.toBe('high');
      expect(byId.get(id)?.spinalLoad).not.toBe('high');
    }
  });
});

/*
 * The defect this guards: making "generate again" novel by banning what the
 * last pass proposed. That is subtractive, so every press walks further down
 * the ranking until days come back short. Regeneration must be a fresh draw.
 */
describe('regenerating the same day', () => {
  it('is identical every time for a given variant', () => {
    expect(ids(day({ variant: 0 }))).toEqual(ids(day({ variant: 0 })));
    expect(ids(day({ variant: 2 }))).toEqual(ids(day({ variant: 2 })));
  });

  it('does not decay however many times it is shuffled', () => {
    const base = day({ variant: 0 });
    for (let variant = 1; variant <= 25; variant += 1) {
      const built = day({ variant });
      // Same size and same shape of session — a different draw, never a worse
      // one, and never one that has run out of exercises to offer.
      expect(built.exercises.length, `variant ${variant}`).toBe(base.exercises.length);
      expect(built.estimatedMinutes, `variant ${variant}`).toBeLessThanOrEqual(40);
    }
  });

  it('comes back to exactly the first draw', () => {
    // Rotation, not a walk: the band is finite so variants repeat, which is
    // what makes "undo my shuffling" possible at all.
    const first = ids(day({ variant: 0 }));
    const cycled = Array.from({ length: 12 }, (_, i) => ids(day({ variant: i })));
    expect(cycled.some((draw, i) => i > 0 && draw.join() === first.join())).toBe(true);
  });

  it('actually offers something different at least once', () => {
    const first = ids(day({ variant: 0 })).join();
    const others = Array.from({ length: 6 }, (_, i) => ids(day({ variant: i + 1 })).join());
    expect(others.some((draw) => draw !== first)).toBe(true);
  });
});

/*
 * The week pass used to be tested here — generateBlock, which chose the days
 * itself and filled them in one go. It is deleted: the app builds a week one
 * day at a time through generateDay, which is what the tests above cover, and
 * exclusion between days is the `exclude` argument rather than a private set
 * inside a week-wide function.
 */

/* -------------------------------------------------------------------------- */
/*  Variant rotation, which no button drives any more.                        */
/*                                                                            */
/*  Regenerate and Shuffle both re-rolled this and are gone: a card's only     */
/*  draw is now the first one, on an empty workout, at variant 0. The property */
/*  is still worth pinning, because variant 0 being repeatable is what makes   */
/*  a first draw reproducible — and because the rotation is how the week       */
/*  generator keeps three days from picking the same exercises.               */
/* -------------------------------------------------------------------------- */

describe('variant rotation is what makes a day change', () => {
  const day = (variant: number) =>
    generateDay({
      blockId: 'b',
      exercises: EXERCISES,
      focusMuscles: [],
      template: templateDayFor({ slot: 'A', weekday: 3, intensity: 'light', focus: 'upper' }),
      variant,
      exclude: [],
    }).exercises.map((entry) => entry.exerciseId);

  it('gives an identical day for an unchanged variant', () => {
    // The reproducibility half: the same variant is the same day, always.
    const first = day(0);
    for (let i = 0; i < 3; i += 1) expect(day(0)).toEqual(first);
  });

  it('gives a different day for the next variant along', () => {
    expect(day(1)).not.toEqual(day(0));
    expect(day(2)).not.toEqual(day(1));
  });

  it('rotates within a bounded band rather than walking downhill', () => {
    // Bounded and repeatable: it comes back round to the strongest draw
    // instead of degrading with every press.
    expect(day(3)).toEqual(day(0));
    expect(day(4)).toEqual(day(1));
  });

  it('still respects the focus at every variant', () => {
    const legs = ['squat', 'hinge'];
    for (const variant of [0, 1, 2]) {
      const patterns = day(variant)
        .map((id) => EXERCISES.find((e) => e.id === id)?.pattern)
        .filter((pattern) => pattern !== undefined);
      // An upper-body focus asks for pull/push/core; rotating the draw must not
      // smuggle a squat or a hinge back in.
      for (const pattern of patterns) {
        expect(legs, `variant ${variant} produced ${pattern}`).not.toContain(pattern);
      }
    }
  });
});
