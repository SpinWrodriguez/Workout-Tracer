import type { BlockExercise, DaySlot, Exercise, MuscleId, Station } from '../db/types';
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

/** Movement patterns a session is built from. */
export type Pattern = 'hinge' | 'squat' | 'push' | 'pull' | 'carry' | 'core' | 'accessory';

/** Hinges first: they are the form risk and belong while the position holds. */
const PATTERN_ORDER: Pattern[] = ['hinge', 'squat', 'push', 'pull', 'accessory', 'carry', 'core'];

const PUSH_MUSCLES: MuscleId[] = ['chest', 'front_delts', 'triceps', 'side_delts'];
const PULL_MUSCLES: MuscleId[] = ['lats', 'upper_back', 'rear_delts', 'biceps', 'traps', 'forearms'];
const LEG_MUSCLES: MuscleId[] = ['quads', 'glutes', 'adductors', 'calves', 'hamstrings'];
const CORE_MUSCLES: MuscleId[] = ['abs', 'obliques', 'lower_back'];

const PATTERN_MUSCLES: Record<Pattern, MuscleId[]> = {
  hinge: ['hamstrings', 'glutes', 'lower_back'],
  squat: ['quads', 'glutes', 'adductors', 'calves'],
  push: PUSH_MUSCLES,
  pull: PULL_MUSCLES,
  carry: ['forearms', 'traps', 'obliques'],
  core: CORE_MUSCLES,
  accessory: [],
};

function has(list: MuscleId[], muscles: MuscleId[]): boolean {
  return muscles.some((m) => list.includes(m));
}

/** Classifies a seeded exercise into a pattern. Hinge and carry are explicit. */
export function patternOf(exercise: Exercise): Pattern {
  if (exercise.isHinge) return 'hinge';
  if (exercise.name.toLowerCase().includes('carry')) return 'carry';
  if (has(exercise.primaryMuscles, CORE_MUSCLES)) return 'core';
  if (has(exercise.primaryMuscles, LEG_MUSCLES)) return 'squat';
  if (has(exercise.primaryMuscles, PULL_MUSCLES)) return 'pull';
  if (has(exercise.primaryMuscles, PUSH_MUSCLES)) return 'push';
  return 'accessory';
}

/* -------------------------------------------------------------------------- */
/*  Day types and splits.                                                     */
/*                                                                            */
/*  A day type is what a session is FOR. Previously the three-day template     */
/*  hard-coded a pull/push/accessory day with no legs in it at all, which is   */
/*  how a three-session week came out entirely upper body.                     */
/* -------------------------------------------------------------------------- */

export type DayType = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'core' | 'cable';

export const DAY_TYPES: DayType[] = [
  'full',
  'upper',
  'lower',
  'push',
  'pull',
  'legs',
  'core',
  'cable',
];

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  full: 'Full body',
  upper: 'Upper',
  lower: 'Lower',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
  cable: 'Cable',
};

/** The patterns a day type asks for, in the order they will be performed. */
const DAY_PATTERNS: Record<DayType, Pattern[]> = {
  full: ['hinge', 'squat', 'push', 'pull', 'core'],
  upper: ['push', 'pull', 'push', 'pull', 'accessory'],
  lower: ['hinge', 'squat', 'squat', 'core'],
  push: ['push', 'push', 'accessory', 'core'],
  pull: ['pull', 'pull', 'accessory', 'carry'],
  legs: ['hinge', 'squat', 'squat', 'core'],
  core: ['core', 'core', 'carry', 'accessory'],
  cable: ['pull', 'push', 'accessory', 'core'],
};

/** Some day types constrain the station rather than the movement. */
const DAY_STATIONS: Partial<Record<DayType, Station[]>> = {
  cable: ['cable'],
};

export type SplitId = 'full_body' | 'upper_lower' | 'push_pull_legs' | 'custom';

export const SPLIT_LABEL: Record<SplitId, string> = {
  full_body: 'Full body',
  upper_lower: 'Upper / Lower',
  push_pull_legs: 'Push / Pull / Legs',
  custom: 'Custom',
};

