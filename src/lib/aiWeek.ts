import type { BlockExercise, Exercise } from '../db/types';
import { askModel, type AskResult } from './askModel';
import {
  MAX_SETS,
  MIN_EXERCISES,
  NAME_MAX,
  buildSystem,
  type AiCost,
} from './aiWorkout';
import { desiredRange } from './blockBuilder';
import { workingRepRange, type Violation } from './blockValidation';
import { WORKOUT_FOCUSES, type Intensity, type WorkoutFocus } from './weekTemplate';

/* -------------------------------------------------------------------------- */
/*  A whole week, in one request.                                             */
/*                                                                            */
/*  It used to be one call per day, each one seeing the days before it. That   */
/*  read well and cost four times what it needed to: the exercise library —    */
/*  the bulk of every request — was prefilled once per day, and every day paid */
/*  for its own pass of thinking. Four days took about fifty seconds.          */
/*                                                                            */
/*  One call prefills the library once, thinks once, and sees all the days at  */
/*  the same time, which is better for variety than seeing only the earlier    */
/*  ones. The lifter's wait stops scaling with the size of their week.         */
/*                                                                            */
/*  The generator still never picks a date. It fills a NUMBERED list of slots  */
/*  the app has already decided — "slot 1: heavy lower, slot 2: light upper" — */
/*  and the app maps those numbers back onto dates it chose itself. Nothing in */
/*  here knows what day anything falls on.                                    */
/* -------------------------------------------------------------------------- */

/** One slot the app wants filled, as the model sees it. */
export interface WeekSlotRequest {
  /** 1-based, and the only address the model gets. Never a date. */
  slot: number;
  focus: WorkoutFocus;
  intensity: Intensity;
  /** Prohibitions for this slot, stated without the reason for them. */
  constraints: string[];
}

export interface AiWeekWorkout {
  slot: number;
  name?: string;
  focus: WorkoutFocus;
  intensity: Intensity;
  exercises: Omit<BlockExercise, 'blockId' | 'daySlot'>[];
}

export const WEEK_SYSTEM_SUFFIX = `
You are filling a WEEK this time, not one workout: you will be given a numbered
list of slots, each with the focus and effort the lifter chose for it, and each
with its own constraints. Return one workout per slot, with the same \`slot\`
number you were given.

Every rule above applies to each workout on its own. Two more apply across the
week:

- Do not repeat an exercise between slots unless the library leaves no
  alternative. Seeing all the slots at once is the point: a week that trains
  the same four movements four times is a worse week.
- A slot's constraints bind only that slot. A prohibition on one is not a
  prohibition on the others.

The numbers are positions in a list the lifter already decided. They are not
days, dates or an order to train in, and you are not told which is which.`;

export function buildWeekSystem(exercises: Exercise[]): string {
  // The library last, so the cacheable prefix stays the rules.
  const base = buildSystem(exercises);
  const cut = base.indexOf('\n\nLibrary:');
  if (cut < 0) return `${base}${WEEK_SYSTEM_SUFFIX}`;
  return `${base.slice(0, cut)}${WEEK_SYSTEM_SUFFIX}${base.slice(cut)}`;
}

/*
 * One entry per slot, and nothing the API rejects: no minItems, no maxItems, no
 * numeric bounds. Those all fail the request outright rather than being
 * ignored, and every bound they used to express is enforced in parseWeek.
 */
