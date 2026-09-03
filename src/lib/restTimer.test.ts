import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { REST_PRESETS, restChoices } from './restTimer';

/*
 * The chips the rest bar offers. The timer counted 120 seconds for everything
 * while every exercise in the library carried its own rest — 30 for a band
 * walk, 180 for a heavy pull — so the number it counted was right for about a
 * third of them.
 */

describe('the durations offered for an exercise', () => {
  it("always includes the exercise's own rest", () => {
    for (const seconds of [30, 45, 60, 90, 120, 150, 180]) {
      expect(restChoices(seconds)).toContain(seconds);
    }
  });

  it('offers four of them, because five did not fit the row', () => {
    for (const exercise of EXERCISES) {
      expect(restChoices(exercise.restSeconds), exercise.id).toHaveLength(4);
    }
  });

  it('fills the rest with the nearest presets, in order', () => {
    // 45 is not a preset: it joins 60, 90 and 120 and drops the far 180.
    expect(restChoices(45)).toEqual([45, 60, 90, 120]);
    // 150 sits between two, so it keeps the two either side.
    expect(restChoices(150)).toEqual([90, 120, 150, 180]);
  });

  it('is just the presets when nothing has a rest to offer', () => {
    expect(restChoices(undefined)).toEqual([...REST_PRESETS]);
  });

  it('does not offer the same duration twice', () => {
    for (const exercise of EXERCISES) {
      const chips = restChoices(exercise.restSeconds);
      expect(new Set(chips).size, exercise.id).toBe(chips.length);
    }
  });

  it('covers every rest the library actually uses', () => {
    /* Not decoration: a rest outside the presets is exactly the case that
       used to be unreachable, and 30, 45 and 150 are all in the seed. */
    const rests = new Set(EXERCISES.map((exercise) => exercise.restSeconds));
    for (const seconds of rests) expect(restChoices(seconds)[0]).toBeLessThanOrEqual(seconds);
  });
});
