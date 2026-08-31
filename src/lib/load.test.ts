import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { effectiveKg, hasLoadTranslation, rirFromRpe, rirToken, rpeFromRir } from './load';

const find = (id: string) => {
  const exercise = EXERCISES.find((e) => e.id === id);
  if (!exercise) throw new Error(`missing seed exercise ${id}`);
  return exercise;
};

describe('effective load (spec §5 rule 2)', () => {
  it('translates a 50 kg single-pulley cable row to 24.5 kg effective', () => {
    expect(effectiveKg(find('cb_single_arm_row'), 50)).toBe(24.5);
  });

  it('translates bilateral cable work at ×0.98', () => {
    expect(effectiveKg(find('cb_seated_row'), 50)).toBe(49);
  });

  it('leaves free-weight loads alone', () => {
    expect(effectiveKg(find('kb_goblet_squat'), 20)).toBe(20);
    expect(effectiveKg(find('bb_back_squat'), 96)).toBe(96);
  });

  it('produces no load for bands, whose resistance is not quantifiable', () => {
    expect(effectiveKg(find('bd_pull_apart'), 12)).toBeUndefined();
  });

  it('only claims a translation where the loaded and effective numbers differ', () => {
    expect(hasLoadTranslation(find('cb_single_arm_row'))).toBe(true);
    expect(hasLoadTranslation(find('bb_back_squat'))).toBe(false);
    expect(hasLoadTranslation(find('bd_pull_apart'))).toBe(false);
  });

  it('never leaks float noise into a displayed weight', () => {
    // 50 * 0.49 is 24.500000000000004 in IEEE754.
    expect(String(effectiveKg(find('cb_single_arm_row'), 50))).toBe('24.5');
  });
});

describe('effort scales', () => {
  it('treats RIR and RPE as two views of one number', () => {
    expect(rpeFromRir(2)).toBe(8);
    expect(rirFromRpe(8)).toBe(2);
  });

  it('colours the RIR badge from the spec tokens, hardest first', () => {
    expect(rirToken(0)).toContain('rir-1');
    expect(rirToken(1)).toContain('rir-1');
    expect(rirToken(2)).toContain('rir-2');
    expect(rirToken(3)).toContain('rir-3');
    expect(rirToken(undefined)).toBeUndefined();
  });
});
