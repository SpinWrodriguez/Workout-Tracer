import type { BlockExercise, DaySlot, Exercise, MovementPattern } from '../db/types';
import {
  MAX_VALIDATION_ATTEMPTS,
  desiredRange,
} from './blockBuilder';
import {
  formatViolationsForModel,
  severityOf,
  workingRepRange,
  type Violation,
} from './blockValidation';
import {
  WORKOUT_FOCUSES,
  templateDayFor,
  workoutTemplate,
  type Intensity,
  type WorkoutFocus,
} from './weekTemplate';
import type { Weekday } from './golf';
import { askModel, type AskResult } from './askModel';

/* -------------------------------------------------------------------------- */
/*  AI workout generation — the selector, never the scheduler.                */
/*                                                                            */
/*  The model is handed the library, what the block already holds, and a goal  */
/*  in plain words. It returns exercise ids, sets and reps for ONE workout.    */
/*                                                                            */
/*  It is never told which weekday the workout falls on, and the output schema */
/*  has no field in which to express one — so it cannot put a deadlift the day */
/*  before a round. Placement stays a separate act on the calendar, exactly as */
/*  it is for a workout made by hand.                                         */
/*                                                                            */
/*  Everything it returns is a proposal. Ids are checked against the table,    */
/*  rep ranges are clamped per exercise, weights never come from it at all,    */
/*  and the caller runs validateBlock over the result before anything is       */
/*  written. Nothing self-reports compliance.                                  */
/* -------------------------------------------------------------------------- */

export interface AiWorkout {
  name?: string;
  focus: WorkoutFocus;
  intensity: Intensity;
  why?: string;
  exercises: BlockExercise[];
}

/* --- what the model is shown ---------------------------------------------- */

/**
 * One library row, trimmed to what choosing needs. loadMultiplier, barWeight,
 * attachment and freeDbId do not inform which exercise to pick; restSeconds is
 * left out on purpose, so the model is not tempted to compute a time budget the
 * app computes itself.
 */
interface LibraryRow {
  id: string;
  name: string;
  pattern: MovementPattern;
  primary: string[];
  secondary: string[];
  station: string;
  gripLoad: string;
  spinalLoad: string;
  isHinge: boolean;
  isExplosive: boolean;
  skill: string;
  /** This exercise's own bounds. A Turkish get-up is 1-5; a plank is seconds. */
  reps: [number, number];
  unit: 'reps' | 'seconds';
}

export function libraryFor(exercises: Exercise[]): LibraryRow[] {
  return exercises
    // Warm-up movement is never a programmed working set, so offering it only
    // invites a violation.
    .filter((exercise) => !exercise.isMobility)
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      pattern: exercise.pattern,
      primary: exercise.primaryMuscles,
      secondary: exercise.secondaryMuscles,
      station: exercise.station,
      gripLoad: exercise.gripLoad,
      spinalLoad: exercise.spinalLoad,
      isHinge: exercise.isHinge,
      isExplosive: exercise.isExplosive,
      skill: exercise.skillLevel,
      reps: [exercise.repMin, exercise.repMax] as [number, number],
      unit: exercise.repUnit ?? 'reps',
    }));
}

export interface ExistingWorkout {
  slot: DaySlot;
  name?: string;
  focus?: WorkoutFocus;
  intensity: Intensity;
  exerciseIds: string[];
}

