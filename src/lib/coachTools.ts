/* -------------------------------------------------------------------------- */
/*  What the coach can look up for itself.                                    */
/*                                                                            */
/*  The exercise library is 73 rows and about 6,200 tokens. Sending it with    */
/*  every question would cost more than the question and would still be the    */
/*  wrong shape: most questions need one exercise, not all of them.           */
/*                                                                            */
/*  So it is not sent. The model asks, and these run on the device against     */
/*  the same IndexedDB every screen reads. Nothing goes to a server for this:  */
/*  the library and the logs are already here, and a copy in Supabase would    */
/*  be a second thing to keep in step for no gain.                            */
/*                                                                            */
/*  Every tool is read-only. A model cannot log a set, move a workout or       */
/*  change a weight — the worst a wrong tool call can do is describe           */
/*  something that is not there.                                              */
/* -------------------------------------------------------------------------- */

import { db } from '../db/db';
import { MUSCLE_BY_ID } from '../db/seed/muscles';
import type { Exercise, MovementPattern, MuscleId, SetLog } from '../db/types';
import { effectiveKg } from './load';
import { estimate1RM } from './stats';
import { isTimed } from './repUnit';

/*
 * The patterns, listed here rather than imported: this is the enum the model
 * is offered, and it has to be exactly the set stored on an exercise. Typed as
 * MovementPattern[] so adding a pattern to the type fails the build here
 * instead of silently narrowing what the coach can search for.
 */
const PATTERNS: MovementPattern[] = [
  'squat',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'carry',
  'core',
  'rotation',
];

/** Rows one search may return. Enough to choose from, not enough to be a dump. */
const SEARCH_LIMIT = 12;
/** Sessions one history call may return. */
const HISTORY_LIMIT = 8;

/*
 * Tool definitions, wire-shaped.
 *
 * Kept deliberately plain: `name`, `description`, `input_schema` and nothing
 * else. The last unknown key sent to this API — a `name` inside
 * `output_config.format` — was rejected outright rather than ignored, and 438
 * green tests could not see it because they all stub the transport.
 */
export const COACH_TOOLS: unknown[] = [
  {
    name: 'search_exercises',
    description:
      'Find exercises in the lifter\'s own library by name, movement pattern or muscle. ' +
      'The library is only what their garage gym can actually do, so anything not ' +
      'returned here is not available to them. Returns at most ' +
      `${SEARCH_LIMIT} rows.`,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of an exercise name.' },
        pattern: {
          type: 'string',
          enum: PATTERNS,
          description: 'Movement pattern to filter to.',
        },
        muscle: { type: 'string', description: 'Muscle id, e.g. quads, lats, chest.' },
      },
    },
  },
  {
    name: 'exercise_detail',
    description:
      'Everything the app knows about one exercise: how it is loaded, what it trains, ' +
      'its rep or time range, and its grip and spinal load. Use it before advising on ' +
      'an exercise rather than assuming a standard version of it.',
    input_schema: {
      type: 'object',
      properties: { exerciseId: { type: 'string' } },
      required: ['exerciseId'],
    },
  },
  {
    name: 'exercise_history',
    description:
      'The lifter\'s logged sessions for one exercise, most recent first: date, sets ' +
      'done, the top set, and an estimated one-rep max from it. Use this for any claim ' +
      'about whether a lift is moving — never guess a trend.',
    input_schema: {
      type: 'object',
      properties: {
        exerciseId: { type: 'string' },
        sessions: {
          type: 'integer',
          description: `How many recent sessions to return, up to ${HISTORY_LIMIT}.`,
        },
      },
      required: ['exerciseId'],
    },
  },
];

export const COACH_TOOL_NAMES = ['search_exercises', 'exercise_detail', 'exercise_history'];

const muscleName = (id: MuscleId): string => MUSCLE_BY_ID[id]?.name ?? id;

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

/* --- the tools ------------------------------------------------------------ */

function searchExercises(exercises: Exercise[], input: unknown): unknown {
  const args = asRecord(input);
  const query = asText(args.query);
  const pattern = asText(args.pattern);
  const muscle = asText(args.muscle);

  const matches = exercises.filter((exercise) => {
    if (query && !exercise.name.toLowerCase().includes(query)) return false;
    if (pattern && exercise.pattern !== pattern) return false;
    if (muscle) {
      const muscles = [...exercise.primaryMuscles, ...exercise.secondaryMuscles];
      // Matched on the id and the readable name, because a model asking for a
      // muscle will as happily say "lower back" as "lower_back".
      const hit = muscles.some(
        (id) => id === muscle || muscleName(id).toLowerCase() === muscle,
      );
      if (!hit) return false;
    }
    return true;
  });

  return {
    found: matches.length,
    returned: Math.min(matches.length, SEARCH_LIMIT),
    exercises: matches.slice(0, SEARCH_LIMIT).map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      station: exercise.station,
      pattern: exercise.pattern,
      trains: exercise.primaryMuscles.map(muscleName),
    })),
  };
}

