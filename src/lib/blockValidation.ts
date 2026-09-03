import type { BlockExercise, DaySlot, Exercise, MovementPattern, MuscleId } from '../db/types';
import { GRIP_BUFFER_DAYS, WEEKDAY_LABEL, gripSafeWeekdays, type Weekday } from './golf';

import { weekdayAllowed, type TemplateDay } from './weekTemplate';
import { isTimed, rangeLabel, repUnitWord } from './repUnit';

/* -------------------------------------------------------------------------- */
/*  Block validation.                                                         */
/*                                                                            */
/*  Every proposed block is checked here before it is shown or stored, whether */
/*  it came from the deterministic builder or (later) from a model. Nothing    */
/*  self-reports compliance: days-clear from golf, session duration and        */
/*  loadable weights are all recomputed from the calendar and the inventory.   */
/*                                                                            */
/*  Violations carry a message written to be fed straight back to a model on   */
/*  retry, naming the exercise and the number that failed.                     */
/* -------------------------------------------------------------------------- */

/** Working time for one set, before rest. */
export const SET_DURATION_SECONDS = 40;
export const WARMUP_SECONDS = 300;

/** Weekly set target. Shared with the dashboard ring so the two cannot drift. */
export const WEEKLY_SET_TARGET = 33;
export const SET_TOTAL_TOLERANCE = { low: 0.8, high: 1.2 };

export interface ProposedDay {
  slot: DaySlot;
  weekday: Weekday;
  exercises: BlockExercise[];
}

export interface BlockProposal {
  rationale?: string;
  days: ProposedDay[];
}

export interface ValidationContext {
  exercisesById: Map<string, Exercise>;
  /** Weekdays a round is played. Days-clear is derived from this, never given. */
  golfWeekdays: Weekday[];
  weeklySetTarget: number;
  sessionBudgetMinutes: number;
  /** Block 1 has no history, so advanced movements are off the table. */
  hasHistory: boolean;
  /** Loadable rungs for an exercise, from the real plate inventory. */
  laddersFor: (exercise: Exercise) => number[];
  /** The fixed week. Placement and per-day limits are checked against it. */
  template?: TemplateDay[];
  /**
   * What to call a day in a message. Injected because the validator has no
   * business knowing about stored names or how they are derived — it only
   * needs something the reader will recognise on screen.
   */
  nameFor?: (slot: DaySlot) => string;
}

export type ViolationCode =
  | 'unknown_exercise'
  | 'rep_range'
  | 'grip_conflict'
  | 'spinal_stacking'
  | 'skill_too_advanced'
  | 'pattern_coverage'
  | 'weekly_set_total'
  | 'unloadable_weight'
  | 'over_time_budget'
  | 'forbidden_day'
  | 'light_day_violation';

/* -------------------------------------------------------------------------- */
/*  A problem you cannot act on is just bad news.                             */
/*                                                                            */
/*  Every problem carries the change that would resolve it, as data rather     */
/*  than prose: the screen turns it into one button. If a rule cannot describe */
/*  its own fix it has no business being reported as a problem.               */
/* -------------------------------------------------------------------------- */

export type Fix =
  | { kind: 'move_to_weekday'; slot: DaySlot; weekday: Weekday; label: string }
  | { kind: 'remove_exercise'; slot: DaySlot; exerciseId: string; label: string }
  | { kind: 'snap_weight'; slot: DaySlot; exerciseId: string; kg: number; label: string };

export interface Violation {
  code: ViolationCode;
  message: string;
  slot?: DaySlot;
  exerciseId?: string;
  /** What to do about it. Always present on a problem. */
  fix?: Fix;
}

