import type {
  BlockExercise,
  DaySlot,
  Exercise,
  MovementPattern,
  MuscleId,
  Station,
} from '../db/types';
import { WEEKDAY_LABEL, gripSafeWeekdays, type Weekday } from './golf';
import {
  COVERAGE_GROUPS,
  SET_DURATION_SECONDS,
  WEEKLY_SET_TARGET,
  SET_TOTAL_TOLERANCE,
  coversGroup,
  formatViolationsForModel,
  gripAllowed,
  scheduleSentence,
  sessionMinutes,
  stripScheduleClaims,
  validateBlock,
  workingRepRange,
  type BlockProposal,
  type CoverageGroup,
  type ValidationContext,
  type Violation,
} from './blockValidation';

/* -------------------------------------------------------------------------- */
/*  Deterministic block builder — spec Phase 3.                               */
/*                                                                            */
/*  It proposes; blockValidation decides. Nothing here is trusted on its own   */
/*  word: the proposal goes through the same validator a model response will,  */
/*  and an invalid one is repaired and re-checked rather than shipped.         */
/* -------------------------------------------------------------------------- */

export { WEEKLY_SET_TARGET };

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

/** Hinges lead: they are the form risk and belong while the position holds. */
const PATTERN_ORDER: MovementPattern[] = [
  'hinge',
  'squat',
  'push_h',
  'push_v',
  'pull_v',
  'pull_h',
  'carry',
  'rotation',
  'core',
];

const DAY_PATTERNS: Record<DayType, MovementPattern[]> = {
  full: ['hinge', 'squat', 'push_h', 'pull_h', 'core'],
  upper: ['push_h', 'pull_v', 'push_v', 'pull_h', 'core'],
  lower: ['hinge', 'squat', 'squat', 'core'],
  push: ['push_h', 'push_v', 'push_h', 'core'],
  pull: ['pull_v', 'pull_h', 'pull_h', 'carry'],
  legs: ['hinge', 'squat', 'squat', 'core'],
  core: ['core', 'rotation', 'core', 'carry'],
  cable: ['pull_h', 'push_h', 'rotation', 'core'],
};

/** Some day types constrain the station rather than the movement. */
const DAY_STATIONS: Partial<Record<DayType, Station[]>> = { cable: ['cable'] };

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

export function splitFits(split: SplitId, sessionsPerWeek: number): boolean {
  if (split === 'custom') return true;
  return sessionsPerWeek >= SPLIT_CYCLE[split].length;
}

/* --- prescription ---------------------------------------------------------- */

/** Hypertrophy targets, narrowed to whatever the exercise can actually take. */
const DESIRED_REPS: Record<MovementPattern, { low: number; high: number }> = {
  squat: { low: 6, high: 10 },
  hinge: { low: 6, high: 10 },
  push_h: { low: 6, high: 12 },
  push_v: { low: 6, high: 12 },
  pull_h: { low: 8, high: 12 },
  pull_v: { low: 6, high: 12 },
  carry: { low: 20, high: 40 },
  core: { low: 10, high: 15 },
  rotation: { low: 10, high: 15 },
};

const COMPOUND_PATTERNS: MovementPattern[] = [
  'squat',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
];

/** Lower is more important; the time trimmer drops the highest number first. */
function priorityOf(exercise: Exercise): number {
  if (COVERAGE_GROUPS.some((group) => coversGroup(exercise, group))) return 0;
  if (COMPOUND_PATTERNS.includes(exercise.pattern)) return 1;
  return 2;
}

function baseSets(exercise: Exercise): number {
  return COMPOUND_PATTERNS.includes(exercise.pattern) ? 3 : 2;
}

