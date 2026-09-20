import { describe, expect, it, vi } from 'vitest';
import { EXERCISES } from '../db/seed/exercises';
import type { AskResult } from './askModel';
import {
  WEEK_MIN_EXERCISES,
  generateAiWeek,
  type AiWeekWorkout,
  type WeekSlotRequest,
} from './aiWeek';

/*
 * The week loop against a fake transport. The one behavior pinned here is the
 * fix for the three-exercise week: a reply the validator calls underfilled is
 * re-asked about, and the next reply that passes is what lands.
 */

const SLOT: WeekSlotRequest = { slot: 1, focus: 'pull', intensity: 'heavy', constraints: [] };

/** A pull-day reply with as many exercises as asked. */
function reply(count: number): string {
  const pool = ['cb_seated_row', 'cb_lat_pulldown', 'bw_pull_up', 'cb_face_pull', 'bb_bent_over_row'];
  return JSON.stringify({
    workouts: [
      {
        slot: 1,
        name: 'Upper Pull',
        focus: 'pull',
        intensity: 'heavy',
        exercises: pool.slice(0, count).map((exerciseId) => ({
          exerciseId,
          sets: 3,
          repLow: 8,
          repHigh: 10,
        })),
      },
    ],
  });
}

const answer = (text: string): AskResult => ({ text, transport: 'direct' as never, ms: 1 });

describe('the week loop and the underfilled rule', () => {
  it('re-asks about a slot the validator calls underfilled, and keeps the fixed one', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(answer(reply(3)))
      .mockResolvedValueOnce(answer(reply(4)));

    const validate = (workout: AiWeekWorkout) =>
      workout.exercises.length < WEEK_MIN_EXERCISES
        ? [
            {
              code: 'underfilled_session' as const,
              message: `Only ${workout.exercises.length} exercises — a session needs at least ${WEEK_MIN_EXERCISES}.`,
            },
          ]
        : [];

    const outcome = await generateAiWeek({
      slots: [SLOT],
      user: '{}',
      exercises: EXERCISES,
      validate,
      ask: ask as never,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.attempts).toBe(2);
    expect(outcome.shortfall).toEqual([]);
    expect(outcome.workouts[0]?.exercises).toHaveLength(4);

    // The retry names the defect, so the model knows what to fix.
    const retry = ask.mock.calls[1]?.[0] as { priorTurns: { content: string }[] };
    expect(retry.priorTurns.at(-1)?.content).toMatch(/Only 3 exercises/);
  });

  it('keeps an accepted week as-is when the first reply already passes', async () => {
    const ask = vi.fn().mockResolvedValue(answer(reply(5)));
    const outcome = await generateAiWeek({
      slots: [SLOT],
      user: '{}',
      exercises: EXERCISES,
      validate: () => [],
      ask: ask as never,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.attempts).toBe(1);
    expect(outcome.workouts[0]?.exercises).toHaveLength(5);
  });
});