/* -------------------------------------------------------------------------- */
/*  Not everything is a rule.                                                 */
/*                                                                            */
/*  Presenting "this session runs 7 minutes long" with the same weight as      */
/*  "this deadlift is two days before your round" trains you to ignore both.   */
/*  Only the things that will actually cost you something are problems: the    */
/*  golf rule the app exists to enforce, a back stacked with two heavy spinal  */
/*  lifts, a weight the plates cannot make, a day on a date that is not a      */
/*  training day. The rest is advice about volume and time — real, worth       */
/*  reading, and yours to overrule.                                            */
/* -------------------------------------------------------------------------- */

export type Severity = 'problem' | 'suggestion';

const SEVERITY: Record<ViolationCode, Severity> = {
  unknown_exercise: 'problem',
  grip_conflict: 'problem',
  spinal_stacking: 'problem',
  unloadable_weight: 'problem',
  forbidden_day: 'problem',
  rep_range: 'suggestion',
  skill_too_advanced: 'suggestion',
  pattern_coverage: 'suggestion',
  weekly_set_total: 'suggestion',
  over_time_budget: 'suggestion',
  light_day_violation: 'suggestion',
};

export function severityOf(code: ViolationCode): Severity {
  return SEVERITY[code];
}

/*
 * A ceiling on hand-built days rather than the template's own target. The
 * generator fills to a time budget and stops around five; a day you built
 * yourself is your business until it stops being a session and starts being a
 * list.
 */
export const HARD_MAX_EXERCISES = 10;

/* --- schedule facts, computed not claimed --------------------------------- */

/**
 * Forward distance from `weekday` to the next round, around a repeating week.
 * 7 when no rounds are played at all.
 */
export function daysClearOfGolf(weekday: Weekday, golfWeekdays: Weekday[]): number {
  if (golfWeekdays.length === 0) return 7;
  return Math.min(...golfWeekdays.map((golf) => (golf - weekday + 7) % 7));
}

export function gripAllowed(weekday: Weekday, golfWeekdays: Weekday[]): boolean {
  return daysClearOfGolf(weekday, golfWeekdays) > GRIP_BUFFER_DAYS;
}

/* --- time, computed from real rest periods -------------------------------- */

export function sessionSeconds(
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
): number {
  return entries.reduce((total, entry) => {
    const exercise = exercisesById.get(entry.exerciseId);
    if (!exercise) return total;
    return total + entry.targetSets * (SET_DURATION_SECONDS + exercise.restSeconds);
  }, WARMUP_SECONDS);
}

export function sessionMinutes(
  entries: BlockExercise[],
  exercisesById: Map<string, Exercise>,
): number {
  return Math.round(sessionSeconds(entries, exercisesById) / 60);
}

/* --- pattern coverage ------------------------------------------------------ */

export type CoverageGroup = 'squat' | 'hinge' | 'push' | 'pull' | 'core';

export const COVERAGE_GROUPS: CoverageGroup[] = ['squat', 'hinge', 'push', 'pull', 'core'];

const GROUP_PATTERNS: Record<CoverageGroup, MovementPattern[]> = {
  squat: ['squat'],
  hinge: ['hinge'],
  push: ['push_h', 'push_v'],
  pull: ['pull_h', 'pull_v'],
  core: ['core'],
};

/*
 * A pattern alone is not coverage: a calf raise is a 'squat' pattern and a
 * bicep curl is 'pull_h', and neither trains the thing the group is there for.
 * The exercise must also carry a primary muscle the group exists to work.
 */
const GROUP_MUSCLES: Record<CoverageGroup, MuscleId[]> = {
  squat: ['quads', 'glutes'],
  hinge: ['hamstrings', 'glutes'],
  push: ['chest', 'front_delts'],
  pull: ['lats', 'upper_back'],
  core: ['abs', 'obliques'],
};

export function coversGroup(exercise: Exercise, group: CoverageGroup): boolean {
  return (
    GROUP_PATTERNS[group].includes(exercise.pattern) &&
    exercise.primaryMuscles.some((muscle) => GROUP_MUSCLES[group].includes(muscle))
  );
}

/* --- rep range ------------------------------------------------------------- */