/** Seconds one more set of this exercise costs. */
function setCost(exercise: Exercise): number {
  return SET_DURATION_SECONDS + exercise.restSeconds;
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
 * Golf days are out, sessions spread as evenly as the week allows, and the
 * earliest grip-safe day is preferred as the anchor. Searched rather than
 * stepped greedily — a greedy walk picks Mon/Tue/Thu where Mon/Wed/Fri is
 * plainly the better week.
 */
export function chooseTrainingWeekdays(
  sessionsPerWeek: number,
  golfWeekdays: Weekday[],
): Weekday[] {
  const pool = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter((day) => !golfWeekdays.includes(day));
  const wanted = Math.max(1, Math.min(sessionsPerWeek, pool.length));
  if (pool.length === 0) return [];

  const anchor = gripSafeWeekdays(golfWeekdays)[0];

  let best: Weekday[] | undefined;
  let bestScore = [-1, -1];
  for (const combo of combinations(pool, wanted)) {
    const score = [minCircularGap(combo), anchor !== undefined && combo.includes(anchor) ? 1 : 0];
    if (score[0]! > bestScore[0]! || (score[0] === bestScore[0] && score[1]! > bestScore[1]!)) {
      best = combo;
      bestScore = score;
    }
  }
  return (best ?? pool.slice(0, wanted)).sort((a, b) => a - b);
}

/* --- scoring --------------------------------------------------------------- */

const PATTERN_MUSCLES: Record<MovementPattern, MuscleId[]> = {
  squat: ['quads', 'glutes', 'adductors', 'calves'],
  hinge: ['hamstrings', 'glutes', 'lower_back'],
  push_h: ['chest', 'front_delts', 'triceps'],
  push_v: ['front_delts', 'side_delts', 'triceps'],
  pull_h: ['upper_back', 'lats', 'rear_delts', 'biceps', 'traps'],
  pull_v: ['lats', 'upper_back', 'biceps'],
  carry: ['forearms', 'traps', 'obliques'],
  core: ['abs', 'obliques', 'lower_back'],
  rotation: ['obliques', 'abs'],
};

function scoreExercise(
  exercise: Exercise,
  focusMuscles: MuscleId[],
  pattern: MovementPattern,
): number {
  let score = 0;
  for (const m of exercise.primaryMuscles) if (focusMuscles.includes(m)) score += 3;
  for (const m of exercise.secondaryMuscles) if (focusMuscles.includes(m)) score += 1;

  // Compounds over isolation: without this the tie-break is alphabetical, which
  // quietly picks a barbell curl over a bent-over row for the pull slot.
  score += exercise.primaryMuscles.length * 1.5;
  score += Math.min(2, exercise.secondaryMuscles.length * 0.4);

  // Prefer an exercise that IS the pattern over one that merely touches it, so
  // the squat slot takes a back squat rather than a landmine squat-to-press.
  const wanted = PATTERN_MUSCLES[pattern];
  if (exercise.primaryMuscles.every((m) => wanted.includes(m))) score += 3;

  if (exercise.loadMode === 'weight') score += 1;
  return score;
}

/* --- generation ------------------------------------------------------------ */

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
  /** Anything the validator still objects to after the retries. */
  violations: Violation[];
}

export interface GenerateInput {
  blockId: string;
  exercises: Exercise[];
  focusMuscles: MuscleId[];
  sessionsPerWeek: number;
  golfWeekdays: Weekday[];
  split?: SplitId;
  customDayTypes?: DayType[];
  minutesPerSession?: number;
  weeklySetTarget?: number;
  /** False for a first block: advanced movements are excluded.  */
  hasHistory?: boolean;
  /** Loadable rungs per exercise, so start weights land on real numbers. */
  laddersFor?: (exercise: Exercise) => number[];
  /** Model-supplied prose, if a proposal came from one. Claims are stripped. */
  modelRationale?: string;
}

const SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];
const MIN_EXERCISES = 4;
const MAX_SETS_PER_EXERCISE = 5;
/* Accessories are there to top up a session, not to absorb the whole week. */
const MAX_SETS_ACCESSORY = 3;
export const MAX_VALIDATION_ATTEMPTS = 3;

interface Attempt {
  days: DayPlan[];
  warnings: string[];
}

