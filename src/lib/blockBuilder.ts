import type { BlockExercise, DaySlot, Exercise, MovementPattern, MuscleId } from '../db/types';
import { type Weekday } from './golf';
import {
  COVERAGE_GROUPS,
  SET_DURATION_SECONDS,
  SET_TOTAL_TOLERANCE,
  WEEKLY_SET_TARGET,
  coversGroup,
  formatViolationsForModel,
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
import { templateWeek, type Intensity, type TemplateDay } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  Block builder.                                                            */
/*                                                                            */
/*  Generation runs in a fixed order and only the third step is a judgement:   */
/*    1. weekTemplate assigns the days.       (code, nothing to decide)       */
/*    2. weekTemplate sets each day intensity and constraint set.   (code)    */
/*    3. fillDay picks exercises inside those constraints.                     */
/*    4. blockValidation checks the result; it is repaired, never empty.       */
/*                                                                            */
/*  Step 3 is the only seam a model would ever occupy, and it is handed the    */
/*  pattern targets, the intensity, the exclusions and the budget for one day. */
/*  It never sees or chooses a date, so it cannot put a deadlift on a Friday.  */
/* -------------------------------------------------------------------------- */

export { WEEKLY_SET_TARGET, formatViolationsForModel };
export type { Intensity };

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

const PATTERN_MUSCLES: Record<MovementPattern, MuscleId[]> = {
  squat: ['quads', 'glutes', 'adductors', 'calves'],
  hinge: ['hamstrings', 'glutes', 'lower_back'],
  push_h: ['chest', 'front_delts', 'triceps'],
  push_v: ['front_delts', 'side_delts', 'triceps'],
  pull_h: ['upper_back', 'lats', 'rear_delts', 'biceps', 'traps'],
  pull_v: ['lats', 'upper_back', 'biceps'],
  carry: ['forearms', 'traps', 'obliques'],
  core: ['abs', 'obliques', 'lower_back'],
  // Rotational power is hips first, torso second — a landmine scoop or
  // rotational press is a hip movement that ends in the arm, so glutes and
  // front delts count as on-pattern here, not as noise.
  rotation: ['obliques', 'abs', 'glutes', 'front_delts'],
};

/** Lower is more important; the time trimmer drops the highest number first. */
function priorityOf(exercise: Exercise): number {
  if (COVERAGE_GROUPS.some((group) => coversGroup(exercise, group))) return 0;
  if (COMPOUND_PATTERNS.includes(exercise.pattern)) return 1;
  return 2;
}

function setCost(exercise: Exercise): number {
  return SET_DURATION_SECONDS + exercise.restSeconds;
}

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
  if (exercise.primaryMuscles.every((m) => PATTERN_MUSCLES[pattern].includes(m))) score += 3;

  if (exercise.loadMode === 'weight') score += 1;
  return score;
}

/* --- generation ------------------------------------------------------------ */

export interface DayPlan {
  slot: DaySlot;
  weekday: Weekday;
  weekdayLabel: string;
  intensity: Intensity;
  effortCue?: string;
  exercises: BlockExercise[];
  estimatedMinutes: number;
}

export interface GeneratedBlock {
  rationale: string;
  days: DayPlan[];
  warnings: string[];
  violations: Violation[];
}

export interface GenerateInput {
  blockId: string;
  exercises: Exercise[];
  focusMuscles: MuscleId[];
  sessionsPerWeek: number;
  /** Weekdays a round is typically played. */
  golfWeekdays: Weekday[];
  /** Weekday for the optional third session. */
  thirdDay?: Weekday;
  minutesPerSession?: number;
  weeklySetTarget?: number;
  hasHistory?: boolean;
  laddersFor?: (exercise: Exercise) => number[];
  /** Model prose, if a proposal came from one. Schedule claims are stripped. */
  modelRationale?: string;
}

const MIN_EXERCISES = 3;
const MAX_SETS_COMPOUND = 5;
const MAX_SETS_ACCESSORY = 3;
export const MAX_VALIDATION_ATTEMPTS = 3;

/**
 * Step 3: fill one day from the curated table, inside constraints the template
 * already fixed. The only step that makes a choice, and the seam a model slots
 * into — it is given a day, never asked to pick one.
 */