export const SYSTEM_PROMPT = `You choose exercises for one workout in a home gym, from a fixed list.

The gym is a Cortex SM-26 multi-gym, an Olympic barbell, a few kettlebells and bands, in a garage. The lifter is a returning intermediate training two, at best three times a week around weekend golf. Sessions are about 40 minutes.

You will be given the complete exercise library, the workouts already in the current block, and a goal. Return one workout.

The goal may be the lifter's own words, or a summary the app derived from which muscles are short this week — treat both the same way. You may also be given \`standingInstructions\`, which is what the lifter has said they are training for in general, and \`constraints\`, which are absolute: an exercise a constraint rules out is not available, whatever the goal says.

Rules:

- Use only \`id\` values from the library. Never invent an exercise, a name, or an id. An id that is not in the library fails the whole response.
- Respect each exercise's own \`reps\` bounds and \`unit\`. A hold measured in seconds is not a number of reps.
- Do not repeat what the other workouts in the block already contain, unless the goal explicitly asks for it.
- Read the goal for effort and emphasis and set \`focus\` and \`intensity\` from it. "Tired", "easy", "gentle" mean \`intensity: "light"\`. Trust the words: a request for an easy session is not an invitation to program a hard one differently.
- Obey every entry in \`constraints\` exactly. They are not preferences.
- Where \`standingInstructions\` and the goal disagree, the goal wins — it is about today, the instructions are about the months around it.
- Order the exercises the way they should be performed. Explosive work first, then hinges while the position still holds, then everything else. A hinge late in a fatigued session is a form risk.
- Two exercises with \`spinalLoad: "high"\` in one workout is a mistake.
- \`name\` is what the lifter sees on the workout card. Name it after what it
  trains, in two or three words, title case — "Upper Push", "Lower Body + Core",
  "Back and Biceps". No day names, no week numbers, no emoji, no effort words:
  the app already shows the day and the effort beside it.

Say nothing about the calendar. You are not told which day this workout falls on, how far it is from a round, or what else is scheduled that week, and any statement you make about spacing, rest days, recovery or being clear of anything will be wrong and will be discarded. The \`why\` field is for why these exercises suit this goal — nothing else.

Your answer is a proposal. Every id, rep range, set count and weight is recomputed against the real inventory and the real calendar before anything is shown. If a rule is broken you will be given the specific violations and asked to return the whole workout again.`;

export function buildSystem(exercises: Exercise[]): string {
  return `${SYSTEM_PROMPT}\n\nLibrary:\n${JSON.stringify(libraryFor(exercises))}`;
}

export function buildUser(goal: string, existing: ExistingWorkout[]): string {
  return JSON.stringify({
    goal: goal.trim(),
    existingWorkouts: existing.map((workout) => ({
      name: workout.name,
      focus: workout.focus,
      intensity: workout.intensity,
      exerciseIds: workout.exerciseIds,
    })),
  });
}

/* --- the contract --------------------------------------------------------- */

/*
 * Constrained with structured outputs rather than a "reply with JSON only"
 * instruction, so the shape is guaranteed by the API and the prompt does not
 * have to spend a paragraph asking for it.
 *
 * There is no weekday, date or slot field. The model cannot express a
 * placement, so it cannot get one wrong.
 *
 * There is no weight field either: asking a model for a weight invites
 * unloadable_weight violations when the app already knows every weight the
 * plates can make.
 */
/*
 * Structured outputs accept a SUBSET of JSON Schema, and the rejected keywords
 * fail the whole request with a 400 before the model ever runs. Out: string
 * constraints (minLength/maxLength), numeric constraints (minimum/maximum),
 * and array-length constraints (minItems/maxItems). In: the basic types, enum,
 * const, anyOf/allOf, $ref, the named string formats, and
 * additionalProperties: false — which is REQUIRED on every object here.
 *
 * The Python and TypeScript SDKs strip the unsupported ones for you and check
 * them client-side. This app builds the request by hand so the key can stay in
 * an Edge Function, so nothing stripped them and every call 400'd. Nothing
 * caught it either: the suites stub the transport, so a schema the real API
 * refuses looks identical to one it accepts. schemaIsSupported() in
 * aiWorkout.test.ts is the guard that would have.
 *
 * Every bound those keywords used to express is enforced in parseWorkout
 * instead, which is where it belonged anyway — a schema cannot say that a
 * plank is measured in seconds or that a get-up is 1-5 reps.
 */
export const WORKOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'focus', 'intensity', 'why', 'exercises'],
  properties: {
    name: { type: 'string' },
    /* `type` alongside `enum`, which every documented example pairs. Bare
       `enum` is probably fine, but this schema has already been refused once
       and a round trip to find out costs a day. */
    focus: { type: 'string', enum: WORKOUT_FOCUSES },
    intensity: { type: 'string', enum: ['heavy', 'light'] },
    why: { type: 'string' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['exerciseId', 'sets', 'repLow', 'repHigh'],
        properties: {
          exerciseId: { type: 'string' },
          sets: { type: 'integer' },
          repLow: { type: 'integer' },
          repHigh: { type: 'integer' },
        },
      },
    },
  },
} as const;

