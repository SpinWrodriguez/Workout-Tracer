import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import {
  FACTOR_HIGH,
  FACTOR_LOW,
  MIN_SESSIONS,
  budgetMinutes,
  realMinutes,
  estimateOf,
  readTimeFactor,
  timeFactor,
} from './timeModel';

/*
 * The numbers here are the real ones. Three logged sessions came in at 35, 40
 * and 42 minutes against estimates of 50, 44 and 26 — the model over-estimates
 * a lifting day and badly under-estimates a rotation circuit — so a 40-minute
 * budget was buying about 28 real minutes of work on a heavy day.
 */

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDatabase();
});

describe('learning the factor', () => {
  it('says nothing until there are a few sessions to say it from', () => {
    const two = [
      { estimateMinutes: 50, actualMinutes: 35 },
      { estimateMinutes: 44, actualMinutes: 40 },
    ];
    expect(timeFactor(two)).toBeUndefined();
    expect(timeFactor([])).toBeUndefined();
    expect(two.length).toBeLessThan(MIN_SESSIONS);
  });

  it('takes the median, so one long circuit does not size every other day', () => {
    const real = [
      { estimateMinutes: 50, actualMinutes: 35 }, // 0.70
      { estimateMinutes: 44, actualMinutes: 40 }, // 0.91
      { estimateMinutes: 26, actualMinutes: 42 }, // 1.62
    ];
    /* The mean would be 1.08 — the app would then build SHORTER days off the
       back of one session that ran long, which is the opposite of the truth
       for the two lifting days. */
    expect(timeFactor(real)).toBe(0.91);
  });

  it('ignores a duration that cannot be right', () => {
    const rows = [
      { estimateMinutes: 40, actualMinutes: 36 },
      { estimateMinutes: 40, actualMinutes: 40 },
      { estimateMinutes: 40, actualMinutes: 44 },
      // Left running overnight, or typed with a stray digit.
      { estimateMinutes: 40, actualMinutes: 400 },
      { estimateMinutes: 40, actualMinutes: 2 },
    ];
    const factor = timeFactor(rows);
    expect(factor).toBe(1);
    expect(FACTOR_LOW).toBeLessThan(1);
    expect(FACTOR_HIGH).toBeGreaterThan(1);
  });

  it('skips a session with no duration on it rather than counting it as zero', () => {
    expect(
      timeFactor([
        { estimateMinutes: 40, actualMinutes: 0 },
        { estimateMinutes: 40, actualMinutes: 36 },
        { estimateMinutes: 40, actualMinutes: 40 },
      ]),
    ).toBeUndefined();
  });
});

describe('spending the budget', () => {
  it('asks for more estimate-minutes when the sessions run short', () => {
    /* The whole point: 40 real minutes at 91% of estimate is 44 minutes of
       estimated work, so the day gets the exercises it has time for. */
    expect(budgetMinutes(40, 0.91)).toBe(44);
  });

  it('asks for fewer when they run long', () => {
    expect(budgetMinutes(40, 1.3)).toBe(31);
  });

  it('leaves the budget alone with nothing learned yet', () => {
    expect(budgetMinutes(40, undefined)).toBe(40);
    expect(budgetMinutes(40, 0)).toBe(40);
  });
});

describe('what to put on a card', () => {
  it('turns an estimate into minutes on the clock', () => {
    // 44 estimate-minutes at 91% is the 40 real minutes that were asked for.
    expect(realMinutes(44, 0.91)).toBe(40);
    expect(realMinutes(31, 1.3)).toBe(40);
  });

  it('shows the estimate as-is with nothing learned yet', () => {
    expect(realMinutes(40, undefined)).toBe(40);
    expect(realMinutes(40, 0)).toBe(40);
  });

  it('round-trips the budget it sized', () => {
    /* The two directions have to agree, or a card says 34 minutes for a day
       built to a 40-minute budget. */
    for (const factor of [0.7, 0.91, 1, 1.25, 1.6]) {
      expect(Math.abs(realMinutes(budgetMinutes(40, factor), factor) - 40)).toBeLessThanOrEqual(1);
    }
  });
});

describe('reading it off the log', () => {
  /** One logged session: `sets` sets of each exercise, and a duration. */
  async function logged(id: string, date: string, exerciseIds: string[], sets: number, minutes: number) {
    await db.session.put({
      id,
      blockId: 'block_1',
      daySlot: 'A',
      date,
      durationMin: minutes,
    });
    await db.setLog.bulkPut(
      exerciseIds.flatMap((exerciseId) =>
        Array.from({ length: sets }, (_, i) => ({
          sessionId: id,
          exerciseId,
          setNo: i + 1,
          weightKg: 60,
          reps: 8,
        })),
      ),
    );
  }

  it('rebuilds each session as the model would have estimated it', async () => {
    await logged('s1', '2026-08-31', ['bb_back_squat'], 3, 30);
    const session = await db.session.get('s1');
    const sets = await db.setLog.where('sessionId').equals('s1').toArray();
    const row = estimateOf(session!, sets, byId);
    /* Five minutes of warm-up plus three sets of 40s work and 180s rest:
       300 + 3 x 220 = 960s = 16 min. */
    expect(row).toEqual({ estimateMinutes: 16, actualMinutes: 30 });
  });

  it('learns nothing from one session, and something from three', async () => {
    await logged('s1', '2026-08-31', ['bb_back_squat', 'bb_rdl'], 3, 30);
    expect(await readTimeFactor(byId)).toBeUndefined();

    await logged('s2', '2026-09-01', ['bb_bench_press', 'bb_curl'], 3, 30);
    await logged('s3', '2026-09-03', ['cb_pallof_press', 'cb_chop'], 3, 20);
    expect(await readTimeFactor(byId)).toBeGreaterThan(0);
  });

  it('ignores a session with no duration, which is every session before this existed', async () => {
    await logged('s1', '2026-08-31', ['bb_back_squat'], 3, 30);
    await logged('s2', '2026-09-01', ['bb_bench_press'], 3, 30);
    await db.session.put({ id: 's3', blockId: 'block_1', daySlot: 'A', date: '2026-09-02' });
    // Two usable sessions is still under the floor.
    expect(await readTimeFactor(byId)).toBeUndefined();
  });
});