/**
 * A working range for an exercise: the hypertrophy target where it overlaps the
 * exercise's own bounds, otherwise the exercise's bounds. A Turkish get-up ends
 * up at 1-5 rather than being handed a global 10-15.
 */
export function workingRepRange(
  exercise: Exercise,
  desired: { low: number; high: number },
): { low: number; high: number } {
  const low = Math.max(exercise.repMin, desired.low);
  const high = Math.min(exercise.repMax, desired.high);
  if (low > high) return { low: exercise.repMin, high: exercise.repMax };
  if (low < high) return { low, high };

  // The desired range collapsed onto a single value at the edge of what the
  // exercise takes — "3 x 10-10" is a prescription, not a range. Open it back
  // up, still inside the exercise bounds: upward if there is room above,
  // downward when the exercise ceiling is what pinned it.
  const room = Math.max(2, Math.round(low * 0.25));
  const up = Math.min(exercise.repMax, low + room);
  if (up > low) return { low, high: up };
  return { low: Math.max(exercise.repMin, low - room), high: low };
}

/* --- the validator --------------------------------------------------------- */

/** The day's name as the reader sees it, or its slot when nothing named it. */
function dayNameIn(context: ValidationContext, slot: DaySlot): string {
  return context.nameFor?.(slot) ?? `Day ${slot}`;
}