function exerciseDetail(exercises: Exercise[], input: unknown): unknown {
  const id = asRecord(input).exerciseId;
  const exercise = exercises.find((row) => row.id === id);
  if (!exercise) return { error: `No exercise with id ${String(id)}.` };
  return {
    id: exercise.id,
    name: exercise.name,
    station: exercise.station,
    attachment: exercise.attachment,
    pattern: exercise.pattern,
    primary: exercise.primaryMuscles.map(muscleName),
    secondary: exercise.secondaryMuscles.map(muscleName),
    // Seconds for a hold or a carry, reps for everything else. Printing reps
    // against a plank is wrong in the prescription and wrong here.
    unit: isTimed(exercise) ? 'seconds' : 'reps',
    range: [exercise.repMin, exercise.repMax],
    restSeconds: exercise.restSeconds,
    loadMode: exercise.loadMode,
    barWeightKg: exercise.barWeight,
    loadMultiplier: exercise.loadMultiplier,
    gripLoad: exercise.gripLoad,
    spinalLoad: exercise.spinalLoad,
    skill: exercise.skillLevel,
    isHinge: exercise.isHinge,
    isExplosive: exercise.isExplosive,
    isMobility: exercise.isMobility,
  };
}

/** The heaviest working set of a session, by what it actually loaded. */
function topSetOf(sets: SetLog[], exercise: Exercise) {
  let best: { set: SetLog; kg?: number } | undefined;
  for (const set of sets) {
    const kg = effectiveKg(exercise, set.weightKg) ?? set.effectiveKg;
    if (!best) best = { set, kg };
    else if ((kg ?? 0) > (best.kg ?? 0)) best = { set, kg };
    else if ((kg ?? 0) === (best.kg ?? 0) && set.reps > best.set.reps) best = { set, kg };
  }
  return best;
}

async function exerciseHistory(exercises: Exercise[], input: unknown): Promise<unknown> {
  const args = asRecord(input);
  const id = args.exerciseId;
  const exercise = exercises.find((row) => row.id === id);
  if (!exercise || typeof id !== 'string') {
    return { error: `No exercise with id ${String(id)}.` };
  }
  const asked = Number(args.sessions);
  const wanted = Number.isFinite(asked) && asked > 0 ? Math.min(asked, HISTORY_LIMIT) : 5;

  const sets = await db.setLog.where('exerciseId').equals(id).toArray();
  if (sets.length === 0) return { exerciseId: id, name: exercise.name, sessions: [] };

  const bySession = new Map<string, SetLog[]>();
  for (const set of sets) {
    const rows = bySession.get(set.sessionId);
    if (rows) rows.push(set);
    else bySession.set(set.sessionId, [set]);
  }

  const sessions = await db.session.bulkGet([...bySession.keys()]);
  const dated = sessions
    .map((session, index) => ({ session, id: [...bySession.keys()][index] }))
    .filter((row) => row.session !== undefined)
    .sort((a, b) => (b.session?.date ?? '').localeCompare(a.session?.date ?? ''))
    .slice(0, wanted);

  return {
    exerciseId: id,
    name: exercise.name,
    unit: isTimed(exercise) ? 'seconds' : 'reps',
    sessions: dated.map((row) => {
      const rows = bySession.get(row.id ?? '') ?? [];
      const top = topSetOf(rows, exercise);
      const kg = top?.kg;
      return {
        date: row.session?.date,
        workout: row.session?.daySlotName,
        setsDone: rows.length,
        /* The top set as loaded and as it counts. A single cable pulley moves
           half the stack, so the two are not the same number and comparing
           the wrong one across stations is how a "PR" appears from nothing. */
        topSet: top
          ? {
              weightKg: top.set.weightKg,
              effectiveKg: kg,
              reps: top.set.reps,
              rir: top.set.rir,
              estimated1RM: kg !== undefined ? Math.round(estimate1RM(kg, top.set.reps)) : undefined,
            }
          : undefined,
      };
    }),
  };
}

/* --- the seam the loop calls ---------------------------------------------- */

export interface ToolOutcome {
  /** JSON for the tool_result block. Always a string, never a thrown error. */
  content: string;
  isError: boolean;
}

/**
 * Runs one tool call. Never throws: a failed tool has to come back as a result
 * the model can read and work around, because the alternative is a conversation
 * that dies halfway with the user watching a spinner.
 */
export async function runCoachTool(
  name: string,
  input: unknown,
  exercises: Exercise[],
): Promise<ToolOutcome> {
  try {
    if (name === 'search_exercises') {
      return { content: JSON.stringify(searchExercises(exercises, input)), isError: false };
    }
    if (name === 'exercise_detail') {
      return { content: JSON.stringify(exerciseDetail(exercises, input)), isError: false };
    }
    if (name === 'exercise_history') {
      return { content: JSON.stringify(await exerciseHistory(exercises, input)), isError: false };
    }
    return { content: JSON.stringify({ error: `No tool named ${name}.` }), isError: true };
  } catch (cause) {
    return {
      content: JSON.stringify({
        error: cause instanceof Error ? cause.message : String(cause),
      }),
      isError: true,
    };
  }
}
