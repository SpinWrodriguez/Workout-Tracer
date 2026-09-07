import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAINING,
  MAX_MAX_RPE,
  MIN_MAX_RPE,
  mergeTraining,
} from './settings';

/*
 * mergeTraining is the only thing standing between a hand-edited settings row
 * and the generation prompt. Every field it reads has a fallback for exactly
 * that reason, and the effort ceiling has a clamp as well: unlike a set target,
 * a nonsense value here does not look wrong on screen.
 */
describe('the effort ceiling', () => {
  it('defaults to one rep in reserve rather than to failure', () => {
    // A default nobody chose should be the sustainable one.
    expect(DEFAULT_TRAINING.maxRpe).toBe(9);
  });

  it('clamps a stored value into the range a ceiling can mean', () => {
    /* A stored 12 would reach the prompt as a ceiling above failure, which is
       no ceiling at all; a stored 2 would ask the generator for a warm-up. */
    expect(mergeTraining({ maxRpe: 12 }).maxRpe).toBe(MAX_MAX_RPE);
    expect(mergeTraining({ maxRpe: 2 }).maxRpe).toBe(MIN_MAX_RPE);
    expect(mergeTraining({ maxRpe: 8 }).maxRpe).toBe(8);
  });

  it('falls back rather than storing nonsense', () => {
    expect(mergeTraining({ maxRpe: 'hard' }).maxRpe).toBe(DEFAULT_TRAINING.maxRpe);
    expect(mergeTraining({}).maxRpe).toBe(DEFAULT_TRAINING.maxRpe);
  });
});
