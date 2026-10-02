import type { Exercise, MuscleId, SetLog } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { shiftIso, weekStart } from './format';
import { estimate1RM } from './stats';
import { setsPerMuscle, type MuscleVolume } from './volume';

/* -------------------------------------------------------------------------- */
/*  Progress over weeks — the History screen's question.                      */
/*                                                                            */
/*  For hypertrophy the dose is hard sets per muscle per week, and the         */
/*  response is the lifts getting heavier (or the reps climbing) at that dose. */
/*  So History answers both: weekly sets — in total and per muscle — and,      */
/*  per exercise, whether the best set is moving. Kg x reps tonnage is shown   */
/*  but never judged: a heavier triple and a lighter twelve can carry the same */
/*  tonnage and train very different things.                                   */
/*                                                                            */
/*  Trends compare the last four COMPLETED weeks with the four before them.    */
/*  The current week is charted but left out of the verdict: on a Tuesday it   */
/*  is one session of three, and judging it would call every muscle falling.   */
/* -------------------------------------------------------------------------- */

/** Weeks either side of the comparison: the last four against the four before. */
export const TREND_WEEKS = 4;

export type Trend = 'up' | 'down' | 'flat' | 'new' | 'idle';

export interface WeekVolume {
  /** Monday of the week. */
  week: string;
  /** Working sets logged, mobility left out exactly as the body map leaves it. */
  sets: number;
  /** Effective kg x reps, summed. Shown, never judged. */
  tonnageKg: number;
  muscles: MuscleVolume;
}

/** The Mondays of the last `count` weeks, oldest first, ending with this week. */
export function weekStarts(todayIso: string, count: number): string[] {
  const current = weekStart(todayIso);
  return Array.from({ length: count }, (_, i) => shiftIso(current, -7 * (count - 1 - i)));
}

