import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { Exercise } from '../db/types';
import { effectiveKg } from './load';
import {
  DEFAULT_INVENTORY,
  atCeiling,
  cableStackWeights,
  jumpPercent,
  ladderFor,
  loadableWeights,
  microplateHint,
  nextRung,
  prevRung,
  snapToLadder,
  handHeldWeights,
  clearLadderCache,
  type Inventory,
} from './loadable';

const find = (id: string) => {
  const exercise = EXERCISES.find((e) => e.id === id);
  if (!exercise) throw new Error(`missing seed exercise ${id}`);
  return exercise;
};

/** Spec §2, verbatim. */
const FREE_BAR_LADDER = [
  20, 23, 26, 30, 33, 36, 40, 43, 46, 50, 53, 56, 60, 63, 66, 70, 73, 76, 80, 83, 86, 90, 93, 96,
];
const SMITH_LADDER = [
  18, 21, 24, 28, 31, 34, 38, 41, 44, 48, 51, 54, 58, 61, 64, 68, 71, 74, 78, 81, 84, 88, 91, 94,
];

describe('loadableWeights (spec §2)', () => {
  it('reproduces the free-bar 24-rung ladder exactly', () => {
    expect(loadableWeights(20, DEFAULT_INVENTORY.plates)).toEqual(FREE_BAR_LADDER);
  });

  it('reproduces the Smith 24-rung ladder exactly', () => {
    expect(loadableWeights(18, DEFAULT_INVENTORY.plates)).toEqual(SMITH_LADDER);
  });

  it('has 24 rungs per bar with 3 kg steps inside each cluster', () => {
    expect(FREE_BAR_LADDER).toHaveLength(24);
    for (let i = 1; i < FREE_BAR_LADDER.length; i += 1) {
      const step = (FREE_BAR_LADDER[i] as number) - (FREE_BAR_LADDER[i - 1] as number);
      expect([3, 4]).toContain(step); // 3 inside a cluster, 4 across one
    }
  });

  it('closes the 26 → 30 gaps once a pair of 2.5 kg plates is added', () => {
    const withMicro = loadableWeights(20, [
      ...DEFAULT_INVENTORY.plates,
      { kg: 2.5, pairs: 1 },
    ]);
    expect(withMicro).toContain(28);
    for (let i = 1; i < withMicro.length; i += 1) {
      const step = (withMicro[i] as number) - (withMicro[i - 1] as number);
      expect(step).toBeLessThanOrEqual(3);
    }
  });

  it('returns just the bar when there are no plates', () => {
    expect(loadableWeights(20, [])).toEqual([20]);
  });
});

describe('cable stack', () => {
  it('returns 5 kg increments to the top of the stack', () => {
    const ladder = cableStackWeights(70, 5);
    expect(ladder[0]).toBe(5);
    expect(ladder.at(-1)).toBe(70);
    expect(ladder).toHaveLength(14);
  });

  it('gives effective values at ×0.49 on a single pulley', () => {
    const row = find('cb_single_arm_row');
    const ladder = ladderFor(row, DEFAULT_INVENTORY);
    expect(ladder).toContain(50);
    expect(effectiveKg(row, 50)).toBe(24.5);
    expect(effectiveKg(row, 5)).toBe(2.45); // the finest increment in the gym
    expect(effectiveKg(row, 70)).toBe(34.3);
  });

  it('gives effective values at ×0.98 on both pulleys', () => {
    expect(effectiveKg(find('cb_seated_row'), 70)).toBe(68.6);
  });
});

describe('ladderFor', () => {
  it('uses the bar ladder for bar stations', () => {
    expect(ladderFor(find('bb_back_squat'), DEFAULT_INVENTORY)).toEqual(FREE_BAR_LADDER);
    expect(ladderFor(find('sm_squat'), DEFAULT_INVENTORY)).toEqual(SMITH_LADDER);
  });

  it('uses the hand-held ladder for kettlebell and loaded bodyweight work', () => {
    /* This used to expect [3, 6, 10, 13, 16, 20, 23, 26...] — the symmetric
       pair maths, as though the plates were going on a bar, running all the
       way up to 86 kg for a swing. The expectation encoded the bug. A hand
       holds one plate. */
    const goblet = ladderFor(find('kb_goblet_squat'), DEFAULT_INVENTORY);
    expect(goblet).toEqual([1.5, 5, 10, 20]);
    expect(ladderFor(find('bw_split_squat'), DEFAULT_INVENTORY)).toEqual(goblet);
  });

  it('has no ladder for bodyweight or band work', () => {
    expect(ladderFor(find('bw_pull_up'), DEFAULT_INVENTORY)).toEqual([]);
    expect(ladderFor(find('bd_pull_apart'), DEFAULT_INVENTORY)).toEqual([]);
  });

  it('follows a bar weight edited in Settings', () => {
    const ladder = ladderFor(find('sm_squat'), {
      ...DEFAULT_INVENTORY,
      barWeights: { free_bar: 20, smith: 25 },
    });
    expect(ladder[0]).toBe(25);
  });
});

