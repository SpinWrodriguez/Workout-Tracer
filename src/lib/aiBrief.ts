import type { Exercise, MuscleId, SetLog } from '../db/types';
import { MUSCLE_BY_ID } from '../db/seed/muscles';
import { VOLUME_LOW, setsPerMuscle } from './volume';
import type { ExistingWorkout } from './aiWorkout';
import {
  patternsForFocus,
  WORKOUT_FOCUS_LABEL,
  type Intensity,
  type WorkoutFocus,
} from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  What the app knows without being told.                                     */
/*                                                                            */
/*  An empty goal box should still produce a sensible workout: the app already */
/*  knows which muscles are short this week, what the other workouts hold, and */
/*  what the lifter said they are training for. Making the user retype any of  */
/*  that is asking them to do the app's job.                                   */
/*                                                                            */
/*  Nothing here mentions a date, a weekday or golf. Day-derived limits arrive */
/*  as plain constraints — "no high grip work" — never as the reason for them,  */
/*  because a model that knows the reason starts reasoning about the calendar   */
/*  and it has already been caught getting that wrong.                        */
/* -------------------------------------------------------------------------- */

export interface UndertrainedMuscle {
  id: MuscleId;
  name: string;
  sets: number;
}

/**
 * Muscles short of what this week can give them, worst first. Untrained ones
 * come first because zero is the strongest signal there is; the rest are
 * ranked by how far short they fell.
 *
 * The threshold is a fair share of the week's set target, not the evidence
 * floor of 8. Against the floor this list was permanently long — 18 muscles
 * times 8 needs about 53 sets a week and the target is 36 — so it told the
 * generator that everything was short, which is the same as telling it
 * nothing.
 */
export function undertrained(
  logs: SetLog[],
  exercisesById: Map<string, Exercise>,
  threshold: number,
  limit = 6,
): UndertrainedMuscle[] {
  const volume = setsPerMuscle(logs, exercisesById);
  return (Object.keys(volume) as MuscleId[])
    .map((id) => ({ id, name: MUSCLE_BY_ID[id]?.name ?? id, sets: volume[id] ?? 0 }))
    .filter((row) => row.sets < threshold)
    .sort((a, b) => a.sets - b.sets || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** A limit the day imposes, stated without the reason for it. */
export interface DayConstraints {
  /** True where the golf rule bars grip, lat and forearm work. */
  noHighGrip?: boolean;
  /** True on a light day: nothing that loads the spine heavily. */
  noHighSpinal?: boolean;
  intensity?: Intensity;
  /**
   * What the day was asked to train, when the lifter chose it rather than
   * leaving it open. Stated as a requirement — still with no reason attached,
   * because the reason is a calendar the model has been caught misreading.
   */
  focus?: WorkoutFocus;
}

export interface BriefInput {
  /** The share of the week's target each muscle can expect — see fairShare. */
  share?: number;
  /** What the lifter typed. Empty is normal and expected. */
  goal?: string;
  /** Standing instructions from Settings. */
  instructions?: string;
  undertrained: UndertrainedMuscle[];
  existing: ExistingWorkout[];
  constraints?: DayConstraints;
}

export interface Brief {
  /** The goal to send, the lifter's words or one derived from what we know. */
  goal: string;
  /** True when nothing was typed, so the UI can say what it decided and why. */
  derived: boolean;
  /** One line for the UI: what this workout was aimed at. */
  summary: string;
}

/**
 * Builds the goal. A typed goal is used as-is and never second-guessed — if the
 * lifter says "easy today" that is the instruction, not a hint to weigh against
 * volume numbers.
 *
 * With nothing typed, the shortfall in the week becomes the goal. That is the
 * one thing the app can say with authority and the lifter would otherwise have
 * to work out by reading the Levels screen and retyping it.
 */
export function buildBrief(input: BriefInput): Brief {
  const typed = input.goal?.trim() ?? '';
  if (typed) {
    return { goal: typed, derived: false, summary: typed };
  }

  const short = input.undertrained;
  if (short.length === 0) {
    return {
      goal: 'A balanced session that complements the other workouts in the block.',
      derived: true,
      summary: 'Balanced — nothing is short this week.',
    };
  }

  const untouched = short.filter((row) => row.sets === 0).map((row) => row.name);
  const light = short.filter((row) => row.sets > 0);
  const parts: string[] = [];
  if (untouched.length > 0) parts.push(`${untouched.join(', ')} (nothing yet this week)`);
  for (const row of light) parts.push(`${row.name} (${row.sets} sets)`);

  return {
    goal:
      `Bring up what is short this week: ${parts.join('; ')}. ` +
      'Pick the movements that cover those best without repeating the other workouts.',
    derived: true,
    summary: `Aimed at ${short.slice(0, 3).map((row) => row.name).join(', ')}`,
  };
}

/**
 * The payload the model sees. Constraints are expressed as prohibitions with no
 * justification attached, so nothing here lets it infer the calendar.
 */
export function briefPayload(brief: Brief, input: BriefInput): Record<string, unknown> {
  const constraints: string[] = [];
  if (input.constraints?.noHighGrip) {
    constraints.push('Do not use any exercise with gripLoad "high".');
  }
  if (input.constraints?.noHighSpinal) {
    constraints.push('Do not use any exercise with spinalLoad "high".');
  }
  if (input.constraints?.intensity === 'light') {
    constraints.push('This is a light session: two working sets an exercise, higher reps.');
  }
  if (input.constraints?.intensity === 'heavy') {
    constraints.push('This is a heavy session: three working sets an exercise.');
  }
  if (input.constraints?.focus) {
    const focus = input.constraints.focus;
    /*
     * Named AND spelled out as patterns. The label alone leaves "Pull" to
     * interpretation; the patterns are a field the model can see on every
     * library row, so the requirement is checkable against what it picked.
     */
    constraints.push(
      `This session must train ${WORKOUT_FOCUS_LABEL[focus]}. ` +
        `Every exercise must have a pattern from: ${patternsForFocus(focus).join(', ')}.`,
    );
    constraints.push(`Return focus "${focus}".`);
  }

  return {
    goal: brief.goal,
    ...(input.instructions?.trim() ? { standingInstructions: input.instructions.trim() } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(brief.derived && input.undertrained.length > 0
      ? {
          weeklyShortfall: input.undertrained.map((row) => ({
            muscle: row.name,
            setsThisWeek: row.sets,
            /* What this week can give it, not the evidence floor: a target the
               week cannot reach is not a shortfall the generator can fix. */
            fairShareThisWeek: input.share ?? VOLUME_LOW,
          })),
        }
      : {}),
    existingWorkouts: input.existing.map((workout) => ({
      name: workout.name,
      focus: workout.focus,
      intensity: workout.intensity,
      exerciseIds: workout.exerciseIds,
    })),
  };
}