const SPLIT_CYCLE: Record<Exclude<SplitId, 'custom'>, DayType[]> = {
  full_body: ['full'],
  upper_lower: ['upper', 'lower'],
  push_pull_legs: ['push', 'pull', 'legs'],
};

/** Day types for a split, cycled out to the number of sessions. */
export function dayTypesFor(
  split: SplitId,
  sessionsPerWeek: number,
  custom?: DayType[],
): DayType[] {
  const count = Math.max(1, sessionsPerWeek);
  if (split === 'custom') {
    return Array.from({ length: count }, (_, i) => custom?.[i] ?? 'full');
  }
  const cycle = SPLIT_CYCLE[split];
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length] as DayType);
}

/** A split needs at least as many sessions as it has distinct days. */
export function splitFits(split: SplitId, sessionsPerWeek: number): boolean {
  if (split === 'custom') return true;
  return sessionsPerWeek >= SPLIT_CYCLE[split].length;
}

/* --- set and rep prescription --------------------------------------------- */

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

/** A session with fewer than this is not worth driving to the garage for. */
const MIN_EXERCISES = 4;

export interface DayPlan {
  slot: DaySlot;
  type: DayType;
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
  split?: SplitId;
  /** Per-day types, used when split is 'custom'. */
  customDayTypes?: DayType[];
  minutesPerSession?: number;
}

/* --- weekday choice -------------------------------------------------------- */

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

/* --- exercise selection ---------------------------------------------------- */