function fillDay(
  template: TemplateDay,
  input: GenerateInput,
  usedInBlock: Set<string>,
  stillNeeded: Set<CoverageGroup>,
): BlockExercise[] {
  const { blockId, exercises, focusMuscles, hasHistory = false } = input;
  const budgetSeconds = template.minutesBudget * 60;

  const picked: BlockExercise[] = [];
  const onThisDay = new Set<string>();
  let spinalHigh = 0;
  let seconds = 0;

  const eligible = (pattern: MovementPattern, allowReuse: boolean): Exercise[] =>
    exercises
      .filter((exercise) => {
        if (exercise.pattern !== pattern) return false;
        // Mobility is warm-up work; it is never a programmed working set.
        if (exercise.isMobility) return false;
        if (onThisDay.has(exercise.id)) return false;
        if (!allowReuse && usedInBlock.has(exercise.id)) return false;
        // Grip and spinal exclusions are properties of the day, set by the
        // template — the filler does not get to reason about the calendar.
        if (template.excludeGripHigh && exercise.gripLoad === 'high') return false;
        if (template.excludeSpinalHigh && exercise.spinalLoad === 'high') return false;
        if (exercise.spinalLoad === 'high' && spinalHigh >= 1) return false;
        if (!hasHistory && exercise.skillLevel === 'advanced') return false;
        return true;
      })
      .sort(
        (a, b) =>
          scoreExercise(b, focusMuscles, pattern) - scoreExercise(a, focusMuscles, pattern) ||
          a.name.localeCompare(b.name),
      );

  const take = (pattern: MovementPattern, force = false): boolean => {
    if (picked.length >= template.maxExercises) return false;
    const fresh = eligible(pattern, false);
    const candidates = fresh.length > 0 ? fresh : eligible(pattern, true);
    const choice =
      candidates.find((exercise) =>
        [...stillNeeded].some((group) => coversGroup(exercise, group)),
      ) ?? candidates[0];
    if (!choice) return false;

    const sets = template.setsPerExercise;
    const cost = sets * setCost(choice);
    if (!force && seconds + cost > budgetSeconds && picked.length >= MIN_EXERCISES) return false;

    // A light day shifts the range up; the exercise own bounds still win.
    const desired = DESIRED_REPS[choice.pattern];
    const range = workingRepRange(choice, {
      low: desired.low + template.repShift.low,
      high: desired.high + template.repShift.high,
    });

    picked.push({
      blockId,
      exerciseId: choice.id,
      daySlot: template.slot,
      targetSets: sets,
      repRangeLow: range.low,
      repRangeHigh: range.high,
      order: picked.length,
    });
    onThisDay.add(choice.id);
    usedInBlock.add(choice.id);
    if (choice.spinalLoad === 'high') spinalHigh += 1;
    for (const group of COVERAGE_GROUPS) if (coversGroup(choice, group)) stillNeeded.delete(group);
    seconds += cost;
    return true;
  };

  for (const pattern of [...template.patterns].sort(
    (a, b) => PATTERN_ORDER.indexOf(a) - PATTERN_ORDER.indexOf(b),
  )) {
    take(pattern);
  }

  // Top the day up rather than shipping a two-exercise session.
  for (const pattern of [...template.patterns, 'core' as MovementPattern]) {
    if (picked.length >= MIN_EXERCISES) break;
    take(pattern, true);
  }

  const byId = new Map(exercises.map((e) => [e.id, e]));
  // Explosive work leads, ahead even of the hinge: power is worthless once
  // fatigued, which is the same reason hinges come before everything else.
  const rank = (id: string) => {
    const exercise = byId.get(id);
    if (!exercise) return 99;
    return exercise.isExplosive ? -1 : PATTERN_ORDER.indexOf(exercise.pattern);
  };
  picked.sort((a, b) => rank(a.exerciseId) - rank(b.exerciseId));
  picked.forEach((entry, i) => {
    entry.order = i;
  });
  return picked;
}

/**
 * Adds or removes sets so the week lands inside the target band, spending the
 * cheapest seconds first and never pushing a session past its own budget. The
 * light day is left alone: its set count is part of what makes it light.
 */
function balanceSets(
  days: DayPlan[],
  template: TemplateDay[],
  byId: Map<string, Exercise>,
  target: number,
): void {
  const bySlot = new Map(template.map((day) => [day.slot, day]));
  const total = () =>
    days.reduce((n, day) => n + day.exercises.reduce((m, e) => m + e.targetSets, 0), 0);
  const min = Math.round(target * SET_TOTAL_TOLERANCE.low);
  const max = Math.round(target * SET_TOTAL_TOLERANCE.high);

  let guard = 200;
  while (total() < min && guard-- > 0) {
    const chosen = days
      .filter((day) => day.intensity === 'heavy')
      .flatMap((day) => day.exercises.map((entry) => ({ day, entry })))
      .filter(({ day, entry }) => {
        const exercise = byId.get(entry.exerciseId);
        if (!exercise) return false;
        const cap = COMPOUND_PATTERNS.includes(exercise.pattern)
          ? MAX_SETS_COMPOUND
          : MAX_SETS_ACCESSORY;
        if (entry.targetSets >= cap) return false;
        const after = day.exercises.map((e) =>
          e === entry ? { ...e, targetSets: e.targetSets + 1 } : e,
        );
        const budget = bySlot.get(day.slot)?.minutesBudget ?? day.estimatedMinutes;
        return sessionMinutes(after, byId) <= budget;
      })
      // Compounds earn the extra volume; the cheapest accessory only absorbs
      // what will not fit anywhere better.
      .sort(
        (a, b) =>
          priorityOf(byId.get(a.entry.exerciseId) as Exercise) -
            priorityOf(byId.get(b.entry.exerciseId) as Exercise) ||
          setCost(byId.get(a.entry.exerciseId) as Exercise) -
            setCost(byId.get(b.entry.exerciseId) as Exercise),
      )[0];
    if (!chosen) break;
    chosen.entry.targetSets += 1;
  }

  guard = 200;
  while (total() > max && guard-- > 0) {
    const chosen = days
      .flatMap((day) => day.exercises)
      .filter((entry) => entry.targetSets > 1)
      .sort(
        (a, b) =>
          priorityOf(byId.get(b.exerciseId) as Exercise) -
          priorityOf(byId.get(a.exerciseId) as Exercise),
      )[0];
    if (!chosen) break;
    chosen.targetSets -= 1;
  }
}

