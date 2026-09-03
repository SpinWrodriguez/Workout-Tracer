import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { SetLog } from '../db/types';
import {
  VOLUME_HIGH,
  VOLUME_LOW,
  setsPerMuscle,
  volumeIntensity,
  volumeRows,
  volumeStatus,
  perWeek,
} from './volume';
import { estimate1RM, linearTrend, rollingAverage, timeframeCutoff } from './stats';
import { rate } from './format';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));

function sets(exerciseId: string, count: number): SetLog[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: 's1',
    exerciseId,
    setNo: i + 1,
    reps: 10,
    weightKg: 50,
    effectiveKg: 50,
  }));
}

describe('Phase 4 acceptance — set counts behind the silhouette', () => {
  /*
   * A hand-calculated week. Two sessions:
   *   3 × back squat      primary quads, glutes
   *                       secondary hamstrings, adductors, lower_back, abs
   *   3 × bench press     primary chest
   *                       secondary front_delts, triceps
   *   3 × pull-up         primary lats
   *                       secondary upper_back, biceps, forearms, rear_delts, abs
   *   2 × plank           primary abs
   *                       secondary obliques, front_delts
   */
  const week = [
    ...sets('bb_back_squat', 3),
    ...sets('bb_bench_press', 3),
    ...sets('bw_pull_up', 3),
    ...sets('bw_plank', 2),
  ];
  const volume = setsPerMuscle(week, byId);

  it('matches the hand-calculated counts exactly', () => {
    expect(volume.quads).toBe(3); // squat primary
    expect(volume.glutes).toBe(3); // squat primary
    expect(volume.hamstrings).toBe(1.5); // squat secondary, 3 × 0.5
    expect(volume.adductors).toBe(1.5);
    expect(volume.lower_back).toBe(1.5);
    expect(volume.chest).toBe(3); // bench primary
    expect(volume.triceps).toBe(1.5); // bench secondary
    expect(volume.lats).toBe(3); // pull-up primary
    expect(volume.upper_back).toBe(1.5);
    expect(volume.biceps).toBe(1.5);
    expect(volume.forearms).toBe(1.5);
    expect(volume.rear_delts).toBe(1.5);
    expect(volume.obliques).toBe(1); // plank secondary, 2 × 0.5
    // Three sources: squat secondary 1.5, pull-up secondary 1.5, plank primary 2.
    expect(volume.abs).toBe(5);
    // Bench secondary 1.5 plus plank secondary 1.
    expect(volume.front_delts).toBe(2.5);
    expect(volume.calves).toBe(0);
  });

  it('never leaves float dust in a half-set total', () => {
    for (const value of Object.values(volume)) {
      expect(value * 2).toBe(Math.round(value * 2));
    }
  });

  it('ranks the list heaviest first', () => {
    const rows = volumeRows(volume);
    expect(rows[0]?.muscleId).toBe('abs');
    expect(rows.map((r) => r.sets)).toEqual([...rows.map((r) => r.sets)].sort((a, b) => b - a));
  });
});

describe('volume flags', () => {
  it('flags below 8 and above 20 sets a week', () => {
    expect(VOLUME_LOW).toBe(8);
    expect(VOLUME_HIGH).toBe(20);
    expect(volumeStatus(0)).toBe('none');
    expect(volumeStatus(7.5)).toBe('low');
    expect(volumeStatus(8)).toBe('ok');
    expect(volumeStatus(20)).toBe('ok');
    expect(volumeStatus(20.5)).toBe('high');
  });

  it('shades the silhouette from nothing to full at the top of the range', () => {
    expect(volumeIntensity(0)).toBe(0);
    expect(volumeIntensity(10)).toBe(0.5);
    expect(volumeIntensity(20)).toBe(1);
    expect(volumeIntensity(40)).toBe(1);
  });
});

describe('1-RM estimates', () => {
  it('uses effective kg, so cable and barbell work are comparable', () => {
    // A 50 kg single-pulley row is 24.5 kg effective; a 50 kg squat is 50.
    const cable = estimate1RM(24.5, 10);
    const bar = estimate1RM(50, 10);
    expect(cable).toBeCloseTo(32.67, 1);
    expect(bar).toBeCloseTo(66.67, 1);
    expect(cable).toBeLessThan(bar);
  });

  it('returns the load itself for a single', () => {
    expect(estimate1RM(96, 1)).toBe(96);
  });

  it('is zero for unloadable work', () => {
    expect(estimate1RM(0, 10)).toBe(0);
  });
});