export const WEEK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['workouts'],
  properties: {
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'name', 'focus', 'intensity', 'exercises'],
        properties: {
          slot: { type: 'integer' },
          name: { type: 'string' },
          focus: { type: 'string', enum: WORKOUT_FOCUSES },
          intensity: { type: 'string', enum: ['heavy', 'light'] },
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
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type WeekParseFailure =
  | { kind: 'not_json' }
  | { kind: 'bad_shape'; detail: string }
  | { kind: 'unknown_exercises'; ids: string[] }
  | { kind: 'missing_slots'; slots: number[] };

export type WeekParseResult =
  | { ok: true; workouts: AiWeekWorkout[] }
  | { ok: false; failure: WeekParseFailure };

/**
 * Reads the reply, clamps everything the schema is not allowed to state, and
 * refuses a week that is short a slot. A missing slot is not something to
 * paper over: the lifter asked for four days and would silently get three.
 */
export function parseWeek(
  raw: string,
  wanted: WeekSlotRequest[],
  exercisesById: Map<string, Exercise>,
): WeekParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, failure: { kind: 'not_json' } };
  }
  if (!isRecord(payload) || !Array.isArray(payload.workouts)) {
    return { ok: false, failure: { kind: 'bad_shape', detail: 'no workouts array' } };
  }

  const unknown: string[] = [];
  const out: AiWeekWorkout[] = [];

  for (const row of payload.workouts) {
    if (!isRecord(row)) continue;
    const slot = Number(row.slot);
    const request = wanted.find((entry) => entry.slot === slot);
    if (!request) continue;

    const seen = new Set<string>();
    const exercises: AiWeekWorkout['exercises'] = [];
    const rows = Array.isArray(row.exercises) ? row.exercises : [];
    for (const item of rows) {
      if (!isRecord(item)) continue;
      const exerciseId = typeof item.exerciseId === 'string' ? item.exerciseId : '';
      const exercise = exercisesById.get(exerciseId);
      if (!exercise) {
        if (exerciseId) unknown.push(exerciseId);
        continue;
      }
      if (seen.has(exerciseId)) continue;
      seen.add(exerciseId);

      const fallback = desiredRange(exercise);
      const low = Number(item.repLow);
      const high = Number(item.repHigh);
      const range = workingRepRange(exercise, {
        low: Number.isFinite(low) ? low : fallback.low,
        high: Number.isFinite(high) ? high : fallback.high,
      });
      const sets = Number(item.sets);
      exercises.push({
        exerciseId,
        targetSets: Number.isFinite(sets) ? Math.min(MAX_SETS, Math.max(1, Math.round(sets))) : 3,
        repRangeLow: range.low,
        repRangeHigh: range.high,
        // The model was asked to order the session; that order is kept.
        order: exercises.length,
      });
    }

    if (exercises.length === 0) continue;

    const trimmed = typeof row.name === 'string' ? row.name.trim() : '';
    out.push({
      slot,
      name: trimmed ? trimmed.slice(0, NAME_MAX) : undefined,
      /* What the lifter ASKED for, not what came back. The focus and effort
         were their choice, so the reply does not get a vote on them. */
      focus: request.focus,
      intensity: request.intensity,
      exercises,
    });
  }

  if (unknown.length > 0) {
    return { ok: false, failure: { kind: 'unknown_exercises', ids: [...new Set(unknown)] } };
  }

  const missing = wanted
    .filter((entry) => !out.some((workout) => workout.slot === entry.slot))
    .map((entry) => entry.slot);
  if (missing.length > 0) return { ok: false, failure: { kind: 'missing_slots', slots: missing } };

  return { ok: true, workouts: out };
}

export function describeWeekFailure(failure: WeekParseFailure): string {
  switch (failure.kind) {
    case 'not_json':
      return 'That was not JSON. Return only the object the schema describes.';
    case 'bad_shape':
      return `The shape was wrong (${failure.detail}). Return a "workouts" array, one entry per slot.`;
    case 'unknown_exercises':
      return `These ids are not in the library: ${failure.ids.join(', ')}. Use only ids you were given, and return every slot again.`;
    case 'missing_slots':
      return `Slots ${failure.slots.join(', ')} are missing. Return one workout for every slot, each with at least ${MIN_EXERCISES} exercises.`;
  }
}

export interface GenerateWeekInput {
  slots: WeekSlotRequest[];
  /** The whole user turn, assembled by the caller as for a single workout. */
  user: string;
  exercises: Exercise[];
  /** Recomputes one proposed workout. Returns only what is still wrong. */
  validate: (workout: AiWeekWorkout) => Violation[];
  maxTokens?: number;
  signal?: AbortSignal;
  ask?: typeof askModel;
}

export type AiWeekOutcome =
  | {
      ok: true;
      workouts: AiWeekWorkout[];
      /**
       * Slots the model never got right. Empty on a clean run.
       *
       * The one-call rewrite nearly lost something the day-by-day version had:
       * when the fourth day failed, the first three were kept. Three good
       * sessions are not worth discarding because the fourth would not pass,
       * so an exhausted run still hands back what was accepted and says which
       * slots are missing.
       */
      shortfall: number[];
      /** Set when shortfall is non-empty: the last thing wrong with them. */
      reason?: string;
      attempts: number;
      transport: AskResult['transport'];
      cost: AiCost;
    }
  | { ok: false; reason: string; attempts: number; cost: AiCost };