function buildAttempt(input: GenerateInput, forcedGroups: CoverageGroup[]): Attempt {
  const {
    blockId,
    exercises,
    focusMuscles,
    sessionsPerWeek,
    golfWeekdays,
    split = 'full_body',
    customDayTypes,
    minutesPerSession = 40,
    hasHistory = false,
  } = input;

  const warnings: string[] = [];
  const dayTypes = dayTypesFor(split, sessionsPerWeek, customDayTypes);
  const weekdays = chooseTrainingWeekdays(sessionsPerWeek, golfWeekdays);
  const budgetSeconds = minutesPerSession * 60;

  if (gripSafeWeekdays(golfWeekdays).length === 0) {
    warnings.push(
      'Every weekday is within 3 days of a round — no high-grip work can be placed.',
    );
  }
  if (!splitFits(split, sessionsPerWeek)) {
    warnings.push(
      `${SPLIT_LABEL[split]} wants ${SPLIT_CYCLE[split as Exclude<SplitId, 'custom'>].length} sessions a week; with ${sessionsPerWeek} some of it will not be trained.`,
    );
  }

  const byPattern = new Map<MovementPattern, Exercise[]>();
  for (const exercise of exercises) {
    const list = byPattern.get(exercise.pattern) ?? [];
    list.push(exercise);
    byPattern.set(exercise.pattern, list);
  }

  const usedInBlock = new Set<string>();
  const days: DayPlan[] = [];
  const stillNeeded = new Set<CoverageGroup>(forcedGroups);

  dayTypes.forEach((type, dayIndex) => {
    const slot = SLOTS[dayIndex] ?? 'A';
    const weekday = (weekdays[dayIndex] ?? weekdays.at(-1) ?? 1) as Weekday;
    const canGrip = gripAllowed(weekday, golfWeekdays);
    const stations = DAY_STATIONS[type];

    const picked: BlockExercise[] = [];
    const onThisDay = new Set<string>();
    let spinalHigh = 0;
    let seconds = 0;

    const eligible = (pattern: MovementPattern, allowReuse: boolean): Exercise[] =>
      (byPattern.get(pattern) ?? [])
        .filter((exercise) => {
          if (onThisDay.has(exercise.id)) return false;
          if (!allowReuse && usedInBlock.has(exercise.id)) return false;
          // (c) grip clearance is computed, never assumed.
          if (exercise.gripLoad === 'high' && !canGrip) return false;
          // (d) one heavy axial lift per session.
          if (exercise.spinalLoad === 'high' && spinalHigh >= 1) return false;
          // (e) no advanced movements in a first block.
          if (!hasHistory && exercise.skillLevel === 'advanced') return false;
          if (stations && !stations.includes(exercise.station)) return false;
          return true;
        })
        .sort(
          (a, b) =>
            scoreExercise(b, focusMuscles, pattern) - scoreExercise(a, focusMuscles, pattern) ||
            a.name.localeCompare(b.name),
        );

    const take = (pattern: MovementPattern, force = false): boolean => {
      const candidates = eligible(pattern, false).length
        ? eligible(pattern, false)
        : eligible(pattern, true);
      // Prefer one that closes an outstanding coverage gap.
      const choice =
        candidates.find((exercise) =>
          [...stillNeeded].some((group) => coversGroup(exercise, group)),
        ) ?? candidates[0];
      if (!choice) return false;

      const sets = baseSets(choice);
      const cost = sets * setCost(choice);
      if (!force && seconds + cost > budgetSeconds && picked.length >= MIN_EXERCISES) return false;

      const range = workingRepRange(choice, DESIRED_REPS[choice.pattern]);
      picked.push({
        blockId,
        exerciseId: choice.id,
        daySlot: slot,
        targetSets: sets,
        repRangeLow: range.low,
        repRangeHigh: range.high,
        order: picked.length,
        // No startWeightKg on purpose. With no history there is nothing to base
        // one on, and the bottom rung of the ladder is a number pretending to
        // be a decision. The session screen's progression card asks for it on
        // the first set instead. Rule (h) still validates any weight a model
        // does supply.
      });
      onThisDay.add(choice.id);
      usedInBlock.add(choice.id);
      if (choice.spinalLoad === 'high') spinalHigh += 1;
      for (const group of COVERAGE_GROUPS) if (coversGroup(choice, group)) stillNeeded.delete(group);
      seconds += cost;
      return true;
    };

    for (const pattern of [...DAY_PATTERNS[type]].sort(
      (a, b) => PATTERN_ORDER.indexOf(a) - PATTERN_ORDER.indexOf(b),
    )) {
      take(pattern);
    }

    // Top the day up rather than shipping a two-exercise session.
    for (const pattern of [...DAY_PATTERNS[type], 'core' as MovementPattern]) {
      if (picked.length >= MIN_EXERCISES) break;
      take(pattern, true);
    }

    const byId = new Map(exercises.map((e) => [e.id, e]));
    picked.sort(
      (a, b) =>
        PATTERN_ORDER.indexOf(byId.get(a.exerciseId)?.pattern as MovementPattern) -
        PATTERN_ORDER.indexOf(byId.get(b.exerciseId)?.pattern as MovementPattern),
    );
    picked.forEach((entry, i) => {
      entry.order = i;
    });

    days.push({
      slot,
      type,
      weekday,
      weekdayLabel: WEEKDAY_LABEL[weekday],
      gripSafe: canGrip,
      exercises: picked,
      estimatedMinutes: sessionMinutes(picked, byId),
    });
  });

  return { days, warnings };
}