/** One row per week, empty weeks included — a gap is part of the record. */
export function weeklyVolume(
  logs: SetLog[],
  dateBySession: Map<string, string>,
  exercisesById: Map<string, Exercise>,
  weeks: string[],
): WeekVolume[] {
  const byWeek = new Map<string, SetLog[]>(weeks.map((week) => [week, []]));
  for (const log of logs) {
    const date = dateBySession.get(log.sessionId);
    if (!date) continue;
    byWeek.get(weekStart(date))?.push(log);
  }
  return weeks.map((week) => {
    const list = (byWeek.get(week) ?? []).filter((log) => {
      const exercise = exercisesById.get(log.exerciseId);
      return exercise !== undefined && !exercise.isMobility;
    });
    return {
      week,
      sets: list.length,
      tonnageKg: Math.round(list.reduce((sum, l) => sum + (l.effectiveKg ?? 0) * l.reps, 0)),
      muscles: setsPerMuscle(list, exercisesById),
    };
  });
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function half(value: number): number {
  return Math.round(value * 2) / 2;
}

export interface SeriesTrend {
  trend: Trend;
  /** Weekly average over the last four completed weeks. */
  recent: number;
  /** Weekly average over the four before. */
  prior: number;
}

/**
 * The verdict on a weekly series whose last entry is the week in progress.
 *
 * Flat inside a set a week or a tenth of the old level, whichever is bigger:
 * with two or three sessions a week a muscle swings by a set from nothing
 * more than which day got skipped, and calling that a trend is noise.
 */
export function seriesTrend(series: number[]): SeriesTrend {
  const completed = series.slice(0, -1);
  const recentWeeks = completed.slice(-TREND_WEEKS);
  const priorWeeks = completed.slice(-2 * TREND_WEEKS, -TREND_WEEKS);
  const recent = half(mean(recentWeeks));
  const prior = half(mean(priorWeeks));
  const priorSum = priorWeeks.reduce((a, b) => a + b, 0);
  const recentSum = recentWeeks.reduce((a, b) => a + b, 0);

  let trend: Trend;
  if (recentSum === 0) trend = priorSum === 0 ? 'flat' : 'idle';
  else if (priorSum === 0) trend = 'new';
  else {
    const delta = mean(recentWeeks) - mean(priorWeeks);
    const band = Math.max(1, mean(priorWeeks) * 0.1);
    trend = delta >= band ? 'up' : delta <= -band ? 'down' : 'flat';
  }
  return { trend, recent, prior };
}

export interface MuscleTrendRow extends SeriesTrend {
  muscleId: MuscleId;
  name: string;
  /** Weighted sets each week, oldest first, the current week last. */
  series: number[];
}

/** Every muscle's weekly series and its verdict. Untrained muscles included. */
export function muscleTrends(weeks: WeekVolume[]): MuscleTrendRow[] {
  return MUSCLES.map((muscle) => {
    const series = weeks.map((week) => week.muscles[muscle.id] ?? 0);
    return { muscleId: muscle.id, name: muscle.name, series, ...seriesTrend(series) };
  });
}

export interface ExerciseTrendRow {
  exerciseId: string;
  /** What the best set is measured in: estimated 1-RM, the band, or reps. */
  unit: 'kg' | 'reps';
  /** 1-RM for loaded work, band rating for bands, top set's reps otherwise. */
  metricLabel: 'e1RM' | 'band' | 'reps';
  lastDate: string;
  sessions: number;
  /** Best in the last four weeks, and in the four before. */
  recentBest?: number;
  priorBest?: number;
  trend: Trend;
}

/**
 * Per exercise, whether its best set is moving.
 *
 * Best rather than average: the best set is the one taken near failure, and a
 * back-off set at 80% would drag an average down on the day the lift went up.
 * Days, not completed weeks, because a best is a maximum — a part-week can
 * only add to it, never make it look like a fall.
 *
 * Loaded work compares estimated 1-RM so that 60 x 10 and 65 x 8 are the same
 * question. A 2% move is the smallest that counts: one rep at ten is 3%.
 */
export function exerciseTrends(
  logs: SetLog[],
  dateBySession: Map<string, string>,
  exercisesById: Map<string, Exercise>,
  todayIso: string,
): ExerciseTrendRow[] {
  const recentFrom = shiftIso(todayIso, -7 * TREND_WEEKS + 1);
  const priorFrom = shiftIso(recentFrom, -7 * TREND_WEEKS);

  const byExercise = new Map<string, { log: SetLog; date: string }[]>();
  for (const log of logs) {
    const date = dateBySession.get(log.sessionId);
    if (!date || date < priorFrom || date > todayIso) continue;
    const list = byExercise.get(log.exerciseId) ?? [];
    list.push({ log, date });
    byExercise.set(log.exerciseId, list);
  }

  const rows: ExerciseTrendRow[] = [];
  for (const [exerciseId, entries] of byExercise) {
    const exercise = exercisesById.get(exerciseId);
    if (!exercise || exercise.isMobility || exercise.loadMode === 'rpe_only') continue;

    /* Loaded work logged without a weight — an early session, a typo'd row —
       has no kg to compare. Its reps still say something. */
    const loaded =
      exercise.loadMode !== 'bodyweight' && entries.some(({ log }) => (log.effectiveKg ?? 0) > 0);
    const metricLabel: ExerciseTrendRow['metricLabel'] = !loaded
      ? 'reps'
      : exercise.loadMode === 'band'
        ? 'band'
        : 'e1RM';
    const value = (log: SetLog): number =>
      metricLabel === 'reps'
        ? log.reps
        : metricLabel === 'band'
          ? (log.effectiveKg ?? 0)
          : estimate1RM(log.effectiveKg ?? 0, log.reps);

    let recentBest: number | undefined;
    let priorBest: number | undefined;
    for (const { log, date } of entries) {
      const v = value(log);
      if (date >= recentFrom) recentBest = Math.max(recentBest ?? 0, v);
      else priorBest = Math.max(priorBest ?? 0, v);
    }

    let trend: Trend;
    if (recentBest === undefined) trend = 'idle';
    else if (priorBest === undefined || priorBest === 0) trend = 'new';
    else {
      const delta = recentBest - priorBest;
      const band = metricLabel === 'e1RM' ? priorBest * 0.02 : 0.5;
      trend = delta >= band ? 'up' : delta <= -band ? 'down' : 'flat';
    }

    const dates = entries.map((entry) => entry.date).sort();
    rows.push({
      exerciseId,
      unit: metricLabel === 'reps' ? 'reps' : 'kg',
      metricLabel,
      lastDate: dates.at(-1) as string,
      sessions: new Set(entries.map((entry) => entry.log.sessionId)).size,
      recentBest: recentBest === undefined ? undefined : Math.round(recentBest * 10) / 10,
      priorBest: priorBest === undefined ? undefined : Math.round(priorBest * 10) / 10,
      trend,
    });
  }

  /* Most recently trained first: the lift done on Monday is the one being
     looked for, where "most logged" kept putting calf raises on top forever. */
  return rows.sort(
    (a, b) => b.lastDate.localeCompare(a.lastDate) || a.exerciseId.localeCompare(b.exerciseId),
  );
}
