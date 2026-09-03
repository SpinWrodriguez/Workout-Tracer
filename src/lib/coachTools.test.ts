import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { CABLE_SINGLE_PULLEY, EXERCISES } from '../db/seed/exercises';
import type { SetLog } from '../db/types';
import { COACH_TOOLS, runCoachTool } from './coachTools';

/*
 * These are the coach's only route to the exercise library and the logs, and
 * the reason the library is not in the prompt at all. What matters here is
 * that they answer from the database rather than from anything the model said:
 * an id that does not exist comes back as an error the model can read, not as
 * a thrown exception that kills the conversation mid-answer.
 */

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDatabase();
});

/** Runs a tool the way the loop does, and parses what the model would see. */
async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
  const outcome = await runCoachTool(name, input, EXERCISES);
  return JSON.parse(outcome.content) as Record<string, unknown>;
}

async function logSession(id: string, date: string, sets: Omit<SetLog, 'sessionId'>[]) {
  await db.session.put({ id, blockId: 'block_1', daySlot: 'A', date, daySlotName: 'Lower' });
  await db.setLog.bulkPut(sets.map((set) => ({ ...set, sessionId: id })));
}

describe('the tools the coach is offered', () => {
  it('sends nothing but a name, a description and a schema', () => {
    /* The last unknown key sent to this API was rejected outright rather than
       ignored, and no test could see it because they all stub the transport.
       This is the cheap guard against doing it again. */
    for (const tool of COACH_TOOLS) {
      expect(Object.keys(tool as object).sort()).toEqual([
        'description',
        'input_schema',
        'name',
      ]);
    }
  });

  it('describes every tool, because the description is what picks it', () => {
    for (const tool of COACH_TOOLS) {
      const row = tool as { name: string; description: string };
      expect(row.description.length).toBeGreaterThan(60);
      // Named for what it does to the data, not "get" or "info".
      expect(row.name).toMatch(/^(search|exercise|session)_/);
    }
  });
});

describe('searching the library', () => {
  it('finds by part of a name', async () => {
    const result = await call('search_exercises', { query: 'squat' });
    const names = (result.exercises as { name: string }[]).map((row) => row.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.toLowerCase()).toContain('squat');
  });

  it('filters to one movement pattern', async () => {
    const result = await call('search_exercises', { pattern: 'hinge' });
    const rows = result.exercises as { id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));
    for (const row of rows) expect(byId.get(row.id)?.pattern).toBe('hinge');
  });

  it('takes a muscle by its readable name as well as its id', async () => {
    const byId = await call('search_exercises', { muscle: 'lower_back' });
    const byName = await call('search_exercises', { muscle: 'Lower Back' });
    /* A model asked for a muscle will as happily say "lower back" as
       "lower_back", and an empty result reads to it as "you cannot train
       that" — which would be a lie the app told itself. */
    expect(byId.found).toEqual(byName.found);
    expect(Number(byId.found)).toBeGreaterThan(0);
  });

  it('says how many it found even when it returns fewer', async () => {
    const result = await call('search_exercises', {});
    expect(Number(result.found)).toBe(EXERCISES.length);
    expect((result.exercises as unknown[]).length).toBe(Number(result.returned));
    // Capped: the whole point is not shipping the library into the prompt.
    expect((result.exercises as unknown[]).length).toBeLessThan(EXERCISES.length);
  });
});

describe('reading one exercise', () => {
  it('says seconds for a carry rather than printing reps against it', async () => {
    const result = await call('exercise_detail', { exerciseId: 'kb_suitcase_carry' });
    expect(result.unit).toBe('seconds');
    expect(result.range).toEqual([20, 90]);
  });

  it('reports the grip load the golf rule turns on', async () => {
    const result = await call('exercise_detail', { exerciseId: 'kb_suitcase_carry' });
    expect(result.gripLoad).toBe('high');
  });

  it('answers an unknown id with something the model can read', async () => {
    const outcome = await runCoachTool('exercise_detail', { exerciseId: 'nope' }, EXERCISES);
    expect(JSON.parse(outcome.content).error).toContain('nope');
    // Not an error result: the tool worked, the id did not exist.
    expect(outcome.isError).toBe(false);
  });
});

