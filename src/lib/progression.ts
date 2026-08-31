import { atCeiling, microplateHint, nextRung, snapToLadder } from './loadable';

/* -------------------------------------------------------------------------- */
/*  Progression suggestion — spec Phase 2.                                    */
/*                                                                            */
/*    hit top of rep range at RIR ≥ 2  → next rung up                         */
/*    hit rep range at RIR 0–1         → repeat the same weight               */
/*    missed the rep range twice       → hold, flag for review                */
/*                                                                            */
/*  The suggestion always lands on a real rung, so it can never prescribe a    */
/*  weight the rack cannot make.                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fallback rep range when the block carries no target for an exercise. Phase 3
 * writes real BlockExercise targets; until then 8–10 is the working default,
 * which is what makes a completed 3×10 read as top of range.
 */
export const DEFAULT_REP_RANGE = { low: 8, high: 10 } as const;

/** Enough of a SetLog to judge a top set, in the order they were performed. */
export interface HistorySet {
  sessionId: string;
  date: string;
  weightKg?: number;
  reps: number;
  rir?: number;
  rpe?: number;
}

export type ProgressionOutcome =
  | 'start' // nothing logged yet
  | 'increase'
  | 'repeat'
  | 'hold_review' // missed the range twice
  | 'ceiling'; // nothing heavier is loadable

export interface Progression {
  outcome: ProgressionOutcome;
  /** The weight to put on the bar next, snapped to a rung. */
  suggestedKg?: number;
  /** The top set this was derived from. */
  lastKg?: number;
  lastReps?: number;
  lastRir?: number;
  reason: string;
  /** Set when the step up is large enough to want microplates. */
  microplateNote?: string;
}

/** Heaviest set; ties broken by reps. Bodyweight sets fall back to reps. */
export function topSet(sets: HistorySet[]): HistorySet | undefined {
  return sets.reduce<HistorySet | undefined>((best, set) => {
    if (!best) return set;
    const a = set.weightKg ?? 0;
    const b = best.weightKg ?? 0;
    if (a > b) return set;
    if (a === b && set.reps > best.reps) return set;
    return best;
  }, undefined);
}

/** Groups history into sessions, most recent first. */
export function sessionsFromHistory(sets: HistorySet[]): HistorySet[][] {
  const bySession = new Map<string, HistorySet[]>();
  for (const set of sets) {
    const list = bySession.get(set.sessionId) ?? [];
    list.push(set);
    bySession.set(set.sessionId, list);
  }
  return [...bySession.values()]
    .sort((a, b) => (b[0]?.date ?? '').localeCompare(a[0]?.date ?? ''))
    .map((list) => list);
}

export interface ProgressionInput {
  ladder: number[];
  history: HistorySet[];
  repRangeLow?: number;
  repRangeHigh?: number;
}

export function suggestProgression({
  ladder,
  history,
  repRangeLow = DEFAULT_REP_RANGE.low,
  repRangeHigh = DEFAULT_REP_RANGE.high,
}: ProgressionInput): Progression {
  const sessions = sessionsFromHistory(history);
  const latest = sessions[0] ? topSet(sessions[0]) : undefined;

  if (!latest) {
    return {
      outcome: 'start',
      suggestedKg: ladder[0],
      reason: 'No history yet — pick a weight you can hold for the whole range.',
    };
  }

  const base = { lastKg: latest.weightKg, lastReps: latest.reps, lastRir: latest.rir };
  const loaded = latest.weightKg;

  // Unloaded work (pull-ups, planks, bands) has no rung to move to; the rep
  // range is the progression.
  if (loaded === undefined || ladder.length === 0) {
    const hitTop = latest.reps >= repRangeHigh;
    return {
      ...base,
      outcome: hitTop ? 'increase' : 'repeat',
      reason: hitTop
        ? `Hit ${latest.reps} reps — add a rep or slow the tempo, there is no load to add.`
        : `Work up to ${repRangeHigh} reps at this difficulty.`,
    };
  }

  const missedRange = latest.reps < repRangeLow;

  if (missedRange) {
    const previous = sessions[1] ? topSet(sessions[1]) : undefined;
    const missedTwice =
      previous !== undefined &&
      previous.reps < repRangeLow &&
      Math.abs((previous.weightKg ?? 0) - loaded) < 1e-9;

    if (missedTwice) {
      const back = snapToLadder(loaded, ladder);
      return {
        ...base,
        outcome: 'hold_review',
        suggestedKg: back,
        reason: `Missed ${repRangeLow} reps twice at ${loaded} kg — hold here and review the exercise.`,
      };
    }
    return {
      ...base,
      outcome: 'repeat',
      suggestedKg: snapToLadder(loaded, ladder),
      reason: `Short of ${repRangeLow} reps — repeat ${loaded} kg.`,
    };
  }

  const hitTop = latest.reps >= repRangeHigh;
  const rir = latest.rir ?? (latest.rpe !== undefined ? 10 - latest.rpe : undefined);
  const fresh = rir === undefined || rir >= 2;

  if (hitTop && fresh) {
    if (atCeiling(loaded, ladder)) {
      return {
        ...base,
        outcome: 'ceiling',
        suggestedKg: snapToLadder(loaded, ladder),
        reason: `${loaded} kg is the heaviest loadable weight — add reps or change the exercise.`,
      };
    }
    const up = nextRung(loaded, ladder);
    return {
      ...base,
      outcome: 'increase',
      suggestedKg: up,
      reason:
        rir === undefined
          ? `Hit ${repRangeHigh} reps — go to ${up} kg. No RIR logged, so this assumes it was not a grinder.`
          : `Hit ${repRangeHigh} reps at RIR ${rir} — go to ${up} kg.`,
      microplateNote: microplateHint(loaded, ladder),
    };
  }

  return {
    ...base,
    outcome: 'repeat',
    suggestedKg: snapToLadder(loaded, ladder),
    reason: hitTop
      ? `Hit ${repRangeHigh} reps but at RIR ${rir} — repeat ${loaded} kg until it is not a grinder.`
      : `In range at ${latest.reps} reps — repeat ${loaded} kg and work toward ${repRangeHigh}.`,
  };
}

export const OUTCOME_LABEL: Record<ProgressionOutcome, string> = {
  start: 'first time',
  increase: 'go up',
  repeat: 'repeat',
  hold_review: 'review',
  ceiling: 'ceiling',
};
