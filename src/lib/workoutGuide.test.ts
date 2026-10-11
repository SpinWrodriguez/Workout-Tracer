import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { BlockExercise } from '../db/types';
import { workoutGuide } from './workoutGuide';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const rows = (...ids: string[]): BlockExercise[] =>
  ids.map((exerciseId, order) => ({ blockId: 'b', exerciseId, daySlot: 'A', targetSets: 3, repRangeLow: 8, repRangeHigh: 12, order }));

describe('the guide line', () => {
  it('reads a heavy lower day off its lifts and keeps it off the golf eve', () => {
    const g = workoutGuide(rows('bw_jump_squat', 'bb_back_squat', 'bb_rdl', 'cb_leg_curl'), byId, [6]);
    expect(g).toMatchObject({ body: 'Lower', heavyLegs: true, grip: true, spine: true, golfSafe: false });
    expect(g?.fits).toEqual([1, 2, 3, 4, 6, 7]);
    expect(g?.line).toBe('Lower, heavy legs and grip: not Fri (golf next day). Keep a day between this and any other heavy lower day.');
  });

  it('calls a push day golf-safe and lets it go anywhere', () => {
    const g = workoutGuide(rows('cb_chop', 'bb_bench_press', 'db_shoulder_press', 'cb_lateral_raise'), byId, [6]);
    expect(g).toMatchObject({ body: 'Upper', golfSafe: true });
    expect(g?.fits).toHaveLength(7);
    expect(g?.line).toBe('Upper, golf-safe: any day, the day before golf included. Fine the day after a lower day.');
  });

  it('flags grip on a pull day without heavy legs', () => {
    const g = workoutGuide(rows('cb_lat_pulldown', 'bb_hip_thrust', 'cb_seated_row', 'bb_curl'), byId, [6]);
    expect(g).toMatchObject({ body: 'Upper', heavyLegs: false, grip: true, golfSafe: false });
    expect(g?.line).toMatch(/^Upper, grip: not Fri/);
  });

  it('is nothing for an empty workout', () => {
    expect(workoutGuide([], byId, [6])).toBeUndefined();
  });
});
