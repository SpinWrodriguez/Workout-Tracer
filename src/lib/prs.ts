import type { Exercise, SetLog } from '../db/types';
import { kg } from './format';

/* -------------------------------------------------------------------------- */
/*  Personal records, detected rather than announced by a model.              */
/*                                                                            */
/*  A PR is a session whose best set beats every session BEFORE it — strictly, */
/*  and only when a before exists: the first time an exercise is ever logged,  */
/*  everything is a best, and calling that a record would teach the lifter to  */
/*  ignore the word. Weighted work records effective kg; bodyweight work       */
/*  records reps. The mobility drills record nothing.                          */
/* -------------------------------------------------------------------------- */

export interface PrEvent {
  exerciseId: string;
  kind: 'kg' | 'reps';
  value: number;
  previous: number;
}

/** The metric a record is kept in for this exercise, or none. */
function kindOf(exercise: Exercise): 'kg' | 'reps' | undefined {
  if (exercise.loadMode === 'weight' || exercise.loadMode === 'band') return 'kg';
  if (exercise.loadMode === 'bodyweight') return 'reps';
  return undefined;
}

/**
 * Every PR day, from the whole log. Sessions are replayed in date order and
 * each exercise's running best is carried forward, so the answer is the same
 * whenever it is computed — a record is a fact about the past, not about when
 * the screen looked.
 */
export function prEvents(
  logs: SetLog[],
  dateBySession: Map<string, string>,
  exercisesById: Map<string, Exercise>,
): Map<string, PrEvent[]> {
  /* Group by session, then order sessions by date: two sessions on one date
     replay in a stable order and both still compare against what came before. */
  const bySession = new Map<string, SetLog[]>();
  for (const log of logs) {
    const list = bySession.get(log.sessionId) ?? [];
    list.push(log);
    bySession.set(log.sessionId, list);
  }
  const ordered = [...bySession.entries()].sort(
    (a, b) =>
      (dateBySession.get(a[0]) ?? '').localeCompare(dateBySession.get(b[0]) ?? '') ||
      a[0].localeCompare(b[0]),
  );

  const best = new Map<string, number>();
  const out = new Map<string, PrEvent[]>();

  for (const [sessionId, sessionLogs] of ordered) {
    const date = dateBySession.get(sessionId);
    if (!date) continue;

    const sessionMax = new Map<string, number>();
    for (const log of sessionLogs) {
      const exercise = exercisesById.get(log.exerciseId);
      if (!exercise) continue;
      const kind = kindOf(exercise);
      if (kind === undefined) continue;
      const value = kind === 'kg' ? log.effectiveKg : log.reps;
      if (value === undefined || !(value > 0)) continue;
      sessionMax.set(log.exerciseId, Math.max(sessionMax.get(log.exerciseId) ?? 0, value));
    }

    for (const [exerciseId, value] of sessionMax) {
      const previous = best.get(exerciseId);
      if (previous !== undefined && value > previous) {
        const exercise = exercisesById.get(exerciseId) as Exercise;
        const events = out.get(date) ?? [];
        events.push({ exerciseId, kind: kindOf(exercise) as 'kg' | 'reps', value, previous });
        out.set(date, events);
      }
      best.set(exerciseId, Math.max(previous ?? 0, value));
    }
  }
  return out;
}

/** One short clause, for the day's one line: "45 kg bench press, heaviest yet". */
export function describePr(event: PrEvent, exercisesById: Map<string, Exercise>): string {
  const name = exercisesById.get(event.exerciseId)?.name.toLowerCase() ?? event.exerciseId;
  return event.kind === 'kg'
    ? `${kg(event.value)} kg ${name}, heaviest yet`
    : `${event.value} ${name}, most yet`;
}
