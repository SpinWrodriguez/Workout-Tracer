import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { Exercise } from '../db/types';
import { formatDuration, isTimed, maxPrescription, prescription, repUnitShort, repUnitWord, stepFor } from './repUnit';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const find = (id: string) => {
  const exercise = byId.get(id);
  if (!exercise) throw new Error(`missing ${id}`);
  return exercise;
};

describe('saying how long', () => {
  it('reads as seconds under a minute and as minutes over it', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(59)).toBe('59 s');
    // "150 s" is arithmetic homework.
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(125)).toBe('2:05');
  });
});

describe('what a prescription may be set to', () => {
  it('gives a hold room for minutes and reps a rep ceiling', () => {
    expect(maxPrescription(find('bw_plank'))).toBe(600);
    expect(maxPrescription(find('bb_back_squat'))).toBe(50);
  });

  it('steps a hold in fives, because seconds one at a time is not an interface', () => {
    expect(stepFor(find('bw_plank'))).toBe(5);
    expect(stepFor(find('bb_back_squat'))).toBe(1);
  });
});

describe('how a prescription reads', () => {
  it('writes a long hold in minutes', () => {
    expect(prescription(find('bw_plank'), 3, 30, 45)).toBe('3 × 30-45 s');
    expect(prescription(find('bw_plank'), 3, 30, 60)).toBe('3 × 0:30-1:00');
    expect(prescription(find('bw_plank'), 3, 90, 120)).toBe('3 × 1:30-2:00');
    expect(prescription(find('bb_back_squat'), 3, 6, 10)).toBe('3 × 6-10');
  });

  it('knows which exercises are counted in seconds', () => {
    expect(isTimed(find('bw_plank'))).toBe(true);
    expect(isTimed(find('kb_suitcase_carry'))).toBe(true);
    expect(isTimed(find('bb_back_squat'))).toBe(false);
  });
});

describe('counted each side', () => {
  const split = { repUnit: undefined, perSide: true } as unknown as Exercise;
  const plank = { repUnit: 'seconds', perSide: true } as unknown as Exercise;

  it('says so on the prescription, the unit and the word', () => {
    expect(prescription(split, 3, 8, 12)).toBe('3 × 8-12 each side');
    expect(repUnitShort(split)).toBe('reps/side');
    expect(repUnitWord(split)).toBe('reps each side');
    expect(prescription(plank, 2, 20, 30)).toBe('2 × 20-30 s each side');
    expect(repUnitShort(plank)).toBe('s/side');
  });

  it('leaves a bilateral lift exactly as it was', () => {
    const squat = {} as Exercise;
    expect(prescription(squat, 3, 8, 10)).toBe('3 × 8-10');
    expect(repUnitShort(squat)).toBe('reps');
  });
});