/** Bounded exactly as the single-workout path is. */
export const MAX_WEEK_ATTEMPTS = 3;

/**
 * Asks once for the whole week, then asks again about only the slots that
 * failed — a retry that resent the good days would spend the saving it just
 * made.
 */
export async function generateAiWeek(input: GenerateWeekInput): Promise<AiWeekOutcome> {
  const ask = input.ask ?? askModel;
  const byId = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const system = buildWeekSystem(input.exercises);
  const priorTurns: { role: 'assistant' | 'user'; content: string }[] = [];

  const cost: AiCost = {
    ms: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const charge = (result: AskResult) => {
    cost.ms += result.ms ?? 0;
    cost.inputTokens += result.usage?.inputTokens ?? 0;
    cost.outputTokens += result.usage?.outputTokens ?? 0;
    cost.cacheReadTokens += result.usage?.cacheReadTokens ?? 0;
    cost.cacheWriteTokens += result.usage?.cacheWriteTokens ?? 0;
  };

  /** Slots still to get right. Shrinks as workouts pass validation. */
  let outstanding = input.slots;
  const accepted: AiWeekWorkout[] = [];
  let lastReason = 'The model could not produce a week that passes the rules.';
  let lastTransport: AskResult['transport'] = 'none';

  for (let attempt = 1; attempt <= MAX_WEEK_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) {
      return { ok: false, reason: 'Cancelled.', attempts: attempt - 1, cost };
    }

    const result = await ask({
      system,
      user: input.user,
      schema: WEEK_SCHEMA,
      priorTurns,
      maxTokens: input.maxTokens,
      signal: input.signal,
    });
    charge(result);
    if (!result.text) {
      return {
        ok: false,
        reason: result.error ?? 'No answer from the model.',
        attempts: attempt,
        cost,
      };
    }

    const parsed = parseWeek(result.text, outstanding, byId);
    if (!parsed.ok) {
      lastReason = describeWeekFailure(parsed.failure);
      priorTurns.push({ role: 'assistant', content: result.text });
      priorTurns.push({ role: 'user', content: lastReason });
      continue;
    }

    const rejected: string[] = [];
    const stillWanted: WeekSlotRequest[] = [];
    for (const workout of parsed.workouts) {
      const problems = input.validate(workout);
      if (problems.length === 0) {
        accepted.push(workout);
        continue;
      }
      const request = outstanding.find((entry) => entry.slot === workout.slot);
      if (request) stillWanted.push(request);
      rejected.push(
        `Slot ${workout.slot}: ${problems.map((violation) => violation.message).join(' ')}`,
      );
    }

    if (stillWanted.length === 0) {
      return {
        ok: true,
        workouts: accepted.sort((a, b) => a.slot - b.slot),
        shortfall: [],
        attempts: attempt,
        transport: result.transport,
        cost,
      };
    }
    lastTransport = result.transport;

    /* Only the slots that failed go back. Resending the good ones would pay
       again for work already accepted, which is the saving this whole file
       exists for. */
    outstanding = stillWanted;
    lastReason = rejected.join(' ');
    priorTurns.push({ role: 'assistant', content: result.text });
    priorTurns.push({
      role: 'user',
      content: `${rejected.join('\n')}\n\nReturn ONLY slots ${stillWanted
        .map((entry) => entry.slot)
        .join(', ')} again, fixed. Leave the others out.`,
    });
  }

  /* Out of attempts. Whatever passed is still worth having. */
  if (accepted.length > 0) {
    return {
      ok: true,
      workouts: accepted.sort((a, b) => a.slot - b.slot),
      shortfall: outstanding.map((entry) => entry.slot),
      reason: lastReason,
      attempts: MAX_WEEK_ATTEMPTS,
      transport: lastTransport,
      cost,
    };
  }
  return { ok: false, reason: lastReason, attempts: MAX_WEEK_ATTEMPTS, cost };
}
