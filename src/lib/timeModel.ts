import { db } from '../db/db';
import type { BlockExercise, Exercise, Session } from '../db/types';
import { sessionMinutes } from './blockValidation';

/* -------------------------------------------------------------------------- */
/*  How long a session really takes, measured rather than assumed.           */
/*                                                                           */
/*  The estimate is 40 seconds a set plus that exercise's own rest, on top of */
/*  five minutes of warm-up. It is a model, and three real sessions were      */
/*  enough to show it is wrong in both directions: two lifting days came in   */
/*  at 70% and 91% of their estimate, a rotation circuit at 162%. So a        */
/*  40-minute budget was buying 28 real minutes on a heavy day.              */
/*                                                                           */
/*  What is learned is one number: the ratio of real minutes to estimated     */
/*  ones. A median, because a circuit that ran twenty minutes long should not */
/*  drag the number that sizes every other day; clamped, because a session    */
/*  logged the next morning with a made-up duration should not either; and    */
/*  only once there are a few sessions to take a median of.                   */
/*                                                                           */
/*  Nothing is stored. It is recomputed from the sessions themselves, like    */
/*  every other number in this app — so it improves on its own as the log     */
/*  grows and cannot go stale.                                               */
/* -------------------------------------------------------------------------- */

/** Fewer than this and there is no median worth taking. */
export const MIN_SESSIONS = 3;
/** The most recent sessions to learn from: how you train now, not in July. */
export const HISTORY_DEPTH = 10;
/**
 * Bounds on the ratio. Outside these the duration is more likely mistyped —
 * or the session was left running while you did something else — than real.
 */
export const FACTOR_LOW = 0.6;
export const FACTOR_HIGH = 1.8;

export interface TimedSession {
  /** What the model said this session would take. */
  estimateMinutes: number;
  /** What it actually took. */
  actualMinutes: number;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Real minutes per estimated minute, or undefined when there is not enough
 * history to say. 1 means the model is right; below 1 means you train faster
 * than it assumes.
 */
export function timeFactor(sessions: TimedSession[]): number | undefined {
  const ratios = sessions
    .filter((row) => row.estimateMinutes > 0 && row.actualMinutes > 0)
    .map((row) => row.actualMinutes / row.estimateMinutes)
    .filter((ratio) => ratio >= FACTOR_LOW && ratio <= FACTOR_HIGH);
  if (ratios.length < MIN_SESSIONS) return undefined;
  const learned = median(ratios.slice(-HISTORY_DEPTH));
  return learned === undefined ? undefined : Math.round(learned * 100) / 100;
}

/**
 * The estimate-minutes to build a day to, so it lands on the real budget the
 * lifter asked for. Scales the budget rather than every estimate: one number
 * in one place, instead of a factor threaded through the generator, the
 * validator and every screen that mentions time.
 */
export function budgetMinutes(realMinutes: number, factor: number | undefined): number {
  if (factor === undefined || factor <= 0) return realMinutes;
  return Math.round(realMinutes / factor);
}

/** One past session as the model would have estimated it, from what was logged. */
export function estimateOf(
  session: Session,
  sets: { exerciseId: string }[],
  exercisesById: Map<string, Exercise>,
): TimedSession | undefined {
  if (!session.durationMin) return undefined;
  const counts = new Map<string, number>();
  for (const set of sets) counts.set(set.exerciseId, (counts.get(set.exerciseId) ?? 0) + 1);
  if (counts.size === 0) return undefined;

  const entries: BlockExercise[] = [...counts].map(([exerciseId, targetSets]) => ({
    blockId: session.blockId,
    exerciseId,
    daySlot: session.daySlot as BlockExercise['daySlot'],
    targetSets,
    repRangeLow: 1,
    repRangeHigh: 1,
    order: 0,
  }));
  return {
    estimateMinutes: sessionMinutes(entries, exercisesById),
    actualMinutes: session.durationMin,
  };
}

/** The factor from what is logged, or undefined while there is too little. */
export async function readTimeFactor(
  exercisesById: Map<string, Exercise>,
): Promise<number | undefined> {
  const sessions = (await db.session.orderBy('date').reverse().limit(HISTORY_DEPTH).toArray())
    .filter((session) => session.durationMin)
    .reverse();
  if (sessions.length < MIN_SESSIONS) return undefined;

  const ids = new Set(sessions.map((session) => session.id));
  const logs = (await db.setLog.toArray()).filter((log) => ids.has(log.sessionId));
  const rows: TimedSession[] = [];
  for (const session of sessions) {
    const row = estimateOf(
      session,
      logs.filter((log) => log.sessionId === session.id),
      exercisesById,
    );
    if (row) rows.push(row);
  }
  return timeFactor(rows);
}
