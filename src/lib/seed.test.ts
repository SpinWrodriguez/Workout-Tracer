import { describe, expect, it } from 'vitest';
import {
  CABLE_BILATERAL,
  CABLE_SINGLE_PULLEY,
  EXERCISES,
  FREE_BAR_KG,
  SMITH_BAR_KG,
} from '../db/seed/exercises';
import { MUSCLES } from '../db/seed/muscles';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const muscleIds = new Set(MUSCLES.map((m) => m.id));

describe('exercise seed (spec §8)', () => {
  it('covers the whole equipment list with unique ids', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });

  it('references only known muscles', () => {
    for (const exercise of EXERCISES) {
      for (const m of [...exercise.primaryMuscles, ...exercise.secondaryMuscles]) {
        expect(muscleIds, `${exercise.id} → ${m}`).toContain(m);
      }
      expect(exercise.primaryMuscles.length).toBeGreaterThan(0);
    }
  });

  it('carries the bar weights from §2', () => {
    for (const exercise of EXERCISES) {
      if (exercise.station === 'free_bar') expect(exercise.barWeight).toBe(FREE_BAR_KG);
      if (exercise.station === 'smith') expect(exercise.barWeight).toBe(SMITH_BAR_KG);
    }
  });

  it('applies the cable ratios from §2 and nothing else', () => {
    for (const exercise of EXERCISES) {
      if (exercise.station === 'cable') {
        expect([CABLE_SINGLE_PULLEY, CABLE_BILATERAL, 1.0]).toContain(exercise.loadMultiplier);
      } else {
        expect(exercise.loadMultiplier).toBe(1.0);
      }
    }
  });

  it('marks every golf-sensitive movement the spec calls out as high grip', () => {
    const high = [
      'bb_rdl',
      'bb_deadlift',
      'bb_bent_over_row',
      'sm_shrug',
      'cb_lat_pulldown',
      'cb_seated_row',
      'lm_row',
      'kb_swing',
      'kb_suitcase_carry',
      'bw_pull_up',
      'bw_chin_up',
      'bw_hanging_leg_raise',
    ];
    for (const id of high) {
      expect(byId.get(id)?.gripLoad, id).toBe('high');
    }
  });

  it('flags the hinges the spec names', () => {
    for (const id of ['bb_rdl', 'bb_deadlift', 'kb_swing', 'kb_single_leg_rdl']) {
      expect(byId.get(id)?.isHinge, id).toBe(true);
    }
  });

  it('logs bands on RPE only — their load is not quantifiable', () => {
    const bands = EXERCISES.filter((e) => e.station === 'band');
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) expect(band.loadMode).toBe('rpe_only');
  });
});
