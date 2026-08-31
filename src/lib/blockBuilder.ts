import type { BlockExercise, DaySlot, Exercise, MuscleId } from '../db/types';
import { WEEKDAY_LABEL, gripSafeWeekdays, type Weekday } from './golf';

/* -------------------------------------------------------------------------- */
/*  Deterministic block builder — spec Phase 3.                               */
/*                                                                            */
/*  "Block builder auto-places high-grip work early in the week." The golf     */
/*  calendar decides which weekdays can carry grip work at all, and the        */
/*  grip-heavy session is pinned to the earliest of them.                     */
/*                                                                            */
/*  This is rules, not AI. Phase 5 replaces the exercise *selection* with a    */
/*  model call; the placement constraints stay here either way, because they    */
/*  are what validate whatever the model returns.                             */
/* -------------------------------------------------------------------------- */

/** Movement patterns a session is built from, in the order they are performed. */
export type Pattern = 'hinge' | 'squat' | 'push' | 'pull' | 'carry' | 'core' | 'accessory';

/** Hinges first: they are the form risk and belong while the position holds. */
const PATTERN_ORDER: Pattern[] = ['hinge', 'squat', 'push', 'pull', 'accessory', 'carry', 'core'];

const PUSH_MUSCLES: MuscleId[] = ['chest', 'front_delts', 'triceps', 'side_delts'];
const PULL_MUSCLES: MuscleId[] = ['lats', 'upper_back', 'rear_delts', 'biceps', 'traps'];
const SQUAT_MUSCLES: MuscleId[] = ['quads', 'glutes', 'adductors', 'calves'];
const CORE_MUSCLES: MuscleId[] = ['abs', 'obliques', 'lower_back'];

function has(list: MuscleId[], muscles: MuscleId[]): boolean {
  return muscles.some((m) => list.includes(m));
}

/** Classifies a seeded exercise into a pattern. Hinge and carry are explicit. */
export function patternOf(exercise: Exercise): Pattern {
  if (exercise.isHinge) return 'hinge';
  if (exercise.name.toLowerCase().includes('carry')) return 'carry';
  if (has(exercise.primaryMuscles, CORE_MUSCLES)) return 'core';
  if (has(exercise.primaryMuscles, SQUAT_MUSCLES)) return 'squat';
  if (has(exercise.primaryMuscles, PULL_MUSCLES)) return 'pull';
  if (has(exercise.primaryMuscles, PUSH_MUSCLES)) return 'push';
  return 'accessory';
}

/** Compound work gets the lower range, isolation and core the higher one. */
function repRange(exercise: Exercise, pattern: Pattern): { low: number; high: number } {
  if (exercise.loadMode === 'rpe_only') return { low: 12, high: 20 };
  if (pattern === 'core' || pattern === 'carry') return { low: 10, high: 15 };
  if (exercise.primaryMuscles.length === 1 && exercise.secondaryMuscles.length <= 1) {
    return { low: 10, high: 15 };
  }
  return { low: 8, high: 10 };
}

function targetSets(pattern: Pattern): number {
  return pattern === 'core' || pattern === 'carry' || pattern === 'accessory' ? 2 : 3;
}

/** Roughly how long a set plus its rest costs, for the 40-minute budget. */
const MINUTES_PER_SET = 2.2;
const WARMUP_MINUTES = 6;

export interface DayPlanTemplate {
  slot: DaySlot;
  patterns: Pattern[];
}

/**
 * Two sessions is the realistic week (spec §1), so each one has to be a full
 * body pass. A third session becomes the weak-point day.
 */
const TEMPLATES: Record<number, DayPlanTemplate[]> = {
  1: [{ slot: 'A', patterns: ['hinge', 'squat', 'push', 'pull', 'core'] }],
  2: [
    { slot: 'A', patterns: ['hinge', 'pull', 'push', 'core'] },
    { slot: 'B', patterns: ['squat', 'push', 'pull', 'accessory', 'core'] },
  ],
  3: [
    { slot: 'A', patterns: ['hinge', 'pull', 'push', 'core'] },
    { slot: 'B', patterns: ['squat', 'push', 'accessory', 'core'] },
    { slot: 'C', patterns: ['pull', 'push', 'accessory', 'carry'] },
  ],
};

export interface DayPlan {
  slot: DaySlot;
  weekday: Weekday;
  weekdayLabel: string;
  gripSafe: boolean;
  exercises: BlockExercise[];
  estimatedMinutes: number;
}

export interface GeneratedBlock {
  rationale: string;
  days: DayPlan[];
  warnings: string[];
}

export interface GenerateInput {
  blockId: string;
  exercises: Exercise[];
  focusMuscles: MuscleId[];
  sessionsPerWeek: number;
  golfWeekdays: Weekday[];
  minutesPerSession?: number;
}

/** Every k-subset of `pool`, in lexicographic order. */
function combinations<T>(pool: T[], k: number): T[][] {
  if (k <= 0) return [[]];
  if (k > pool.length) return [];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      acc.push(pool[i] as T);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/** Smallest gap between any two chosen days, measured around the week. */
function minCircularGap(days: Weekday[]): number {
  if (days.length <= 1) return 7;
  const sorted = [...days].sort((a, b) => a - b);
  let min = 7;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i] as Weekday;
    const next = sorted[(i + 1) % sorted.length] as Weekday;
    const gap = i === sorted.length - 1 ? next + 7 - current : next - current;
    min = Math.min(min, gap);
  }
  return min;
}

/**
 * Picks training weekdays: golf days are out, sessions are spread as evenly
 * around the week as possible, and the earliest grip-safe day is preferred as
 * the anchor so the grip-heavy session lands as early as the calendar allows.
 *
 * Searched rather than stepped greedily — a greedy walk picks Mon/Tue/Thu where
 * Mon/Wed/Fri is plainly the better week.
 */