describe('body weight trend', () => {
  /**
   * The real dataset is 77 days of daily weigh-ins trending at −0.35 kg/week.
   * Reproduced here as 77 synthetic days on exactly that slope plus a
   * deterministic day-to-day wobble, since real weigh-ins are never smooth.
   */
  const dataset = Array.from({ length: 77 }, (_, i) => {
    const date = new Date(2026, 5, 1 + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    const wobble = Math.sin(i * 1.7) * 0.35 + Math.cos(i * 0.6) * 0.2;
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      value: Math.round((84.5 - (0.35 / 7) * i + wobble) * 10) / 10,
    };
  });

  it('recovers −0.35 kg/week from the 77-day series', () => {
    const trend = linearTrend(dataset);
    expect(trend.perWeek).toBeCloseTo(-0.35, 2);
    expect(trend.r2).toBeGreaterThan(0.9);
  });

  it('measures the slope in elapsed days, so a gap does not stretch it', () => {
    const gappy = [
      { date: '2026-06-01', value: 84 },
      { date: '2026-06-08', value: 83.5 },
      { date: '2026-07-06', value: 81.5 },
    ];
    // 35 days, 2.5 kg lost — 0.5 kg/week.
    expect(linearTrend(gappy).perWeek).toBeCloseTo(-0.5, 1);
  });

  it('smooths the daily noise with a 7-day trailing average', () => {
    const smoothed = rollingAverage(dataset, 7);
    expect(smoothed).toHaveLength(dataset.length);
    // The first point has nothing to average with, so it is itself.
    expect(smoothed[0]?.value).toBe(dataset[0]?.value);
    const spread = (list: { value: number }[]) => {
      const diffs = list.slice(1).map((p, i) => Math.abs(p.value - (list[i]?.value ?? 0)));
      return diffs.reduce((a, b) => a + b, 0) / diffs.length;
    };
    expect(spread(smoothed)).toBeLessThan(spread(dataset));
  });

  it('is flat and unfitted with fewer than two points', () => {
    expect(linearTrend([]).perWeek).toBe(0);
    expect(linearTrend([{ date: '2026-06-01', value: 82 }]).perWeek).toBe(0);
  });
});

describe('timeframe toggle', () => {
  it('cuts off the right number of days back', () => {
    expect(timeframeCutoff('1W', '2026-08-31')).toBe('2026-08-24');
    expect(timeframeCutoff('1M', '2026-08-31')).toBe('2026-08-01');
    expect(timeframeCutoff('1Y', '2026-08-31')).toBe('2025-08-31');
    expect(timeframeCutoff('All', '2026-08-31')).toBeUndefined();
  });
});

describe('rate formatting', () => {
  it('keeps two decimals so −0.35 does not read as −0.3', () => {
    expect(rate(-0.35)).toBe('-0.35');
    expect(rate(0.35)).toBe('+0.35');
    expect(rate(0)).toBe('0.00');
    expect(rate(undefined)).toBe('--');
  });
});

describe('averaging a longer window', () => {
  it('leaves a single week alone', () => {
    const volume = setsPerMuscle(
      [{ sessionId: 's', exerciseId: 'bb_back_squat', setNo: 1, reps: 8 }],
      byId,
    );
    expect(perWeek(volume, 1)).toBe(volume);
  });

  it('divides by the weeks, so the floor still means what it means', () => {
    /* 13 sets of squats over 13 weeks is one a week — light. The same 13 in
       one week is not. Judging a quarter against a weekly floor without
       dividing first is the bug this exists to prevent. */
    const logs = Array.from({ length: 13 }, (_, i) => ({
      sessionId: 's',
      exerciseId: 'bb_back_squat',
      setNo: i + 1,
      reps: 8,
    }));
    const quarter = perWeek(setsPerMuscle(logs, byId), 13);
    expect(quarter.quads).toBe(1);
    expect(volumeStatus(quarter.quads)).toBe('low');
    expect(volumeStatus(setsPerMuscle(logs, byId).quads)).toBe('ok');
  });

  it('keeps halves, because half a set is a real amount here', () => {
    const logs = Array.from({ length: 6 }, (_, i) => ({
      sessionId: 's',
      exerciseId: 'bb_back_squat',
      setNo: i + 1,
      reps: 8,
    }));
    /* Six sets over four weeks is 1.5 a week, and 1.5 is exactly what a
       secondary muscle earns from one set — so rounding it to 2 would print a
       number the log cannot produce. */
    expect(perWeek(setsPerMuscle(logs, byId), 4).quads).toBe(1.5);
  });

  it('keeps every muscle in the result, including the untrained ones', () => {
    const volume = perWeek(setsPerMuscle([], byId), 13);
    expect(Object.keys(volume)).toHaveLength(18);
    expect(volume.calves).toBe(0);
  });
});

describe('a muscle that averages to nothing', () => {
  it('is still distinguishable from one never trained', () => {
    /* Levels reads both: the average for the bars and the raw total for "was
       this trained at all". A muscle with three weighted sets over thirteen
       weeks averages to 0.1, rounds to zero, and had fallen out of the
       flagged list and the untrained list at once. */
    const logs = Array.from({ length: 3 }, (_, i) => ({
      sessionId: 's',
      exerciseId: 'bb_back_squat',
      setNo: i + 1,
      reps: 8,
    }));
    const raw = setsPerMuscle(logs, byId);
    const quarter = perWeek(raw, 13);
    expect(raw.quads).toBeGreaterThan(0);
    expect(quarter.quads).toBe(0);
    // Which is why the screen cannot read "trained" off the average alone.
    expect(volumeStatus(quarter.quads)).toBe('none');
  });
});