export function validateBlock(
  proposal: BlockProposal,
  context: ValidationContext,
): Violation[] {
  const violations: Violation[] = [];
  const { exercisesById, golfWeekdays } = context;

  let weeklySets = 0;
  const covered = new Set<CoverageGroup>();

  const templateBySlot = new Map((context.template ?? []).map((day) => [day.slot, day]));

  const nameOf = (day: ProposedDay) => dayNameIn(context, day.slot);
  const taken = new Set(proposal.days.map((day) => day.weekday));

  /** A day this workout could move to: allowed, free, and clear of a round. */
  const freeWeekday = (needsGripClearance: boolean): Weekday | undefined => {
    const usable = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).filter(
      (weekday) =>
        weekdayAllowed(weekday, golfWeekdays) &&
        (!needsGripClearance || gripSafeWeekdays(golfWeekdays).includes(weekday)),
    );
    return usable.find((weekday) => !taken.has(weekday)) ?? usable[0];
  };

  for (const day of proposal.days) {
    let spinalHigh = 0;
    const template = templateBySlot.get(day.slot);

    // Placement is owned by the template, so a day that has drifted off it is a
    // bug in whatever produced the proposal, not a judgement call.
    if (!weekdayAllowed(day.weekday, golfWeekdays)) {
      violations.push({
        code: 'forbidden_day',
        slot: day.slot,
        message: `${nameOf(day)} is scheduled on ${WEEKDAY_LABEL[day.weekday]}, which is never a training day.`,
        fix: moveFix(day.slot, freeWeekday(false)),
      });
    } else if (template && template.weekday !== day.weekday) {
      violations.push({
        code: 'forbidden_day',
        slot: day.slot,
        message: `${nameOf(day)} is on ${WEEKDAY_LABEL[day.weekday]} but the template puts it on ${template.weekdayLabel}.`,
        fix: moveFix(day.slot, template.weekday),
      });
    }

    if (day.exercises.length > HARD_MAX_EXERCISES) {
      violations.push({
        code: 'light_day_violation',
        slot: day.slot,
        message: `${nameOf(day)} has ${day.exercises.length} exercises. Much past ${HARD_MAX_EXERCISES} and it stops being one session.`,
      });
    }

    for (const entry of day.exercises) {
      const exercise = exercisesById.get(entry.exerciseId);

      // (a) every id exists in the curated table
      if (!exercise) {
        violations.push({
          code: 'unknown_exercise',
          slot: day.slot,
          exerciseId: entry.exerciseId,
          message: `${nameOf(day)}: "${entry.exerciseId}" is not in the exercise table.`,
          fix: {
            kind: 'remove_exercise',
            slot: day.slot,
            exerciseId: entry.exerciseId,
            label: 'Remove it',
          },
        });
        continue;
      }

      if (!exercise.isMobility) weeklySets += entry.targetSets;
      for (const group of COVERAGE_GROUPS) {
        if (coversGroup(exercise, group)) covered.add(group);
      }

      // (b) prescribed reps inside the exercise's own bounds
      if (entry.repRangeLow < exercise.repMin || entry.repRangeHigh > exercise.repMax) {
        violations.push({
          code: 'rep_range',
          slot: day.slot,
          exerciseId: exercise.id,
          // "only takes" read as nonsense when the exercise's range is the
          // wider one — the point is that the prescription sits outside it,
          // in whichever direction.
          message: `${nameOf(day)}: ${exercise.name} is set to ${rangeLabel(
            exercise,
            entry.repRangeLow,
            entry.repRangeHigh,
          )}, outside its usual ${rangeLabel(exercise, exercise.repMin, exercise.repMax)}${
            isTimed(exercise) ? '' : ` ${repUnitWord(exercise)}`
          }.`,
        });
      }

      // (c) grip clearance, computed from the calendar
      if (exercise.gripLoad === 'high') {
        const clear = daysClearOfGolf(day.weekday, golfWeekdays);
        if (clear <= GRIP_BUFFER_DAYS) {
          violations.push({
            code: 'grip_conflict',
            slot: day.slot,
            exerciseId: exercise.id,
            message: `${nameOf(day)} is ${WEEKDAY_LABEL[day.weekday]}, ${clear} day${clear === 1 ? '' : 's'} before your next round, and ${exercise.name} is high grip load.`,
            // Moving the whole day is the better fix where a clear day exists:
            // the session is fine, its placement is not. Dropping the movement
            // is the fallback when the calendar has no room.
            fix:
              moveFix(day.slot, freeWeekday(true)) ??
              ({
                kind: 'remove_exercise',
                slot: day.slot,
                exerciseId: exercise.id,
                label: `Drop ${exercise.name}`,
              } as Fix),
          });
        }
      }

      // (d) one heavy axial lift per session
      if (exercise.spinalLoad === 'high') spinalHigh += 1;

      // A light day is defined by what it excludes, so those are hard rules.
      if (template?.intensity === 'light') {
        if (template.excludeGripHigh && exercise.gripLoad === 'high') {
          violations.push({
            code: 'light_day_violation',
            slot: day.slot,
            exerciseId: exercise.id,
            message: `${nameOf(day)} is the light session: ${exercise.name} is high grip load and does not belong on it.`,
          });
        }
        if (template.excludeSpinalHigh && exercise.spinalLoad === 'high') {
          violations.push({
            code: 'light_day_violation',
            slot: day.slot,
            exerciseId: exercise.id,
            message: `${nameOf(day)} is the light session: ${exercise.name} is a heavy spinal-load lift and does not belong on it.`,
          });
        }
        if (entry.targetSets > template.setsPerExercise) {
          violations.push({
            code: 'light_day_violation',
            slot: day.slot,
            exerciseId: exercise.id,
            message: `${nameOf(day)} is the light session: ${exercise.name} is prescribed ${entry.targetSets} sets, and light days cap at ${template.setsPerExercise}.`,
          });
        }
      }

      // (e) no advanced work in a first block
      if (!context.hasHistory && exercise.skillLevel === 'advanced') {
        violations.push({
          code: 'skill_too_advanced',
          slot: day.slot,
          exerciseId: exercise.id,
          message: `${nameOf(day)}: ${exercise.name} is an advanced movement and this is a first block with no logged history. Choose a beginner or intermediate alternative.`,
        });
      }

      // (h) a start weight that can actually be loaded
      if (entry.startWeightKg !== undefined) {
        const ladder = context.laddersFor(exercise);
        const loadable = ladder.some((rung) => Math.abs(rung - entry.startWeightKg!) < 1e-9);
        if (!loadable) {
          violations.push({
            code: 'unloadable_weight',
            slot: day.slot,
            exerciseId: exercise.id,
            message: `${nameOf(day)}: ${exercise.name} start weight ${entry.startWeightKg} kg cannot be loaded from your plates.`,
            fix: nearestRung(ladder, entry.startWeightKg)
              ? {
                  kind: 'snap_weight',
                  slot: day.slot,
                  exerciseId: exercise.id,
                  kg: nearestRung(ladder, entry.startWeightKg) as number,
                  label: `Use ${nearestRung(ladder, entry.startWeightKg)} kg`,
                }
              : undefined,
          });
        }
      }
    }

    if (spinalHigh > 1) {
      const stacked = day.exercises
        .map((entry) => exercisesById.get(entry.exerciseId))
        .filter((exercise): exercise is Exercise => exercise?.spinalLoad === 'high');
      const names = stacked.map((exercise) => exercise.name).join(' and ');
      // The later one goes: the first heavy spinal lift of a session is the
      // one it was built around.
      const drop = stacked[stacked.length - 1];
      violations.push({
        code: 'spinal_stacking',
        slot: day.slot,
        message: `${nameOf(day)} stacks ${spinalHigh} heavy spinal-load lifts (${names}). Keep it to one.`,
        fix: drop
          ? { kind: 'remove_exercise', slot: day.slot, exerciseId: drop.id, label: `Drop ${drop.name}` }
          : undefined,
      });
    }

    // time budget, computed from real rest periods
    const budget = template?.minutesBudget ?? context.sessionBudgetMinutes;
    const minutes = sessionMinutes(day.exercises, exercisesById);
    if (minutes > budget) {
      violations.push({
        code: 'over_time_budget',
        slot: day.slot,
        message: `${nameOf(day)} needs ${minutes} min including rest, over the ${budget} min budget. Drop an accessory or cut a set.`,
      });
    }
  }

  // (f) weekly pattern coverage
  const missing = COVERAGE_GROUPS.filter((group) => !covered.has(group));
  if (missing.length > 0) {
    violations.push({
      code: 'pattern_coverage',
      message: `The week never trains: ${missing.join(', ')}. Each of squat, hinge, push, pull and core must appear at least once.`,
    });
  }

  // (g) weekly set total
  const min = Math.round(context.weeklySetTarget * SET_TOTAL_TOLERANCE.low);
  const max = Math.round(context.weeklySetTarget * SET_TOTAL_TOLERANCE.high);
  if (weeklySets < min || weeklySets > max) {
    violations.push({
      code: 'weekly_set_total',
      message: `The week totals ${weeklySets} sets; the target is ${context.weeklySetTarget}, so it must land between ${min} and ${max}.`,
    });
  }

  return violations;
}

/** A helper for the fixes: which single rung to snap to. */
function nearestRung(ladder: number[], value: number): number | undefined {
  if (ladder.length === 0) return undefined;
  return ladder.reduce((best, rung) =>
    Math.abs(rung - value) < Math.abs(best - value) ? rung : best,
  );
}

/** Builds a move fix, or nothing when there is nowhere better to go. */
function moveFix(slot: DaySlot, weekday: Weekday | undefined): Fix | undefined {
  if (weekday === undefined) return undefined;
  return { kind: 'move_to_weekday', slot, weekday, label: `Move to ${WEEKDAY_LABEL[weekday]}` };
}


/** Violations as a block of feedback to hand back to a model on retry. */
export function formatViolationsForModel(violations: Violation[]): string {
  if (violations.length === 0) return '';
  return [
    'The previous response was rejected. Fix every point below and return the whole block again:',
    ...violations.map((violation, i) => `${i + 1}. [${violation.code}] ${violation.message}`),
  ].join('\n');
}

/* --- rationale ------------------------------------------------------------- */