describe('snapping', () => {
  const ladder = FREE_BAR_LADDER;

  it('never offers 27 kg', () => {
    expect(snapToLadder(27, ladder)).toBe(26);
    expect(snapToLadder(28.5, ladder)).toBe(30);
    expect(snapToLadder(22, ladder)).toBe(23);
  });

  it('clamps below the bar and at the ceiling', () => {
    expect(snapToLadder(5, ladder)).toBe(20);
    expect(snapToLadder(500, ladder)).toBe(96);
  });

  it('steps rung to rung', () => {
    expect(nextRung(26, ladder)).toBe(30);
    expect(prevRung(30, ladder)).toBe(26);
    expect(nextRung(96, ladder)).toBeUndefined();
    expect(prevRung(20, ladder)).toBeUndefined();
  });

  it('treats the top of the ladder as a hard stop', () => {
    expect(atCeiling(96, ladder)).toBe(true);
    expect(atCeiling(93, ladder)).toBe(false);
  });
});

describe('microplate hint', () => {
  it('fires on the light-load gaps and goes quiet higher up', () => {
    expect(jumpPercent(20, FREE_BAR_LADDER)).toBeCloseTo(15, 1);
    expect(microplateHint(20, FREE_BAR_LADDER)).toMatch(/15% — consider microplates/);
    expect(microplateHint(26, FREE_BAR_LADDER)).toMatch(/15%/);
    expect(microplateHint(33, FREE_BAR_LADDER)).toBeUndefined(); // 9%
    expect(microplateHint(96, FREE_BAR_LADDER)).toBeUndefined(); // at the ceiling
  });
});

describe('what a hand can hold', () => {
  /* Real inventory from the app's owner: no kettlebells at all, and plates
     with grips on them. */
  const gripped: Inventory = {
    plates: [
      { kg: 20, pairs: 1 },
      { kg: 10, pairs: 1 },
      { kg: 5, pairs: 2 },
      { kg: 1.5, pairs: 2 },
    ],
    kettlebells: [],
    barWeights: { free_bar: 20, smith: 18 },
    cableStackKg: 65,
    cableStepKg: 5,
  };

  it('offers the plates themselves, not a bar loaded with them', () => {
    /* The bug: this ran the plate maths with a bar of zero, which is the
       symmetric one-per-side logic, and offered a Swing every rung up to
       86 kg. */
    expect(handHeldWeights(gripped.plates, gripped.kettlebells)).toEqual([1.5, 5, 10, 20]);
  });

  it('offers no sum of two plates, because one grip holds one plate', () => {
    const rungs = handHeldWeights(gripped.plates, gripped.kettlebells);
    expect(rungs).not.toContain(15);
    expect(rungs).not.toContain(30);
    expect(Math.max(...rungs)).toBe(20);
  });

  it('still takes real bells where there are some', () => {
    expect(handHeldWeights([{ kg: 10, pairs: 1 }], [16, 24])).toEqual([10, 16, 24]);
  });

  it('ignores a plate nobody owns and a bell of zero', () => {
    expect(handHeldWeights([{ kg: 25, pairs: 0 }, { kg: 10, pairs: 1 }], [0])).toEqual([10]);
  });

  it('gives a swing and a carry the same short ladder', () => {
    clearLadderCache();
    const swing = EXERCISES.find((e) => e.id === 'kb_swing');
    const carry = EXERCISES.find((e) => e.id === 'kb_suitcase_carry');
    expect(ladderFor(swing as Exercise, gripped)).toEqual([1.5, 5, 10, 20]);
    /* A two-handed carry logs what is in each hand, so 10 each side is the
       10 rung — the number you can actually pick up. */
    expect(ladderFor(carry as Exercise, gripped)).toContain(10);
  });

  it('does not serve a swing the bar ladder when the bar weight is zero', () => {
    /* The cache key was `bar ?? 0`, and the bar-weight field in Settings
       accepts 0 — so a hand-held exercise and a 0 kg barbell shared a key and
       whichever was computed first was served to both. */
    clearLadderCache();
    const zeroBar: Inventory = { ...gripped, barWeights: { free_bar: 0, smith: 0 } };
    const squat = ladderFor(EXERCISES.find((e) => e.id === 'bb_back_squat') as Exercise, zeroBar);
    const swing = ladderFor(EXERCISES.find((e) => e.id === 'kb_swing') as Exercise, zeroBar);
    expect(swing).toEqual([1.5, 5, 10, 20]);
    expect(squat).not.toEqual(swing);
    expect(Math.max(...squat)).toBe(86);
  });

  it('leaves a barbell lift alone — that one really is a bar and pairs', () => {
    clearLadderCache();
    const squat = EXERCISES.find((e) => e.id === 'bb_back_squat');
    const rungs = ladderFor(squat as Exercise, gripped);
    expect(rungs[0]).toBe(20);
    expect(rungs).toContain(40);
    /* 20 kg bar + 2x20 + 2x10 + 4x5 + 4x1.5 = 106, which is the whole rack on
       one bar — right for a squat, absurd for a swing. */
    expect(Math.max(...rungs)).toBe(106);
  });
});
