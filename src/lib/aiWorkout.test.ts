import { describe, expect, it, vi } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import {
  SYSTEM_PROMPT,
  WORKOUT_SCHEMA,
  buildSystem,
  buildUser,
  generateAiWorkout,
  libraryFor,
  parseWorkout,
  type AiWorkout,
} from './aiWorkout';
import { buildRequest, MODEL } from './askModel';
import type { Violation } from './blockValidation';

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
const ok = () => [] as Violation[];

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Easy Upper',
    focus: 'upper',
    intensity: 'light',
    why: 'Light pulling and pressing, nothing that taxes the back.',
    exercises: [
      { exerciseId: 'bb_overhead_press', sets: 2, repLow: 10, repHigh: 12 },
      { exerciseId: 'bw_chin_up', sets: 2, repLow: 5, repHigh: 8 },
      { exerciseId: 'cb_seated_row', sets: 2, repLow: 12, repHigh: 15 },
    ],
    ...over,
  });

const asker = (...replies: string[]) => {
  const calls: unknown[] = [];
  const ask = vi.fn(async (options: unknown) => {
    calls.push(options);
    return { text: replies[Math.min(calls.length - 1, replies.length - 1)], transport: 'edge' as const };
  });
  return { ask, calls };
};

describe('what the model is shown', () => {
  it('offers the whole library except warm-up movement', () => {
    const rows = libraryFor(EXERCISES);
    expect(rows).toHaveLength(EXERCISES.filter((e) => !e.isMobility).length);
    expect(rows.some((r) => byId.get(r.id)?.isMobility)).toBe(false);
  });

  it("carries each exercise's own rep bounds and unit, not a global range", () => {
    const rows = libraryFor(EXERCISES);
    const timed = rows.filter((r) => r.unit === 'seconds');
    expect(timed.length).toBeGreaterThan(0);
    for (const row of rows) {
      const exercise = byId.get(row.id) as (typeof EXERCISES)[number];
      expect(row.reps).toEqual([exercise.repMin, exercise.repMax]);
    }
  });

  it('withholds anything that would let it compute a budget or a weight', () => {
    const serialised = JSON.stringify(libraryFor(EXERCISES));
    for (const field of ['restSeconds', 'loadMultiplier', 'barWeight', 'freeDbId']) {
      expect(serialised, field).not.toContain(field);
    }
  });

  it('tells the model nothing about the calendar', () => {
    const system = buildSystem(EXERCISES);
    const user = buildUser('easy one today', [
      { slot: 'A', name: 'Upper', intensity: 'heavy', exerciseIds: ['bb_bench_press'] },
    ]);
    // No weekday, no date, no golf. It cannot reason about placement because it
    // is not given placement.
    for (const leak of ['weekday', 'Monday', 'golf', 'Saturday', 'date']) {
      expect(user.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
    expect(system).toContain('Say nothing about the calendar');
  });

  it('puts the library in the cached prefix and the goal after it', () => {
    const request = buildRequest({
      system: buildSystem(EXERCISES),
      user: buildUser('tired today', []),
      schema: WORKOUT_SCHEMA,
      schemaName: 'workout',
    });
    expect(request.model).toBe(MODEL);
    const system = request.system as { cache_control?: unknown }[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(request.messages)).toContain('tired today');
    // The volatile goal must not be inside the cached block.
    expect(JSON.stringify(system)).not.toContain('tired today');
  });
});

describe('the output contract', () => {
  it('gives the model no way to express a placement', () => {
    const serialised = JSON.stringify(WORKOUT_SCHEMA);
    for (const field of ['weekday', 'date', 'slot', 'daySlot']) {
      expect(serialised, field).not.toContain(field);
    }
  });

  it('gives the model no way to ask for a weight', () => {
    expect(JSON.stringify(WORKOUT_SCHEMA)).not.toContain('eight');
  });

  it('is closed, so an invented field is a schema error not a surprise', () => {
    expect(WORKOUT_SCHEMA.additionalProperties).toBe(false);
    expect(WORKOUT_SCHEMA.properties.exercises.items.additionalProperties).toBe(false);
  });
});

describe('reading a reply', () => {
  it('maps a good reply onto BlockExercise rows in the order given', () => {
    const parsed = parseWorkout(reply(), 'b1', 'A', byId);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workout.exercises.map((e) => e.exerciseId)).toEqual([
      'bb_overhead_press',
      'bw_chin_up',
      'cb_seated_row',
    ]);
    expect(parsed.workout.exercises.map((e) => e.order)).toEqual([0, 1, 2]);
    expect(parsed.workout.exercises.every((e) => e.daySlot === 'A')).toBe(true);
    expect(parsed.workout.intensity).toBe('light');
  });

  it('never carries a weight through, whatever the model sent', () => {
    const parsed = parseWorkout(
      reply({
        exercises: [{ exerciseId: 'bb_back_squat', sets: 3, repLow: 8, repHigh: 10, startWeightKg: 137 }],
      }),
      'b1',
      'A',
      byId,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workout.exercises[0]?.startWeightKg).toBeUndefined();
  });

  it("clamps a rep range to the exercise's own bounds", () => {
    // A Turkish get-up is not a 20-rep movement.
    const getUp = byId.get('kb_turkish_get_up');
    const parsed = parseWorkout(
      reply({ exercises: [{ exerciseId: 'kb_turkish_get_up', sets: 2, repLow: 15, repHigh: 20 }] }),
      'b1',
      'A',
      byId,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !getUp) return;
    const row = parsed.workout.exercises[0];
    expect(row?.repRangeLow).toBeGreaterThanOrEqual(getUp.repMin);
    expect(row?.repRangeHigh).toBeLessThanOrEqual(getUp.repMax);
  });

  it('rejects an invented id rather than quietly dropping it', () => {
    // A workout two exercises short with no explanation is worse than a retry.
    const parsed = parseWorkout(
      reply({
        exercises: [
          { exerciseId: 'bb_overhead_press', sets: 2, repLow: 10, repHigh: 12 },
          { exerciseId: 'leg_press_machine', sets: 3, repLow: 10, repHigh: 12 },
        ],
      }),
      'b1',
      'A',
      byId,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure).toEqual({ kind: 'unknown_exercises', ids: ['leg_press_machine'] });
  });

  it('drops a duplicate id, which would collide on the compound key', () => {
    const parsed = parseWorkout(
      reply({
        exercises: [
          { exerciseId: 'bb_overhead_press', sets: 2, repLow: 10, repHigh: 12 },
          { exerciseId: 'bb_overhead_press', sets: 3, repLow: 8, repHigh: 10 },
        ],
      }),
      'b1',
      'A',
      byId,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workout.exercises).toHaveLength(1);
  });

  it('rejects prose, an empty list and an unknown focus', () => {
    expect(parseWorkout('Here is a nice workout!', 'b1', 'A', byId).ok).toBe(false);
    expect(parseWorkout(reply({ exercises: [] }), 'b1', 'A', byId).ok).toBe(false);
    expect(parseWorkout(reply({ focus: 'arms' }), 'b1', 'A', byId).ok).toBe(false);
  });
});

describe('the validate-and-retry loop', () => {
  const base = {
    blockId: 'b1',
    slot: 'A' as const,
    user: buildUser('today I feel tired, generate a nice easy workout', []),
    exercises: EXERCISES,
  };

  it('accepts a first reply that passes', async () => {
    const { ask, calls } = asker(reply());
    const outcome = await generateAiWorkout({ ...base, validate: ok, ask: ask as never });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('hands the violations back and takes the repaired reply', async () => {
    const { ask, calls } = asker(
      reply({ exercises: [{ exerciseId: 'bb_deadlift', sets: 3, repLow: 5, repHigh: 5 }] }),
      reply(),
    );
    let first = true;
    const validate = () => {
      if (!first) return [];
      first = false;
      return [
        { code: 'grip_conflict' as const, message: 'Deadlift is two days before your round.' },
      ];
    };
    const outcome = await generateAiWorkout({ ...base, validate, ask: ask as never });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // The retry carries the rejection and the specific violation.
    const retry = JSON.stringify(calls[1]);
    expect(retry).toContain('was rejected');
    expect(retry).toContain('grip_conflict');
  });

  it('does not retry over a suggestion the lifter may overrule', async () => {
    const { ask, calls } = asker(reply());
    const outcome = await generateAiWorkout({
      ...base,
      // over_time_budget is advice, not a problem.
      validate: () => [{ code: 'over_time_budget', message: 'Runs 7 minutes long.' }],
      ask: ask as never,
    });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the bounded number of attempts rather than looping', async () => {
    const { ask, calls } = asker(reply());
    const outcome = await generateAiWorkout({
      ...base,
      validate: () => [{ code: 'spinal_stacking', message: 'Two heavy spinal lifts.' }],
      ask: ask as never,
    });
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(3);
    if (outcome.ok) return;
    expect(outcome.violations?.[0]?.code).toBe('spinal_stacking');
  });

  it('reports a transport failure instead of throwing', async () => {
    const ask = vi.fn(async () => ({ transport: 'none' as const, error: 'No model key set.' }));
    const outcome = await generateAiWorkout({ ...base, validate: ok, ask: ask as never });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('No model key set.');
  });

  it('re-asks when the reply cannot be read at all', async () => {
    const { ask, calls } = asker('not json', reply());
    const outcome = await generateAiWorkout({ ...base, validate: ok, ask: ask as never });
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1])).toContain('not valid JSON');
  });
});

describe('the prompt itself', () => {
  it('forbids inventing an exercise, in those terms', () => {
    expect(SYSTEM_PROMPT).toContain('Never invent an exercise');
  });

  it('tells the model its answer is a proposal that gets checked', () => {
    expect(SYSTEM_PROMPT).toContain('Your answer is a proposal');
  });

  it('maps tiredness onto light, since that is the whole use case', () => {
    expect(SYSTEM_PROMPT).toMatch(/"?Tired"?.*light/is);
  });
});

/* A stand-in for the caller: proves the shape lines up with what gets written. */
describe('what the app does with it', () => {
  it('produces rows that only need a blockId and a slot to be written', () => {
    const parsed = parseWorkout(reply(), 'block_1', 'C', byId);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const workout: AiWorkout = parsed.workout;
    for (const row of workout.exercises) {
      expect(row.blockId).toBe('block_1');
      expect(row.daySlot).toBe('C');
      expect(row.targetSets).toBeGreaterThan(0);
      expect(row.repRangeHigh).toBeGreaterThanOrEqual(row.repRangeLow);
    }
  });
});
