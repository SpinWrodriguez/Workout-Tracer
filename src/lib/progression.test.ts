import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import { DEFAULT_INVENTORY, ladderFor } from './loadable';
import { suggestProgression, topSet, type HistorySet } from './progression';

const find = (id: string) => {
  const exercise = EXERCISES.find((e) => e.id === id);
  if (!exercise) throw new Error(`missing seed exercise ${id}`);
  return exercise;
};

const GOBLET = ladderFor(find('kb_goblet_squat'), DEFAULT_INVENTORY);
const FREE_BAR = ladderFor(find('bb_back_squat'), DEFAULT_INVENTORY);

function session(id: string, date: string, sets: Partial<HistorySet>[]): HistorySet[] {
  return sets.map((set, i) => ({
    sessionId: id,
    date,
    setNo: i + 1,
    reps: 10,
    ...set,
  })) as HistorySet[];
}

describe('Phase 2 acceptance — progression suggestion', () => {
  it('takes a 20 kg goblet squat at 3×10 RIR 3 to 23 kg, not 22 or 24', () => {
    const history = session('s1', '2026-08-30', [
      { weightKg: 20, reps: 10, rir: 3 },
      { weightKg: 20, reps: 10, rir: 3 },
      { weightKg: 20, reps: 10, rir: 3 },
    ]);
    const result = suggestProgression({ ladder: GOBLET, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('increase');
    expect(result.suggestedKg).toBe(23);
  });

  it('warns about microplates on that jump, which is 15%', () => {
    const history = session('s1', '2026-08-30', [{ weightKg: 20, reps: 10, rir: 3 }]);
    const result = suggestProgression({ ladder: GOBLET, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.microplateNote).toMatch(/15% — consider microplates/);
  });
});

describe('progression rules (spec Phase 2)', () => {
  it('repeats the weight when the top of the range came at RIR 0–1', () => {
    const history = session('s1', '2026-08-30', [{ weightKg: 50, reps: 10, rir: 1 }]);
    const result = suggestProgression({ ladder: FREE_BAR, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('repeat');
    expect(result.suggestedKg).toBe(50);
    expect(result.reason).toMatch(/grinder/);
  });

  it('repeats when the set landed mid-range', () => {
    const history = session('s1', '2026-08-30', [{ weightKg: 50, reps: 9, rir: 3 }]);
    const result = suggestProgression({ ladder: FREE_BAR, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('repeat');
    expect(result.suggestedKg).toBe(50);
  });

  it('repeats after a single miss, then holds for review after the second', () => {
    const first = session('s1', '2026-08-24', [{ weightKg: 50, reps: 6, rir: 0 }]);
    const once = suggestProgression({
      ladder: FREE_BAR,
      history: first,
      repRangeLow: 8,
      repRangeHigh: 10,
    });
    expect(once.outcome).toBe('repeat');

    const twice = suggestProgression({
      ladder: FREE_BAR,
      history: [...first, ...session('s2', '2026-08-31', [{ weightKg: 50, reps: 7, rir: 0 }])],
      repRangeLow: 8,
      repRangeHigh: 10,
    });
    expect(twice.outcome).toBe('hold_review');
    expect(twice.suggestedKg).toBe(50);
    expect(twice.reason).toMatch(/twice/);
  });

  it('does not call it two misses when the weight changed in between', () => {
    const history = [
      ...session('s1', '2026-08-24', [{ weightKg: 46, reps: 6 }]),
      ...session('s2', '2026-08-31', [{ weightKg: 50, reps: 6 }]),
    ];
    const result = suggestProgression({ ladder: FREE_BAR, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('repeat');
  });

  it('stops at the ceiling instead of suggesting an unloadable weight', () => {
    const history = session('s1', '2026-08-30', [{ weightKg: 96, reps: 10, rir: 3 }]);
    const result = suggestProgression({ ladder: FREE_BAR, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('ceiling');
    expect(result.suggestedKg).toBe(96);
  });

  it('always lands on a rung, never between them', () => {
    for (const reps of [6, 8, 9, 10, 12]) {
      for (const rir of [0, 1, 2, 3]) {
        const history = session('s1', '2026-08-30', [{ weightKg: 50, reps, rir }]);
        const { suggestedKg } = suggestProgression({
          ladder: FREE_BAR,
          history,
          repRangeLow: 8,
          repRangeHigh: 10,
        });
        expect(FREE_BAR).toContain(suggestedKg);
      }
    }
  });

  it('falls back to RPE when RIR was not logged', () => {
    const history = session('s1', '2026-08-30', [{ weightKg: 50, reps: 10, rpe: 7 }]);
    const result = suggestProgression({ ladder: FREE_BAR, history, repRangeLow: 8, repRangeHigh: 10 });
    expect(result.outcome).toBe('increase');
    expect(result.suggestedKg).toBe(53);
  });

  it('progresses reps, not load, for bodyweight work', () => {
    const ladder = ladderFor(find('bw_pull_up'), DEFAULT_INVENTORY);
    const history = session('s1', '2026-08-30', [{ reps: 10, rir: 2, weightKg: undefined }]);
    const result = suggestProgression({ ladder, history, repRangeLow: 6, repRangeHigh: 10 });
    expect(result.outcome).toBe('increase');
    expect(result.suggestedKg).toBeUndefined();
    expect(result.reason).toMatch(/no load to add/);
  });

  it('starts at the lightest rung with no history', () => {
    const result = suggestProgression({ ladder: FREE_BAR, history: [] });
    expect(result.outcome).toBe('start');
    expect(result.suggestedKg).toBe(20);
  });

  it('reads the top set as the heaviest, breaking ties on reps', () => {
    const sets = session('s1', '2026-08-30', [
      { weightKg: 40, reps: 12 },
      { weightKg: 50, reps: 8 },
      { weightKg: 50, reps: 10 },
    ]);
    expect(topSet(sets)).toMatchObject({ weightKg: 50, reps: 10 });
  });
});