/**
 * Adds or removes sets so the week lands inside the target band, spending the
 * cheapest seconds first and never pushing a session past its budget.
 */
function balanceSets(
  days: DayPlan[],
  byId: Map<string, Exercise>,
  target: number,
  budgetMinutes: number,
): void {
  const total = () =>
    days.reduce((n, day) => n + day.exercises.reduce((m, e) => m + e.targetSets, 0), 0);
  const min = Math.round(target * SET_TOTAL_TOLERANCE.low);
  const max = Math.round(target * SET_TOTAL_TOLERANCE.high);

  let guard = 200;
  while (total() < min && guard-- > 0) {
    const options = days
      .flatMap((day) => day.exercises.map((entry) => ({ day, entry })))
      .filter(({ day, entry }) => {
        const exercise = byId.get(entry.exerciseId);
        if (!exercise) return false;
        const cap = COMPOUND_PATTERNS.includes(exercise.pattern)
          ? MAX_SETS_PER_EXERCISE
          : MAX_SETS_ACCESSORY;
        if (entry.targetSets >= cap) return false;
        const after = day.exercises.map((e) =>
          e === entry ? { ...e, targetSets: e.targetSets + 1 } : e,
        );
        return sessionMinutes(after, byId) <= budgetMinutes;
      })
      // Compounds earn the extra volume; the cheapest accessory only absorbs
      // what will not fit anywhere better.
      .sort(
        (a, b) =>
          priorityOf(byId.get(a.entry.exerciseId) as Exercise) -
            priorityOf(byId.get(b.entry.exerciseId) as Exercise) ||
          setCost(byId.get(a.entry.exerciseId) as Exercise) -
            setCost(byId.get(b.entry.exerciseId) as Exercise),
      );
    const chosen = options[0];
    if (!chosen) break;
    chosen.entry.targetSets += 1;
  }

  guard = 200;
  while (total() > max && guard-- > 0) {
    const options = days
      .flatMap((day) => day.exercises)
      .filter((entry) => entry.targetSets > 1)
      .sort(
        (a, b) =>
          priorityOf(byId.get(b.exerciseId) as Exercise) -
          priorityOf(byId.get(a.exerciseId) as Exercise),
      );
    const chosen = options[0];
    if (!chosen) break;
    chosen.targetSets -= 1;
  }
}

/**
 * Drops the lowest-priority accessory until a session fits its budget. Never
 * drops something that is the only thing covering a required pattern.
 */
