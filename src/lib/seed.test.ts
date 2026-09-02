import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { DEFAULT_BLOCK_ID, seedDatabase } from '../db/seed';
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

  it('carries the bar weights from §2 on everything that is actually loaded', () => {
    for (const exercise of EXERCISES) {
      // An inverted row uses the Smith bar without loading it, so it carries no
      // bar weight — the rule is about what you put plates on.
      if (exercise.loadMode !== 'weight') continue;
      if (exercise.station === 'free_bar') expect(exercise.barWeight, exercise.id).toBe(FREE_BAR_KG);
      if (exercise.station === 'smith') expect(exercise.barWeight, exercise.id).toBe(SMITH_BAR_KG);
    }
  });

  it('gives a bar-station exercise a bar weight only when it is loaded', () => {
    const inverted = EXERCISES.find((e) => e.id === 'sm_inverted_row');
    expect(inverted?.station).toBe('smith');
    expect(inverted?.loadMode).toBe('bodyweight');
    expect(inverted?.barWeight).toBeUndefined();
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

describe('the rotational and explosive additions', () => {
  const find = (id: string) => EXERCISES.find((e) => e.id === id);

  it('trains the hip-then-torso sequence the swing depends on', () => {
    const rotational = EXERCISES.filter((e) => e.pattern === 'rotation' && !e.isMobility);
    expect(rotational.length).toBeGreaterThanOrEqual(9);
    // The two that most directly train the sequence.
    expect(find('lm_scoop')?.pattern).toBe('rotation');
    expect(find('lm_rotational_press')?.pattern).toBe('rotation');
    for (const exercise of rotational) expect(exercise.spinalLoad, exercise.id).not.toBe('high');
  });

  it('marks power work explosive so it can be ordered first', () => {
    const explosive = EXERCISES.filter((e) => e.isExplosive).map((e) => e.id);
    expect(explosive).toEqual(
      expect.arrayContaining(['kb_clean', 'kb_high_pull', 'sm_push_press', 'bw_jump_squat', 'lm_scoop']),
    );
  });

  it('gives the generator a horizontal pull that is not grip-heavy', () => {
    const row = find('sm_inverted_row');
    expect(row?.pattern).toBe('pull_h');
    expect(row?.gripLoad).not.toBe('high');
    // It is the only one, which is why it matters near a round.
    const safePulls = EXERCISES.filter(
      (e) => e.pattern === 'pull_h' && e.gripLoad !== 'high' && e.primaryMuscles.includes('upper_back'),
    );
    expect(safePulls.map((e) => e.id)).toContain('sm_inverted_row');
  });

  it('offers a leg raise that does not hang from the hands', () => {
    const hanging = find('bw_hanging_leg_raise');
    const supported = find('bw_captains_knee_raise');
    expect(hanging?.gripLoad).toBe('high');
    expect(supported?.pattern).toBe(hanging?.pattern);
    expect(supported?.gripLoad).toBe('none');
  });

  it('keeps mobility out of working sets and out of volume', () => {
    const mobility = EXERCISES.filter((e) => e.isMobility);
    expect(mobility.map((e) => e.id)).toEqual(['mb_open_book', 'mb_90_90']);
    for (const exercise of mobility) {
      expect(exercise.loadMode, exercise.id).toBe('rpe_only');
      expect(exercise.pattern, exercise.id).toBe('rotation');
    }
  });
});

describe('the four data fixes', () => {
  const find = (id: string) => EXERCISES.find((e) => e.id === id);

  it('treats a get-up as grip-heavy, because it is a loaded overhead hold', () => {
    expect(find('kb_turkish_get_up')?.gripLoad).toBe('high');
  });

  it('moves the loaded split squat off the bodyweight station', () => {
    const split = find('bw_split_squat');
    expect(split?.loadMode).toBe('weight');
    expect(split?.station).toBe('kettlebell');
    // The id keeps its old prefix: renaming it would orphan every logged set.
    expect(split?.id).toBe('bw_split_squat');
  });

  it('leaves the unloaded glute bridge as bodyweight, with a loaded sibling', () => {
    expect(find('bw_glute_bridge')?.loadMode).toBe('bodyweight');
    expect(find('bb_hip_thrust')?.loadMode).toBe('weight');
  });

  it('has no exercise whose station and load mode disagree', () => {
    for (const exercise of EXERCISES) {
      if (exercise.station === 'bodyweight') {
        expect(exercise.loadMode, exercise.id).not.toBe('weight');
      }
    }
  });
});

describe('an exercise the seed no longer lists', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  /** An exercise on the device that the seed file does not have. */
  const stale = async () => {
    const template = EXERCISES[0];
    if (!template) throw new Error('the seed is empty');
    await db.exercise.put({ ...template, id: 'bw_ab_wheel', name: 'Ab wheel rollout' });
  };

  it('is taken off the device, because bulkPut never removes anything', async () => {
    /*
     * The ab wheel rollout was the first removal — there is no ab wheel in
     * this garage. Dropping it from the seed file is not enough on its own:
     * every installed device would have gone on offering it in the picker,
     * and the generator could still have drawn it.
     */
    await stale();
    await seedDatabase();
    expect(await db.exercise.get('bw_ab_wheel')).toBeUndefined();
  });

  it('stays if a set was ever logged against it, so History keeps its name', async () => {
    await stale();
    await db.session.put({
      id: 's1',
      blockId: DEFAULT_BLOCK_ID,
      daySlot: 'A',
      date: '2026-01-05',
    });
    await db.setLog.put({ sessionId: 's1', exerciseId: 'bw_ab_wheel', setNo: 1, reps: 10 });

    await seedDatabase();

    /* A removal must never turn a logged session into a raw id on the History
       screen. The seed decides what is OFFERED, not what happened. */
    expect(await db.exercise.get('bw_ab_wheel')).toBeDefined();
  });

  it('leaves the seeded exercises alone', async () => {
    await seedDatabase();
    expect(await db.exercise.count()).toBe(EXERCISES.length);
  });
});