/** What the schema used to say, now enforced where it can actually be checked. */
export const NAME_MAX = 40;
export const MIN_EXERCISES = 3;
export const MAX_EXERCISES = 7;
export const MAX_SETS = 5;

export const SCHEMA_NAME = 'workout';

/* --- reading the reply ---------------------------------------------------- */

export type ParseFailure =
  | { kind: 'not_json' }
  | { kind: 'bad_shape'; detail: string }
  | { kind: 'unknown_exercises'; ids: string[] };

export type ParseResult =
  | { ok: true; workout: AiWorkout }
  | { ok: false; failure: ParseFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns a reply into BlockExercise rows, or says why it cannot.
 *
 * Structured outputs make the shape reliable, not guaranteed-correct: an
 * exercise id is a string either way, and only the curated table knows whether
 * it names anything. Unknown ids reject the whole reply rather than being
 * dropped — a workout quietly two exercises short is worse than a retry.
 */
export function parseWorkout(
  raw: string,
  blockId: string,
  slot: DaySlot,
  exercisesById: Map<string, Exercise>,
): ParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, failure: { kind: 'not_json' } };
  }
  if (!isRecord(payload)) return { ok: false, failure: { kind: 'bad_shape', detail: 'not an object' } };

  const focus = WORKOUT_FOCUSES.includes(payload.focus as WorkoutFocus)
    ? (payload.focus as WorkoutFocus)
    : undefined;
  if (!focus) return { ok: false, failure: { kind: 'bad_shape', detail: 'unknown focus' } };
  const intensity: Intensity = payload.intensity === 'light' ? 'light' : 'heavy';

  const rows = Array.isArray(payload.exercises) ? payload.exercises : undefined;
  if (!rows || rows.length === 0) {
    return { ok: false, failure: { kind: 'bad_shape', detail: 'no exercises' } };
  }

  const unknown: string[] = [];
  const exercises: BlockExercise[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    if (!isRecord(row)) return;
    const exerciseId = typeof row.exerciseId === 'string' ? row.exerciseId : '';
    const exercise = exercisesById.get(exerciseId);
    if (!exercise) {
      if (exerciseId) unknown.push(exerciseId);
      return;
    }
    // A repeated id would collide on the compound key and silently drop a row.
    if (seen.has(exerciseId)) return;
    seen.add(exerciseId);

    const fallback = desiredRange(exercise);
    const low = Number(row.repLow);
    const high = Number(row.repHigh);
    const range = workingRepRange(exercise, {
      low: Number.isFinite(low) ? low : fallback.low,
      high: Number.isFinite(high) ? high : fallback.high,
    });
    const sets = Number(row.sets);

    exercises.push({
      blockId,
      exerciseId,
      daySlot: slot,
      targetSets: Number.isFinite(sets) ? Math.min(MAX_SETS, Math.max(1, Math.round(sets))) : 3,
      repRangeLow: range.low,
      repRangeHigh: range.high,
      // The model's ordering is preserved: it was asked to order the session.
      order: exercises.length,
    });
  });

  if (unknown.length > 0) return { ok: false, failure: { kind: 'unknown_exercises', ids: unknown } };
  if (exercises.length === 0) {
    return { ok: false, failure: { kind: 'bad_shape', detail: 'no usable exercises' } };
  }

  /* Clamped here because the schema is not allowed to say it. A 40-character
     cap is a fact about the card it appears on, not about the model. */
  const trimmedName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const name = trimmedName ? trimmedName.slice(0, NAME_MAX) : undefined;
  const why = typeof payload.why === 'string' && payload.why.trim() ? payload.why.trim() : undefined;
  return { ok: true, workout: { name, focus, intensity, why, exercises } };
}

/** The retry text for a reply that could not even be read. */
export function describeParseFailure(failure: ParseFailure): string {
  switch (failure.kind) {
    case 'not_json':
      return 'The previous response was not valid JSON. Return the whole workout again.';
    case 'unknown_exercises':
      return `The previous response was rejected: ${failure.ids.join(', ')} ${
        failure.ids.length === 1 ? 'is not an id' : 'are not ids'
      } in the library. Use only ids from the library and return the whole workout again.`;
    default:
      return `The previous response was rejected (${failure.detail}). Return the whole workout again.`;
  }
}