export function chooseTrainingWeekdays(
  sessionsPerWeek: number,
  golfWeekdays: Weekday[],
): Weekday[] {
  const pool = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((day) => !golfWeekdays.includes(day));
  const wanted = Math.max(1, Math.min(sessionsPerWeek, pool.length));
  if (pool.length === 0) return [];

  const safe = gripSafeWeekdays(golfWeekdays);
  const anchor = safe[0];

  let best: Weekday[] | undefined;
  let bestScore = [-1, -1];
  for (const combo of combinations(pool, wanted)) {
    const score = [
      minCircularGap(combo),
      anchor !== undefined && combo.includes(anchor) ? 1 : 0,
    ];
    // Spread first, then the grip-safe anchor; ties go to the earliest week
    // because `combinations` is already lexicographic.
    if (score[0]! > bestScore[0]! || (score[0] === bestScore[0] && score[1]! > bestScore[1]!)) {
      best = combo;
      bestScore = score;
    }
  }

  return (best ?? pool.slice(0, wanted)).sort((a, b) => a - b);
}

function scoreExercise(exercise: Exercise, focusMuscles: MuscleId[]): number {
  let score = 0;
  for (const m of exercise.primaryMuscles) if (focusMuscles.includes(m)) score += 3;
  for (const m of exercise.secondaryMuscles) if (focusMuscles.includes(m)) score += 1;

  // Prefer compounds over isolation. Without this the tie-break is alphabetical,
  // which quietly picks a barbell curl over a bent-over row for the pull slot.
  score += exercise.primaryMuscles.length * 1.5;
  score += Math.min(2, exercise.secondaryMuscles.length * 0.4);

  // Prefer loadable work: it is what progression can actually act on.
  if (exercise.loadMode === 'weight') score += 1;
  return score;
}

export function generateBlock({
  blockId,
  exercises,
  focusMuscles,
  sessionsPerWeek,
  golfWeekdays,
  minutesPerSession = 40,
}: GenerateInput): GeneratedBlock {
  const warnings: string[] = [];
  const templates = TEMPLATES[Math.min(3, Math.max(1, sessionsPerWeek))] ?? TEMPLATES[2];
  const weekdays = chooseTrainingWeekdays(sessionsPerWeek, golfWeekdays);
  const safeWeekdays = gripSafeWeekdays(golfWeekdays);

  if (safeWeekdays.length === 0) {
    warnings.push(
      `Every weekday is within ${3} days of a round — no high-grip work can be placed. Drop a round or accept the compromise.`,
    );
  }

  const byPattern = new Map<Pattern, Exercise[]>();
  for (const exercise of exercises) {
    const pattern = patternOf(exercise);
    const list = byPattern.get(pattern) ?? [];
    list.push(exercise);
    byPattern.set(pattern, list);
  }
  for (const [, list] of byPattern) {
    list.sort(
      (a, b) => scoreExercise(b, focusMuscles) - scoreExercise(a, focusMuscles) || a.name.localeCompare(b.name),
    );
  }

  const used = new Set<string>();
  const days: DayPlan[] = [];

  (templates ?? []).forEach((template, dayIndex) => {
    const weekday = (weekdays[dayIndex] ?? weekdays.at(-1) ?? 1) as Weekday;
    const gripSafe = safeWeekdays.includes(weekday);
    const picked: BlockExercise[] = [];
    let minutes = WARMUP_MINUTES;

    const patterns = [...template.patterns].sort(
      (a, b) => PATTERN_ORDER.indexOf(a) - PATTERN_ORDER.indexOf(b),
    );

    for (const pattern of patterns) {
      const candidates = (byPattern.get(pattern) ?? []).filter((exercise) => {
        if (used.has(exercise.id)) return false;
        // The whole point: high-grip work only on days clear of a round.
        if (exercise.gripLoad === 'high' && !gripSafe) return false;
        return true;
      });
      const choice = candidates[0];
      if (!choice) continue;

      const sets = targetSets(pattern);
      const cost = sets * MINUTES_PER_SET;
      if (minutes + cost > minutesPerSession && picked.length >= 3) continue;

      const range = repRange(choice, pattern);
      picked.push({
        blockId,
        exerciseId: choice.id,
        daySlot: template.slot,
        targetSets: sets,
        repRangeLow: range.low,
        repRangeHigh: range.high,
        order: picked.length,
      });
      used.add(choice.id);
      minutes += cost;
    }

    days.push({
      slot: template.slot,
      weekday,
      weekdayLabel: WEEKDAY_LABEL[weekday],
      gripSafe,
      exercises: picked,
      estimatedMinutes: Math.round(minutes),
    });
  });

  const gripDays = days.filter((day) =>
    day.exercises.some((entry) => exercises.find((e) => e.id === entry.exerciseId)?.gripLoad === 'high'),
  );

  const rationale =
    gripDays.length > 0
      ? `${days.length} session${days.length === 1 ? '' : 's'} on ${days
          .map((d) => d.weekdayLabel)
          .join(' and ')}. All high-grip work sits on ${gripDays
          .map((d) => d.weekdayLabel)
          .join(' and ')}, clear of ${
          golfWeekdays.length ? golfWeekdays.map((d) => WEEKDAY_LABEL[d]).join(' and ') : 'any round'
        } by at least ${3} days. Hinges lead each session while the position still holds.`
      : `${days.length} session${days.length === 1 ? '' : 's'} on ${days
          .map((d) => d.weekdayLabel)
          .join(' and ')}. No high-grip work placed — the golf calendar leaves no room for it.`;

  return { rationale, days, warnings };
}
