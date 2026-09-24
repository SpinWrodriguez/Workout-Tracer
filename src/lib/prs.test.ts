import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { SetLog } from '../db/types';
import { describePr, prEvents } from './prs';

const byId = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

const log = (
  sessionId: string,
  exerciseId: string,
  over: Partial<SetLog> = {},
): SetLog => ({ sessionId, exerciseId, setNo: 1, reps: 8, ...over });

const dates = (pairs: [string, string][]) => new Map(pairs);

describe('personal records', () => {
  it('never calls the first-ever session a record', () => {
    /* Day one, everything is a best; a record needs a before to beat. */
    const events = prEvents(
      [log('s1', 'bb_bench_press', { effectiveKg: 60 })],
      dates([['s1', '2026-09-01']]),
      byId,
    );
    expect(events.size).toBe(0);
  });

  it('flags a strict improvement, on the day it happened', () => {
    const events = prEvents(
      [
        log('s1', 'bb_bench_press', { effectiveKg: 60 }),
        log('s2', 'bb_bench_press', { effectiveKg: 62.5 }),
        log('s3', 'bb_bench_press', { effectiveKg: 62.5 }), // a tie is not a record
      ],
      dates([
        ['s1', '2026-09-01'],
        ['s2', '2026-09-08'],
        ['s3', '2026-09-15'],
      ]),
      byId,
    );
    expect([...events.keys()]).toEqual(['2026-09-08']);
    expect(events.get('2026-09-08')).toMatchObject([
      { exerciseId: 'bb_bench_press', kind: 'kg', value: 62.5, previous: 60 },
    ]);
  });

  it('records bodyweight work in reps, since it carries no kg', () => {
    const events = prEvents(
      [log('s1', 'bw_pull_up', { reps: 8 }), log('s2', 'bw_pull_up', { reps: 10 })],
      dates([
        ['s1', '2026-09-01'],
        ['s2', '2026-09-08'],
      ]),
      byId,
    );
    expect(events.get('2026-09-08')).toMatchObject([{ kind: 'reps', value: 10, previous: 8 }]);
  });

  it('compares against the best before the session, not within it', () => {
    /* Two escalating sets in one session are one record, not two. */
    const events = prEvents(
      [
        log('s1', 'bb_bench_press', { effectiveKg: 60 }),
        log('s2', 'bb_bench_press', { setNo: 1, effectiveKg: 62.5 }),
        log('s2', 'bb_bench_press', { setNo: 2, effectiveKg: 65 }),
      ],
      dates([
        ['s1', '2026-09-01'],
        ['s2', '2026-09-08'],
      ]),
      byId,
    );
    expect(events.get('2026-09-08')).toHaveLength(1);
    expect(events.get('2026-09-08')?.[0]).toMatchObject({ value: 65, previous: 60 });
  });

  it('phrases the clause in the exercise\'s own unit', () => {
    expect(
      describePr({ exerciseId: 'bb_bench_press', kind: 'kg', value: 62.5, previous: 60 }, byId),
    ).toBe('62.5 kg bench press, heaviest yet');
    expect(
      describePr({ exerciseId: 'bw_pull_up', kind: 'reps', value: 12, previous: 10 }, byId),
    ).toBe('12 pull-up, most yet');
  });
});