/* --- the loop ------------------------------------------------------------- */

export interface GenerateAiWorkoutInput {
  blockId: string;
  slot: DaySlot;
  /**
   * The whole user turn, already assembled — goal, standing instructions,
   * constraints and what the block holds. Built by aiBrief so the app can fill
   * in for an empty goal box without this module knowing about volume.
   */
  user: string;
  exercises: Exercise[];
  minutesPerSession?: number;
  /** Recomputes the proposal. Returns only what is still wrong with it. */
  validate: (workout: AiWorkout) => Violation[];
  signal?: AbortSignal;
  ask?: typeof askModel;
}

export type AiOutcome =
  | { ok: true; workout: AiWorkout; attempts: number; transport: AskResult['transport'] }
  | { ok: false; reason: string; attempts: number; violations?: Violation[] };

/**
 * Asks, validates, and asks again with the violations. Bounded by the same
 * MAX_VALIDATION_ATTEMPTS the deterministic path uses.
 *
 * Only problems trigger a retry. Retrying on a suggestion — a session running
 * seven minutes long — spends money and latency on something the lifter is
 * allowed to overrule anyway.
 */
export async function generateAiWorkout(input: GenerateAiWorkoutInput): Promise<AiOutcome> {
  const ask = input.ask ?? askModel;
  const byId = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const system = buildSystem(input.exercises);
  const user = input.user;
  const priorTurns: { role: 'assistant' | 'user'; content: string }[] = [];

  let lastViolations: Violation[] | undefined;

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) return { ok: false, reason: 'Cancelled.', attempts: attempt - 1 };

    const result = await ask({
      system,
      user,
      schema: WORKOUT_SCHEMA,
      priorTurns,
      signal: input.signal,
    });
    if (!result.text) {
      return { ok: false, reason: result.error ?? 'No answer from the model.', attempts: attempt };
    }

    const parsed = parseWorkout(result.text, input.blockId, input.slot, byId);
    if (!parsed.ok) {
      priorTurns.push({ role: 'assistant', content: result.text });
      priorTurns.push({ role: 'user', content: describeParseFailure(parsed.failure) });
      continue;
    }

    const problems = input.validate(parsed.workout).filter((v) => severityOf(v.code) === 'problem');
    if (problems.length === 0) {
      return { ok: true, workout: parsed.workout, attempts: attempt, transport: result.transport };
    }

    lastViolations = problems;
    priorTurns.push({ role: 'assistant', content: result.text });
    priorTurns.push({ role: 'user', content: formatViolationsForModel(problems) });
  }

  return {
    ok: false,
    reason: `The model could not produce a workout that passes the rules in ${MAX_VALIDATION_ATTEMPTS} attempts.`,
    attempts: MAX_VALIDATION_ATTEMPTS,
    violations: lastViolations,
  };
}

/**
 * The template the app derives from what the model asked for.
 *
 * `weekday` matters more than it looks. workoutTemplate is for a workout with
 * no day, so its weekday is a placeholder — Monday — and every date-dependent
 * rule checked against it is then a rule about Monday. Validating a workout
 * asked for on a Thursday against that placeholder passed a lat pulldown two
 * days before a round, which is the exact thing this app exists to prevent.
 *
 * So: given a real weekday, build the placed template and let the golf
 * calendar decide what is excluded. Given none, the unplaced one is correct —
 * there is no date to be clear of yet.
 */
export function templateForAiWorkout(
  workout: AiWorkout,
  slot: DaySlot,
  minutesPerSession = 40,
  placed?: { weekday: Weekday; golfWeekdays: Weekday[] },
) {
  if (placed) {
    return templateDayFor({
      slot,
      weekday: placed.weekday,
      intensity: workout.intensity,
      focus: workout.focus,
      minutesPerSession,
      golfWeekdays: placed.golfWeekdays,
    });
  }
  return workoutTemplate({
    slot,
    focus: workout.focus,
    intensity: workout.intensity,
    minutesPerSession,
  });
}