function trimToBudget(
  days: DayPlan[],
  byId: Map<string, Exercise>,
  budgetMinutes: number,
): void {
  for (const day of days) {
    let guard = 20;
    while (sessionMinutes(day.exercises, byId) > budgetMinutes && guard-- > 0) {
      const coveredElsewhere = (entry: BlockExercise): boolean => {
        const exercise = byId.get(entry.exerciseId);
        if (!exercise) return true;
        const groups = COVERAGE_GROUPS.filter((group) => coversGroup(exercise, group));
        if (groups.length === 0) return true;
        return groups.every((group) =>
          days.some((other) =>
            other.exercises.some((candidate) => {
              if (candidate === entry) return false;
              const alt = byId.get(candidate.exerciseId);
              return alt !== undefined && coversGroup(alt, group);
            }),
          ),
        );
      };

      const droppable = [...day.exercises]
        .filter(coveredElsewhere)
        .sort(
          (a, b) =>
            priorityOf(byId.get(b.exerciseId) as Exercise) -
            priorityOf(byId.get(a.exerciseId) as Exercise),
        );
      const victim = droppable[0];
      if (!victim || day.exercises.length <= MIN_EXERCISES) {
        // Nothing safe left to drop: shed a set instead.
        const trimmable = day.exercises.find((entry) => entry.targetSets > 1);
        if (!trimmable) break;
        trimmable.targetSets -= 1;
        continue;
      }
      day.exercises = day.exercises.filter((entry) => entry !== victim);
      day.exercises.forEach((entry, i) => {
        entry.order = i;
      });
    }
    day.estimatedMinutes = sessionMinutes(day.exercises, byId);
  }
}

function toProposal(days: DayPlan[]): BlockProposal {
  return { days: days.map((day) => ({ slot: day.slot, weekday: day.weekday, exercises: day.exercises })) };
}

/**
 * Builds, validates, and repairs — up to three attempts, exactly as a model
 * response would be handled. Whatever the validator still objects to is
 * returned rather than hidden, because a silently invalid block is the bug
 * this whole layer exists to stop.
 */
export function generateBlock(input: GenerateInput): GeneratedBlock {
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const target = input.weeklySetTarget ?? WEEKLY_SET_TARGET;
  const budget = input.minutesPerSession ?? 40;

  const context: ValidationContext = {
    exercisesById: byId,
    golfWeekdays: input.golfWeekdays,
    weeklySetTarget: target,
    sessionBudgetMinutes: budget,
    hasHistory: input.hasHistory ?? false,
    laddersFor: input.laddersFor ?? (() => []),
  };

  let forced: CoverageGroup[] = [];
  let best: { days: DayPlan[]; warnings: string[]; violations: Violation[] } | undefined;

  for (let attempt = 0; attempt < MAX_VALIDATION_ATTEMPTS; attempt += 1) {
    const { days, warnings } = buildAttempt(input, forced);
    trimToBudget(days, byId, budget);
    balanceSets(days, byId, target, budget);
    for (const day of days) day.estimatedMinutes = sessionMinutes(day.exercises, byId);

    const violations = validateBlock(toProposal(days), context);
    if (!best || violations.length < best.violations.length) best = { days, warnings, violations };
    if (violations.length === 0) break;

    // Feed the failure back into the next attempt, the way a retry would.
    forced = violations
      .filter((violation) => violation.code === 'pattern_coverage')
      .flatMap((violation) =>
        COVERAGE_GROUPS.filter((group) => violation.message.includes(group)),
      );
  }

  const resolved = best ?? { days: [], warnings: [], violations: [] };
  const proposal = toProposal(resolved.days);

  // The model may explain choices; it may not assert schedule facts. Anything
  // it claimed about spacing or compliance is stripped, and the real sentence
  // is generated here from the validated calendar.
  const explanation = stripScheduleClaims(input.modelRationale);
  const rationale = [explanation, scheduleSentence(proposal, context)]
    .filter(Boolean)
    .join(' ');

  const warnings = [...resolved.warnings];
  if (resolved.violations.length > 0) {
    warnings.push(
      `${resolved.violations.length} rule${resolved.violations.length === 1 ? '' : 's'} could not be satisfied after ${MAX_VALIDATION_ATTEMPTS} attempts.`,
    );
  }

  return { rationale, days: resolved.days, warnings, violations: resolved.violations };
}

export { formatViolationsForModel };
