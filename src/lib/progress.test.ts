import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { SetLog } from '../db/types';
import { shiftIso } from './format';
import { exerciseTrends, muscleTrends, seriesTrend, weekStarts, weeklyVolume } from './progress';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
/* A Thursday, so "this week" is a part-week with Monday to Wednesday in it. */
const TODAY = '2026-10-01';

function set(sessionId: string, exerciseId: string, reps: number, kg?: number): SetLog {
  return { sessionId, exerciseId, setNo: 1, reps, weightKg: kg, effectiveKg: kg };
}

describe('weekStarts', () => {
  it('runs oldest first and ends on the Monday of this week', () => {
    expect(weekStarts(TODAY, 3)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
  });
});

describe('weeklyVolume', () => {
  it('buckets sets by Monday, keeps empty weeks and leaves mobility out', () => {
    const weeks = weekStarts(TODAY, 3);
    const dates = new Map([
      ['a', '2026-09-15'],
      ['b', '2026-09-30'],
    ]);
    const logs = [
      set('a', 'bb_bench_press', 10, 60),
      set('a', 'bb_bench_press', 8, 60),
      set('b', 'bb_bench_press', 10, 62.5),
      set('b', 'mb_90_90', 5),
    ];
    const rows = weeklyVolume(logs, dates, byId, weeks);
    expect(rows.map((row) => row.sets)).toEqual([2, 0, 1]);
    expect(rows[0]?.tonnageKg).toBe(1080);
    expect(rows[0]?.muscles.chest).toBe(2);
    expect(rows[0]?.muscles.triceps).toBe(1);
  });
});

describe('seriesTrend', () => {
  it('ignores the week in progress', () => {
    // Four steady weeks of 10, four of 10, then a Tuesday with 2 so far.
    const result = seriesTrend([10, 10, 10, 10, 10, 10, 10, 10, 2]);
    expect(result).toEqual({ trend: 'flat', recent: 10, prior: 10 });
  });

  it('calls a rise and a fall past a set a week', () => {
    expect(seriesTrend([6, 6, 6, 6, 9, 9, 9, 9, 0]).trend).toBe('up');
    expect(seriesTrend([9, 9, 9, 9, 6, 6, 6, 6, 0]).trend).toBe('down');
  });

  it('holds a half-set wobble as flat', () => {
    expect(seriesTrend([6, 6, 6, 6, 6.5, 6.5, 6, 6.5, 0]).trend).toBe('flat');
  });

  it('separates newly trained and dropped muscles from a trend', () => {
    expect(seriesTrend([0, 0, 0, 0, 3, 3, 3, 3, 0]).trend).toBe('new');
    expect(seriesTrend([3, 3, 3, 3, 0, 0, 0, 0, 0]).trend).toBe('idle');
    expect(seriesTrend([0, 0, 0, 0, 0, 0, 0, 0, 0]).trend).toBe('flat');
  });
});

describe('muscleTrends', () => {
  it('gives every muscle a row, trained or not', () => {
    const weeks = weekStarts(TODAY, 9);
    const rows = muscleTrends(weeklyVolume([], new Map(), byId, weeks));
    expect(rows).toHaveLength(18);
    expect(rows.every((row) => row.series.length === 9)).toBe(true);
  });
});

describe('exerciseTrends', () => {
  const recent = shiftIso(TODAY, -3);
  const prior = shiftIso(TODAY, -40);

  it('compares estimated 1-RM, so heavier for fewer reps can still be a rise', () => {
    const dates = new Map([
      ['old', prior],
      ['new', recent],
    ]);
    const rows = exerciseTrends(
      [set('old', 'bb_bench_press', 10, 60), set('new', 'bb_bench_press', 8, 67.5)],
      dates,
      byId,
      TODAY,
    );
    // 60 x 10 = 80 e1RM; 67.5 x 8 = 85.5 e1RM.
    expect(rows[0]).toMatchObject({ metricLabel: 'e1RM', priorBest: 80, recentBest: 85.5, trend: 'up' });
  });

  it('tracks reps for bodyweight work and orders by most recently trained', () => {
    const dates = new Map([
      ['old', prior],
      ['mid', shiftIso(TODAY, -10)],
      ['new', recent],
    ]);
    const rows = exerciseTrends(
      [
        set('old', 'bw_pull_up', 8),
        set('mid', 'bw_pull_up', 8),
        set('new', 'sm_calf_raise', 15, 40),
      ],
      dates,
      byId,
      TODAY,
    );
    expect(rows.map((row) => row.exerciseId)).toEqual(['sm_calf_raise', 'bw_pull_up']);
    expect(rows[1]).toMatchObject({ metricLabel: 'reps', trend: 'flat', sessions: 2 });
    expect(rows[0]?.trend).toBe('new');
  });

  it('marks a lift not done in four weeks as idle, and forgets older ones', () => {
    const dates = new Map([
      ['old', prior],
      ['ancient', shiftIso(TODAY, -90)],
    ]);
    const rows = exerciseTrends(
      [set('old', 'bb_bench_press', 10, 60), set('ancient', 'bb_back_squat', 5, 100)],
      dates,
      byId,
      TODAY,
    );
    expect(rows.map((row) => [row.exerciseId, row.trend])).toEqual([['bb_bench_press', 'idle']]);
  });
});
