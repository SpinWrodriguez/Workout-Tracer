import type { BlockExercise, DaySlot, Exercise, MovementPattern, MuscleId } from '../db/types';
import { type Weekday } from './golf';
import { isTimed } from './repUnit';
import {
  COVERAGE_GROUPS,
  SET_DURATION_SECONDS,
  SET_TOTAL_TOLERANCE,
  WEEKLY_SET_TARGET,
  coversGroup,
  formatViolationsForModel,
  sessionMinutes,
  workingRepRange,
  type CoverageGroup,
} from './blockValidation';
import { type Intensity, type TemplateDay } from './weekTemplate';

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
export const DESIRED_REPS: Record<MovementPattern, { low: number; high: number }> = {
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

/*
 * A hold or a carry is not "10-15 reps of core". Its own pattern target would
 * collapse against its bounds and hand back the entire range, so timed work
 * gets a target in the units it is actually counted in.
 */
const DESIRED_SECONDS = { low: 30, high: 60 };

export function desiredRange(exercise: Exercise): { low: number; high: number } {
  if (isTimed(exercise)) return DESIRED_SECONDS;
  return DESIRED_REPS[exercise.pattern] ?? { low: 8, high: 12 };
}

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

const MIN_EXERCISES = 3;
const MAX_SETS_COMPOUND = 5;
const MAX_SETS_ACCESSORY = 3;
/* One set of anything is a warm-up, not a prescription. Five sessions against a
   33-set target used to trim down to singles trying to fit the band. */
const MIN_SETS_PER_EXERCISE = 2;
export const MAX_VALIDATION_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/*  Variety without decay.                                                    */
/*                                                                            */
/*  The obvious way to make "generate again" produce something new is to ban   */
/*  what the last pass proposed. It is also wrong: exclusion is subtractive,   */
/*  so every press walks further down the ranking and the fifth block is       */
/*  measurably worse than the first, until the pool runs dry and days come     */
/*  back short. Discarded proposals must leave no trace.                       */
/*                                                                            */
/*  So variety is a rotation through candidates that are already close to the  */
/*  best, never a walk away from it: bounded, repeatable, and incapable of     */
/*  degrading. Variant 0 is always the strongest draw, and returning to it     */
/*  returns exactly the block you first saw.                                   */
/* -------------------------------------------------------------------------- */
const VARIANT_BAND = 3;
/** How far below the best score still counts as a comparable alternative. */
const VARIANT_SCORE_SLACK = 2;

function pickFrom(
  candidates: Exercise[],
  focusMuscles: MuscleId[],
  pattern: MovementPattern,
  variant: number,
): Exercise | undefined {
  const best = candidates[0];
  if (!best) return undefined;
  const top = scoreExercise(best, focusMuscles, pattern);
  const band = candidates
    .filter((exercise) => scoreExercise(exercise, focusMuscles, pattern) >= top - VARIANT_SCORE_SLACK)
    .slice(0, VARIANT_BAND);
  return band[variant % band.length] ?? best;
}

/** What filling a day needs to know, and nothing about the week around it. */
interface FillInput {
  blockId: string;
  exercises: Exercise[];
  focusMuscles: MuscleId[];
  hasHistory?: boolean;
  variant?: number;
}

/**
 * Step 3: fill one day from the curated table, inside constraints the template
 * already fixed. The only step that makes a choice, and the seam a model slots
 * into — it is given a day, never asked to pick one.
 */
function fillDay(
  template: TemplateDay,
  input: FillInput,
  usedInBlock: Set<string>,
  stillNeeded: Set<CoverageGroup>,
): BlockExercise[] {
  const { blockId, exercises, focusMuscles, hasHistory = false, variant = 0 } = input;
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
    // A gap in weekly coverage outranks the rotation: filling it is correctness,
    // varying the choice is only taste.
    const covering = candidates.filter((exercise) =>
      [...stillNeeded].some((group) => coversGroup(exercise, group)),
    );
    const pool = covering.length > 0 ? covering : candidates;
    const choice = pickFrom(pool, focusMuscles, pattern, variant);
    if (!choice) return false;

    const sets = template.setsPerExercise;
    const cost = sets * setCost(choice);
    if (!force && seconds + cost > budgetSeconds && picked.length >= MIN_EXERCISES) return false;

    // A light day shifts the range up; the exercise own bounds still win.
    const desired = desiredRange(choice);
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
export function balanceSets(
  days: DayPlan[],
  template: TemplateDay[],
  byId: Map<string, Exercise>,
  target: number,
  /** Sets belonging to days this pass must not modify — a day built by hand
      still counts toward the week even though nothing may touch it. */
  fixedSets = 0,
): void {
  const bySlot = new Map(template.map((day) => [day.slot, day]));
  const total = () =>
    fixedSets + days.reduce((n, day) => n + day.exercises.reduce((m, e) => m + e.targetSets, 0), 0);
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
    // Light days shed volume before heavy ones, and nothing goes below two.
    const chosen = days
      .flatMap((day) => day.exercises.map((entry) => ({ day, entry })))
      .filter(({ entry }) => entry.targetSets > MIN_SETS_PER_EXERCISE)
      .sort(
        (a, b) =>
          (a.day.intensity === 'light' ? 0 : 1) - (b.day.intensity === 'light' ? 0 : 1) ||
          priorityOf(byId.get(b.entry.exerciseId) as Exercise) -
            priorityOf(byId.get(a.entry.exerciseId) as Exercise),
      )[0];
    if (!chosen) break;
    chosen.entry.targetSets -= 1;
  }

  /*
   * The stored estimate has to follow the sets that just moved. It did not,
   * so a day that had been topped up carried the minutes it took BEFORE the
   * extra sets — a field quietly disagreeing with the function that computes
   * it, which is the same class of bug as a ring reading a constant.
   */
  for (const day of days) day.estimatedMinutes = sessionMinutes(day.exercises, byId);
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
        const trimmable = day.exercises.find(
          (entry) => entry.targetSets > MIN_SETS_PER_EXERCISE,
        );
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

/* -------------------------------------------------------------------------- */
/*  One day at a time.                                                        */
/*                                                                            */
/*  Generating a whole week is destructive by nature: it has an opinion about  */
/*  every slot, so it overwrites the day you built by hand. Generating a       */
/*  single day cannot — it is handed one slot and touches nothing else.        */
/*                                                                            */
/*  What the other days contain arrives as `exclude`, which is the honest      */
/*  version of "does not repeat the workout": it is scoped to what is actually */
/*  IN the block, never to what some earlier discarded proposal happened to    */
/*  suggest. Regenerate the same day forty times and the pool is identical     */
/*  every time.                                                               */
/* -------------------------------------------------------------------------- */

export interface GenerateDayInput {
  blockId: string;
  exercises: Exercise[];
  focusMuscles: MuscleId[];
  /** Constraints for this slot, from templateDayFor(). */
  template: TemplateDay;
  /** Exercise ids held by the other days of this block. */
  exclude?: string[];
  variant?: number;
  hasHistory?: boolean;
}

export function generateDay(input: GenerateDayInput): DayPlan {
  const { template, exercises } = input;
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const picked = fillDay(
    template,
    {
      blockId: input.blockId,
      exercises,
      focusMuscles: input.focusMuscles,
      hasHistory: input.hasHistory,
      variant: input.variant,
    },
    new Set<string>(input.exclude ?? []),
    new Set<CoverageGroup>(),
  );

  const day: DayPlan = {
    slot: template.slot,
    weekday: template.weekday,
    weekdayLabel: template.weekdayLabel,
    intensity: template.intensity,
    effortCue: template.effortCue,
    exercises: picked,
    estimatedMinutes: sessionMinutes(picked, byId),
  };

  // Weekly set balancing is a property of the week and cannot be decided from
  // one day, so a single day is filled to the template's own set count and
  // only trimmed to fit its own clock.
  trimToBudget([day], [template], byId);
  return day;
}