function scoreExercise(exercise: Exercise, focusMuscles: MuscleId[], pattern: Pattern): number {
  let score = 0;
  for (const m of exercise.primaryMuscles) if (focusMuscles.includes(m)) score += 3;
  for (const m of exercise.secondaryMuscles) if (focusMuscles.includes(m)) score += 1;

  // Prefer compounds over isolation. Without this the tie-break is alphabetical,
  // which quietly picks a barbell curl over a bent-over row for the pull slot.
  score += exercise.primaryMuscles.length * 1.5;
  score += Math.min(2, exercise.secondaryMuscles.length * 0.4);

  // Prefer an exercise that IS the pattern over one that merely touches it, so
  // the squat slot takes a back squat rather than a landmine squat-to-press.
  const wanted = PATTERN_MUSCLES[pattern];
  if (wanted.length > 0) {
    const pure = exercise.primaryMuscles.every((m) => wanted.includes(m));
    if (pure) score += 3;
  }

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
  split = 'full_body',
  customDayTypes,
  minutesPerSession = 40,
}: GenerateInput): GeneratedBlock {
  const warnings: string[] = [];
  const dayTypes = dayTypesFor(split, sessionsPerWeek, customDayTypes);
  const weekdays = chooseTrainingWeekdays(sessionsPerWeek, golfWeekdays);
  const safeWeekdays = gripSafeWeekdays(golfWeekdays);
  const slots: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];

  if (safeWeekdays.length === 0) {
    warnings.push(
      'Every weekday is within 3 days of a round — no high-grip work can be placed. Drop a round or accept the compromise.',
    );
  }
  if (!splitFits(split, sessionsPerWeek)) {
    warnings.push(
      `${SPLIT_LABEL[split]} wants ${SPLIT_CYCLE[split as Exclude<SplitId, 'custom'>].length} sessions a week; with ${sessionsPerWeek} some of it will not be trained.`,
    );
  }

  const byPattern = new Map<Pattern, Exercise[]>();
  for (const exercise of exercises) {
    const pattern = patternOf(exercise);
    const list = byPattern.get(pattern) ?? [];
    list.push(exercise);
    byPattern.set(pattern, list);
  }

  // Used across the whole week: variety is preferred, but never at the cost of
  // leaving a day half empty, which is what the old hard ban did.
  const usedInBlock = new Set<string>();
  const days: DayPlan[] = [];

  dayTypes.forEach((type, dayIndex) => {
    const weekday = (weekdays[dayIndex] ?? weekdays.at(-1) ?? 1) as Weekday;
    const gripSafe = safeWeekdays.includes(weekday);
    const stations = DAY_STATIONS[type];
    const picked: BlockExercise[] = [];
    const onThisDay = new Set<string>();
    let minutes = WARMUP_MINUTES;

    const eligible = (pattern: Pattern, allowReuse: boolean): Exercise[] =>
      (byPattern.get(pattern) ?? [])
        .filter((exercise) => {
          if (onThisDay.has(exercise.id)) return false;
          if (!allowReuse && usedInBlock.has(exercise.id)) return false;
          // The whole point: high-grip work only on days clear of a round.
          if (exercise.gripLoad === 'high' && !gripSafe) return false;
          if (stations && !stations.includes(exercise.station)) return false;
          return true;
        })
        .sort(
          (a, b) =>
            scoreExercise(b, focusMuscles, pattern) - scoreExercise(a, focusMuscles, pattern) ||
            a.name.localeCompare(b.name),
        );

    const take = (pattern: Pattern, force = false): boolean => {
      const choice = eligible(pattern, false)[0] ?? eligible(pattern, true)[0];
      if (!choice) return false;

      const sets = targetSets(pattern);
      const cost = sets * MINUTES_PER_SET;
      if (!force && minutes + cost > minutesPerSession && picked.length >= MIN_EXERCISES) {
        return false;
      }

      const range = repRange(choice, pattern);
      picked.push({
        blockId,
        exerciseId: choice.id,
        daySlot: slots[dayIndex] ?? 'A',
        targetSets: sets,
        repRangeLow: range.low,
        repRangeHigh: range.high,
        order: picked.length,
      });
      onThisDay.add(choice.id);
      usedInBlock.add(choice.id);
      minutes += cost;
      return true;
    };

    const patterns = [...DAY_PATTERNS[type]].sort(
      (a, b) => PATTERN_ORDER.indexOf(a) - PATTERN_ORDER.indexOf(b),
    );
    for (const pattern of patterns) take(pattern);

    // Top the day up rather than shipping a two-exercise session.
    const fillers: Pattern[] = [...DAY_PATTERNS[type], 'accessory', 'core'];
    for (const pattern of fillers) {
      if (picked.length >= MIN_EXERCISES) break;
      take(pattern, true);
    }

    picked.sort(
      (a, b) =>
        PATTERN_ORDER.indexOf(patternOf(exercises.find((e) => e.id === a.exerciseId) as Exercise)) -
        PATTERN_ORDER.indexOf(patternOf(exercises.find((e) => e.id === b.exerciseId) as Exercise)),
    );
    picked.forEach((entry, i) => {
      entry.order = i;
    });

    if (picked.length < MIN_EXERCISES) {
      warnings.push(
        `Day ${slots[dayIndex]} only found ${picked.length} exercises — the ${DAY_TYPE_LABEL[type].toLowerCase()} options left are thin.`,
      );
    }

    days.push({
      slot: slots[dayIndex] ?? 'A',
      type,
      weekday,
      weekdayLabel: WEEKDAY_LABEL[weekday],
      gripSafe,
      exercises: picked,
      estimatedMinutes: Math.round(minutes),
    });
  });

  const gripDays = days.filter((day) =>
    day.exercises.some(
      (entry) => exercises.find((e) => e.id === entry.exerciseId)?.gripLoad === 'high',
    ),
  );

  const shape = days.map((d) => `${d.weekdayLabel} ${DAY_TYPE_LABEL[d.type].toLowerCase()}`).join(', ');
  const rationale =
    gripDays.length > 0
      ? `${shape}. All grip work sits on ${gripDays
          .map((d) => d.weekdayLabel)
          .join(' and ')}, clear of ${
          golfWeekdays.length ? golfWeekdays.map((d) => WEEKDAY_LABEL[d]).join(' and ') : 'any round'
        } by at least 3 days. Hinges lead each session while the position still holds.`
      : `${shape}. No grip work placed — the golf calendar leaves no room for it.`;

  return { rationale, days, warnings };
}