describe('reading the history of one exercise', () => {
  it('returns sessions newest first with the top set of each', async () => {
    await logSession('s1', '2026-01-05', [
      { exerciseId: 'bb_back_squat', setNo: 1, weightKg: 80, reps: 5 },
      { exerciseId: 'bb_back_squat', setNo: 2, weightKg: 90, reps: 3 },
    ]);
    await logSession('s2', '2026-01-12', [
      { exerciseId: 'bb_back_squat', setNo: 1, weightKg: 95, reps: 3 },
    ]);

    const result = await call('exercise_history', { exerciseId: 'bb_back_squat' });
    const sessions = result.sessions as { date: string; topSet: { weightKg: number } }[];
    expect(sessions.map((row) => row.date)).toEqual(['2026-01-12', '2026-01-05']);
    // The heaviest set of the session, not the first or the last.
    expect(sessions[1]?.topSet.weightKg).toBe(90);
  });

  it('reports what a lift counts as, not just what was loaded', async () => {
    await logSession('s1', '2026-01-05', [
      { exerciseId: 'cb_single_arm_row', setNo: 1, weightKg: 40, reps: 8 },
    ]);
    const result = await call('exercise_history', { exerciseId: 'cb_single_arm_row' });
    const top = (result.sessions as { topSet: { effectiveKg: number } }[])[0]?.topSet;
    /* One pulley moves half the stack. Comparing the loaded number across
       stations is how a PR appears out of nowhere. */
    expect(top?.effectiveKg).toBeCloseTo(40 * CABLE_SINGLE_PULLEY, 5);
    expect(Number((result.sessions as { topSet: { estimated1RM: number } }[])[0]?.topSet.estimated1RM))
      .toBeGreaterThan(40 * CABLE_SINGLE_PULLEY);
  });

  it('returns an empty history rather than an error when nothing is logged', async () => {
    const result = await call('exercise_history', { exerciseId: 'bb_deadlift' });
    expect(result.sessions).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('will not return more sessions than it is allowed to, however many are asked for', async () => {
    for (let week = 1; week <= 12; week += 1) {
      await logSession(`s${week}`, `2026-01-${String(week).padStart(2, '0')}`, [
        { exerciseId: 'bb_bench_press', setNo: 1, weightKg: 60 + week, reps: 5 },
      ]);
    }
    const result = await call('exercise_history', { exerciseId: 'bb_bench_press', sessions: 99 });
    expect((result.sessions as unknown[]).length).toBeLessThanOrEqual(8);
    // Still the most recent ones, not the first eight it happened to read.
    expect((result.sessions as { date: string }[])[0]?.date).toBe('2026-01-12');
  });
});

describe('a tool that does not exist', () => {
  it('comes back as an error result rather than throwing', async () => {
    const outcome = await runCoachTool('delete_everything', {}, EXERCISES);
    expect(outcome.isError).toBe(true);
    expect(JSON.parse(outcome.content).error).toContain('delete_everything');
  });
});

describe('reading one session', () => {
  /** A session with a planned count, so "never started" is answerable. */
  async function logPlanned() {
    await db.session.put({
      id: 's_mon',
      blockId: 'block_1',
      daySlot: 'A',
      daySlotName: 'Lower body',
      date: '2026-08-31',
      durationMin: 35,
      plannedSets: { bb_back_squat: 3, bb_rdl: 3, bw_pull_up: 3 },
    });
    await db.setLog.bulkPut([
      { sessionId: 's_mon', exerciseId: 'bb_back_squat', setNo: 1, reps: 8, weightKg: 80, effectiveKg: 80, rir: 2 },
      { sessionId: 's_mon', exerciseId: 'bb_back_squat', setNo: 2, reps: 8, weightKg: 85, effectiveKg: 85, rir: 1 },
      { sessionId: 's_mon', exerciseId: 'bb_rdl', setNo: 1, reps: 10, weightKg: 70, effectiveKg: 70 },
    ]);
  }

  it('finds it by date and reports it set by set', async () => {
    await logPlanned();
    const result = await call('session_detail', { date: '2026-08-31' });
    expect(result).toMatchObject({ date: '2026-08-31', workout: 'Lower body', minutes: 35 });
    expect(result.setsDone).toBe(3);
    expect(result.setsPlanned).toBe(9);

    const lifts = result.exercises as { name: string; sets: unknown[] }[];
    const squat = lifts.find((row) => row.name === 'Back squat');
    expect(squat?.sets).toHaveLength(2);
    expect(squat?.sets[1]).toMatchObject({ weightKg: 85, reps: 8, rir: 1 });
  });

  it('names what was programmed and never started', async () => {
    await logPlanned();
    const result = await call('session_detail', { date: '2026-08-31' });
    // The one thing a set log cannot say: there is no row for it.
    expect(result.notStarted).toEqual(['Pull-up']);
  });

  it('reports what a lift actually loaded, not just what was on it', async () => {
    /* A single cable pulley moves about half the stack, and comparing the
       number on the machine across stations is how a PR appears from nothing. */
    await logSession('s_cable', '2026-09-01', [
      { exerciseId: 'cb_single_arm_row', setNo: 1, reps: 12, weightKg: 40 },
    ]);
    const result = await call('session_detail', { date: '2026-09-01' });
    const [lift] = result.exercises as { sets: { weightKg: number; effectiveKg?: number }[] }[];
    expect(lift?.sets[0]?.weightKg).toBe(40);
    expect(lift?.sets[0]?.effectiveKg).toBeCloseTo(40 * CABLE_SINGLE_PULLEY, 5);
  });

  it('comes back as an error the model can read, not a crash', async () => {
    const missing = await call('session_detail', { date: '2019-01-01' });
    expect(String(missing.error)).toMatch(/No session/);
    // Nothing asked for at all is the same: an answer, not an exception.
    expect(String((await call('session_detail', {})).error)).toMatch(/No session/);
  });
});