/** Drops the lowest-priority accessory until a session fits its own budget. */
function trimToBudget(days: DayPlan[], template: TemplateDay[], byId: Map<string, Exercise>): void {
  const bySlot = new Map(template.map((day) => [day.slot, day]));
  for (const day of days) {
    const budget = bySlot.get(day.slot)?.minutesBudget ?? 40;
    let guard = 20;
    while (sessionMinutes(day.exercises, byId) > budget && guard-- > 0) {
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

      const victim = [...day.exercises]
        .filter(coveredElsewhere)
        .sort(
          (a, b) =>
            priorityOf(byId.get(b.exerciseId) as Exercise) -
            priorityOf(byId.get(a.exerciseId) as Exercise),
        )[0];

      if (!victim || day.exercises.length <= MIN_EXERCISES) {
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
  return {
    days: days.map((day) => ({ slot: day.slot, weekday: day.weekday, exercises: day.exercises })),
  };
}

export function generateBlock(input: GenerateInput): GeneratedBlock {
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const target = input.weeklySetTarget ?? WEEKLY_SET_TARGET;

  // Steps 1 and 2: the week and its constraints, straight from the template.
  const template = templateWeek({
    sessionsPerWeek: input.sessionsPerWeek,
    thirdDay: input.thirdDay,
    golfWeekdays: input.golfWeekdays,
    minutesPerSession: input.minutesPerSession ?? 40,
  });

  const context: ValidationContext = {
    exercisesById: byId,
    golfWeekdays: input.golfWeekdays,
    weeklySetTarget: target,
    sessionBudgetMinutes: input.minutesPerSession ?? 40,
    hasHistory: input.hasHistory ?? false,
    laddersFor: input.laddersFor ?? (() => []),
    template,
  };

  let forced: CoverageGroup[] = [];
  let best: { days: DayPlan[]; violations: Violation[] } | undefined;

  for (let attempt = 0; attempt < MAX_VALIDATION_ATTEMPTS; attempt += 1) {
    const usedInBlock = new Set<string>();
    const stillNeeded = new Set<CoverageGroup>(forced);

    const days: DayPlan[] = template.map((day) => {
      const exercises = fillDay(day, input, usedInBlock, stillNeeded);
      return {
        slot: day.slot,
        weekday: day.weekday,
        weekdayLabel: day.weekdayLabel,
        intensity: day.intensity,
        effortCue: day.effortCue,
        exercises,
        estimatedMinutes: sessionMinutes(exercises, byId),
      };
    });

    trimToBudget(days, template, byId);
    balanceSets(days, template, byId, target);
    for (const day of days) day.estimatedMinutes = sessionMinutes(day.exercises, byId);

    const violations = validateBlock(toProposal(days), context);
    if (!best || violations.length < best.violations.length) best = { days, violations };
    if (violations.length === 0) break;

    forced = violations
      .filter((violation) => violation.code === 'pattern_coverage')
      .flatMap((violation) => COVERAGE_GROUPS.filter((group) => violation.message.includes(group)));
  }

  const resolved = best ?? { days: [], violations: [] };
  const proposal = toProposal(resolved.days);

  const explanation = stripScheduleClaims(input.modelRationale);
  const rationale = [explanation, scheduleSentence(proposal, context)].filter(Boolean).join(' ');

  const warnings: string[] = [];
  const light = resolved.days.find((day) => day.intensity === 'light');
  if (light) warnings.push(`${light.weekdayLabel} is the light session — ${light.effortCue}.`);
  if (resolved.violations.length > 0) {
    warnings.push(
      `${resolved.violations.length} rule${resolved.violations.length === 1 ? '' : 's'} could not be satisfied after ${MAX_VALIDATION_ATTEMPTS} attempts.`,
    );
  }

  return { rationale, days: resolved.days, warnings, violations: resolved.violations };
}
