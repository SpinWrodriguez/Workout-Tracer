import { db } from '../db/db';
import type { Activity, Exercise, Session, SetLog } from '../db/types';
import { effectiveKg } from './load';

/* -------------------------------------------------------------------------- */
/*  Session persistence.                                                       */
/*                                                                            */
/*  The UI works on a draft; nothing touches Dexie until the session is saved. */
/*  `done` is UI-only — a persisted set is by definition a completed one.      */
/* -------------------------------------------------------------------------- */

export interface DraftSet {
  setNo: number;
  weightKg?: number;
  reps?: number;
  rpe?: number;
  rir?: number;
  done: boolean;
}

export interface DraftExercise {
  exerciseId: string;
  sets: DraftSet[];
}

export interface SessionDraft {
  id: string;
  blockId: string;
  daySlot: string;
  date: string;
  durationMin?: number;
  notes?: string;
  exercises: DraftExercise[];
}

export function newSessionId(date: string): string {
  return `s_${date}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySet(setNo: number): DraftSet {
  return { setNo, done: false };
}

/** A set is worth persisting once it has reps against it. */
export function isLoggable(set: DraftSet): boolean {
  return typeof set.reps === 'number' && set.reps > 0;
}

export function countLoggedSets(draft: SessionDraft): number {
  return draft.exercises.reduce((n, e) => n + e.sets.filter(isLoggable).length, 0);
}

/* --- estimated energy cost (spec §10 caveat) ------------------------------ */

/**
 * Deliberately conservative: 3.5 METs, the low end for resistance work.
 * HR-derived figures overestimate badly for lifting, so the shared `activity`
 * row carries a duration-based estimate and says so in its name.
 */
const RESISTANCE_MET = 3.5;
const FALLBACK_BODY_KG = 82;

export function estimateKcal(durationMin: number, bodyKg: number): number {
  return Math.round((RESISTANCE_MET * 3.5 * bodyKg) / 200 * durationMin);
}

async function latestBodyKg(): Promise<number> {
  const rows = await db.sharedBodyWeight.orderBy('date').reverse().limit(1).toArray();
  return rows[0]?.kg ?? FALLBACK_BODY_KG;
}

function activityName(daySlot: string): string {
  const slot = daySlot ? ` ${daySlot}` : '';
  return `Workout${slot} (est.)`;
}

/* --- read ----------------------------------------------------------------- */

export async function loadDraft(sessionId: string): Promise<SessionDraft | undefined> {
  const session = await db.session.get(sessionId);
  if (!session) return undefined;
  const sets = await db.setLog.where('sessionId').equals(sessionId).toArray();

  const byExercise = new Map<string, DraftSet[]>();
  for (const s of sets) {
    const list = byExercise.get(s.exerciseId) ?? [];
    list.push({
      setNo: s.setNo,
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      rir: s.rir,
      done: true,
    });
    byExercise.set(s.exerciseId, list);
  }

  return {
    id: session.id,
    blockId: session.blockId,
    daySlot: session.daySlot,
    date: session.date,
    durationMin: session.durationMin,
    notes: session.notes,
    exercises: [...byExercise.entries()].map(([exerciseId, list]) => ({
      exerciseId,
      sets: list.sort((a, b) => a.setNo - b.setNo),
    })),
  };
}

export interface SessionSummary {
  session: Session;
  setCount: number;
  exerciseIds: string[];
  volumeKg: number;
}

export async function listSessionSummaries(): Promise<SessionSummary[]> {
  const sessions = await db.session.orderBy('date').reverse().toArray();
  const sets = await db.setLog.toArray();

  const grouped = new Map<string, SetLog[]>();
  for (const s of sets) {
    const list = grouped.get(s.sessionId) ?? [];
    list.push(s);
    grouped.set(s.sessionId, list);
  }

  return sessions.map((session) => {
    const list = grouped.get(session.id) ?? [];
    return {
      session,
      setCount: list.length,
      exerciseIds: [...new Set(list.map((s) => s.exerciseId))],
      volumeKg: list.reduce((sum, s) => sum + (s.effectiveKg ?? 0) * s.reps, 0),
    };
  });
}

/* --- write ---------------------------------------------------------------- */

/**
 * Replaces the stored session and all of its set logs, then refreshes the
 * shared `activity` row the nutrition app reads.
 */
export async function saveSession(
  draft: SessionDraft,
  exercisesById: Map<string, Exercise>,
): Promise<void> {
  const logs: SetLog[] = [];
  for (const de of draft.exercises) {
    const exercise = exercisesById.get(de.exerciseId);
    if (!exercise) continue;
    // Renumber on save so deleting set 2 of 3 does not leave a hole.
    let setNo = 0;
    for (const set of de.sets) {
      if (!isLoggable(set)) continue;
      setNo += 1;
      logs.push({
        sessionId: draft.id,
        exerciseId: de.exerciseId,
        setNo,
        weightKg: set.weightKg,
        effectiveKg: effectiveKg(exercise, set.weightKg),
        reps: set.reps as number,
        rpe: set.rpe,
        rir: set.rir,
      });
    }
  }

  const session: Session = {
    id: draft.id,
    blockId: draft.blockId,
    daySlot: draft.daySlot,
    date: draft.date,
    durationMin: draft.durationMin,
    notes: draft.notes?.trim() ? draft.notes.trim() : undefined,
  };

  const previous = await db.session.get(draft.id);
  const bodyKg = await latestBodyKg();

  await db.transaction('rw', [db.session, db.setLog, db.sharedActivity], async () => {
    await db.setLog.where('sessionId').equals(draft.id).delete();
    await db.session.put(session);
    if (logs.length) await db.setLog.bulkPut(logs);

    // Move the activity row if the session's date or slot changed.
    if (previous && (previous.date !== session.date || previous.daySlot !== session.daySlot)) {
      await db.sharedActivity.delete([previous.date, activityName(previous.daySlot), 'workout']);
    }
    if (session.durationMin && session.durationMin > 0) {
      const activity: Activity = {
        date: session.date,
        name: activityName(session.daySlot),
        kcal: estimateKcal(session.durationMin, bodyKg),
        source: 'workout',
      };
      await db.sharedActivity.put(activity);
    } else {
      await db.sharedActivity.delete([session.date, activityName(session.daySlot), 'workout']);
    }
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const session = await db.session.get(sessionId);
  await db.transaction('rw', [db.session, db.setLog, db.sharedActivity], async () => {
    await db.setLog.where('sessionId').equals(sessionId).delete();
    await db.session.delete(sessionId);
    if (session) {
      await db.sharedActivity.delete([session.date, activityName(session.daySlot), 'workout']);
    }
  });
}
