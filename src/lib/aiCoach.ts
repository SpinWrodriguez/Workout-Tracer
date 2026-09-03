/* -------------------------------------------------------------------------- */
/*  The coach: a question about your own training, answered from your data.    */
/*                                                                            */
/*  What it is sent, every time, is small and fixed: the training settings,    */
/*  this week's workouts, the last few sessions, and the muscles that are      */
/*  short. About six hundred tokens. Everything else it has to ask for, and    */
/*  the asking is answered on the device by coachTools.ts.                    */
/*                                                                            */
/*  Two rules make it trustworthy rather than plausible:                       */
/*   1. Numbers come from the context or a tool result. The prompt says so,    */
/*      and the context is computed by the same functions the screens use, so  */
/*      a figure it repeats is a figure the app itself would show.            */
/*   2. It cannot change anything. Every tool is read-only.                    */
/*                                                                            */
/*  It is not a generator. Building a workout is a constrained selection with  */
/*  a validator behind it, and that lives in aiWorkout.ts — a chat that        */
/*  quietly wrote workouts would bypass every rule that file enforces.        */
/* -------------------------------------------------------------------------- */

import { db } from '../db/db';
import { MUSCLE_BY_ID } from '../db/seed/muscles';
import type { Exercise, MuscleId, SetLog } from '../db/types';
import { readAiInstructions, readTraining } from '../db/settings';
import { streamConversation, type AskUsage } from './askModel';
import { COACH_TOOLS, runCoachTool } from './coachTools';
import { shiftIso, todayIso, weekStart } from './format';
import { WEEKDAY_LABEL, weekdayOf } from './golf';
import { fairShare, setsPerMuscle } from './volume';
import { readWeekPlan } from './weekPlan';
import { dayLabel } from './dayLabel';

/**
 * How many times it may stop to look something up before answering.
 *
 * Each round is a whole round trip, so this is the latency dial as much as the
 * cost one: three is enough for "find the exercise, read its history, answer"
 * and not enough to sit exploring the library while the user waits.
 */
export const MAX_TOOL_ROUNDS = 3;

const SYSTEM = `You are the training assistant inside a personal workout app. One user: a lifter with a garage gym who plays golf at the weekend. Answer questions about their training — both what their data says and how to train.

Their exercise library is NOT in this prompt. It is 73 exercises specific to their garage, and you look them up with the tools. Anything a search does not return, they cannot do — never suggest an exercise you have not seen in a tool result, and never assume a machine or a barbell variation exists.

There are two kinds of claim and the difference between them is the most important thing here.

1. Anything about THEIR training — a weight, a total, a trend, what they did or skipped — comes from the context below or from a tool result. Never estimate one. Before saying whether a lift is moving, call exercise_history for it: "your squat has stalled" without the history behind it is the one thing you must not do.
2. General training knowledge is yours to give, with real numbers. How many weekly sets a muscle needs, sensible rep ranges, how to order a session, when to deload, what soreness means, how to prioritise one muscle without wrecking recovery. Say plainly that a figure is the usual guidance rather than something read from their log, and give it anyway. Declining to answer a training question because the app does not store a rule for it is the wrong answer: general knowledge is the one thing they cannot look up in their own data, and it is most of why they are asking you.

Work out which kind they are asking for. "Is my squat moving" is the first. "How many sets does a muscle need" is the second. "Am I doing enough for calves" is both, and the good answer is the general figure and then their number against it. When you are not sure, answer both ways — the general read and what their data shows — rather than asking them to narrow it down.

Then:

- Rest days, soreness and golf are theirs to judge. Give them the read and a recommendation, not a lecture.
- Weights are kilograms. Holds and carries are timed in seconds, not reps — exercise_detail says which an exercise is.
- Do not write out a whole workout set by set: the app generates those with a validator behind it, and the Program screen is where that happens. Everything short of that is yours to answer — what to add, what to drop, what to change and why.
- Never use the Program screen, or anything else in the app, as a reason not to answer. If a question has an answer you know, give it.

The app's own numbers, so you never have to guess where one came from:

- weeklySetTarget is a whole-week total of working sets across all muscles. The lifter sets it themselves with a stepper in Settings, in steps of 3. Nothing derives it from their recovery, their history or their goals. The generator builds weeks within 20% of it, and the validator rejects a week outside that band.
- musclesUnderTheirShare is measured against fairSharePerMuscle, which is the weekly set target spread evenly over the 18 muscles — the share the week they asked for can actually give each one. A set counts 1 for each muscle it trains directly and 0.5 for each it trains indirectly. The training floor from the literature is 8 weighted sets a week per muscle and the ceiling is 20; clearing 8 on every muscle takes far more sets than a three-day week has, so the share is what a list of shortfalls is measured against and the floor is what to aim a priority muscle at. Say which of the two you mean.
- Never explain one of the app's numbers by inventing how it was worked out. Say what it means and where it is set. Guessing at a derivation is the same mistake as guessing at a weight.

Answering:

- Lead with the answer. If the data disagrees with the premise of the question, say so first.
- Two to five sentences for a straight question. Up to eight when they asked why, or when the honest answer is a general figure and then their numbers against it. Never pad to fill the space.
- Plain sentences, no headings and no bold. A short list is fine when the answer genuinely is a list of numbers — a range per muscle, say — because that reads better on a phone than the same thing in a paragraph.`;

/* --- the context ---------------------------------------------------------- */

/** A stored weekday number as a name, without asserting it is in range. */
const weekdayName = (day: number): string =>
  WEEKDAY_LABEL[day as keyof typeof WEEKDAY_LABEL] ?? String(day);

export interface CoachContext {
  /** Rendered for the prompt, and shown in the sheet so the user can see it. */
  payload: Record<string, unknown>;
}

/** A short, dated view of one logged session. */
async function recentSessions(limit: number) {
  const sessions = await db.session.orderBy('date').reverse().limit(limit).toArray();
  const rows = [];
  for (const session of sessions) {
    const sets = await db.setLog.where('sessionId').equals(session.id).toArray();
    const planned = Object.values(session.plannedSets ?? {}).reduce((sum, n) => sum + n, 0);
    rows.push({
      date: session.date,
      weekday: WEEKDAY_LABEL[weekdayOf(session.date)],
      workout: session.daySlotName,
      setsDone: sets.length,
      /* Only when it was recorded. An older session has no planned count, and
         reporting "0 planned" for it would read as a session with nothing in
         it rather than one logged before the app counted. */
      setsPlanned: planned > 0 ? planned : undefined,
      minutes: session.durationMin,
    });
  }
  return rows;
}

/** Sets per muscle this week, worst first, keeping only the ones short. */
function volumeSummary(sets: SetLog[], byId: Map<string, Exercise>, threshold: number) {
  const volume = setsPerMuscle(sets, byId);
  return (Object.keys(volume) as MuscleId[])
    .map((id) => ({ muscle: MUSCLE_BY_ID[id]?.name ?? id, sets: volume[id] ?? 0 }))
    .sort((a, b) => a.sets - b.sets || a.muscle.localeCompare(b.muscle))
    .filter((row) => row.sets < threshold)
    .slice(0, 8);
}

/**
 * What the coach is told without being asked. Read from the same tables and
 * through the same functions the screens use, so nothing here can say
 * something the app would not.
 */
export async function buildCoachContext(exercises: Exercise[]): Promise<CoachContext> {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const today = todayIso();
  const from = weekStart(today);

  const [training, instructions, plan, sessions, weight] = await Promise.all([
    readTraining(),
    readAiInstructions(),
    readWeekPlan(),
    recentSessions(6),
    db.sharedBodyWeight.orderBy('date').reverse().first(),
  ]);

  /* This week's sets, by way of this week's sessions. Queried by session id
     rather than by reading every set ever logged and filtering: the whole
     point of the tools is not moving data around that nothing will read. */
  const weekSessions = await db.session
    .where('date')
    .between(from, shiftIso(from, 7), true, false)
    .toArray();
  const thisWeeksSets = await db.setLog
    .where('sessionId')
    .anyOf(weekSessions.map((session) => session.id))
    .toArray();

  const share = fairShare(training.weeklySetTarget, byId);

  return {
    payload: {
      today: `${WEEKDAY_LABEL[weekdayOf(today)]} ${today}`,
      lifter: {
        bodyWeightKg: weight?.kg,
        bodyWeightOn: weight?.date,
        golfDays: training.golfWeekdays.map(weekdayName),
        weeklySetTarget: training.weeklySetTarget,
        sessionMinutes: training.sessionMinutes,
        split: training.shape,
        /* Their own words, from Settings. Last so it cannot be mistaken for
           one of the app's own facts. */
        notes: instructions || undefined,
      },
      thisWeek: {
        setsLogged: thisWeeksSets.length,
        fairSharePerMuscle: share,
        musclesUnderTheirShare: volumeSummary(thisWeeksSets, byId, share),
        workouts: (plan?.all ?? []).map((day) => ({
          name: dayLabel({
            slot: day.slot,
            name: day.name,
            exercises: day.entries
              .map((entry) => byId.get(entry.exerciseId))
              .filter((exercise): exercise is Exercise => exercise !== undefined),
            intensity: day.intensity,
          }),
          intensity: day.intensity,
          date: day.date,
          placed: day.date !== undefined,
          done: day.done,
          exercises: day.entries.map(
            (entry) => byId.get(entry.exerciseId)?.name ?? entry.exerciseId,
          ),
        })),
      },
      recentSessions: sessions,
    },
  };
}

/* --- the loop ------------------------------------------------------------- */

/** One turn as the app keeps it: the question, or the reply that came back. */
export type CoachTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; content: unknown[] };

export interface CoachAnswer {
  text?: string;
  error?: string;
  /** Rounds spent, tool calls made, and what the whole answer cost. */
  rounds: number;
  toolCalls: string[];
  usage: AskUsage;
  ms: number;
  /** The turns to keep, so the next question continues this conversation. */
  turns: CoachTurn[];
}

function addUsage(total: AskUsage, next: AskUsage | undefined): AskUsage {
  if (!next) return total;
  const add = (a: number | undefined, b: number | undefined) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: add(total.inputTokens, next.inputTokens),
    outputTokens: add(total.outputTokens, next.outputTokens),
    cacheReadTokens: add(total.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: add(total.cacheWriteTokens, next.cacheWriteTokens),
  };
}

/**
 * How many turns of the conversation are kept and replayed.
 *
 * The thread is remembered across app opens now, so without a cap it would
 * grow until every question re-billed a fortnight of chat. Four exchanges is
 * enough for "what about the other one" to mean something, and each turn is
 * only the text plus the assistant blocks — no tool results, which is where
 * the tokens are.
 */
export const MEMORY_TURNS = 8;

/**
 * The last `keep` turns, and how many were dropped so a caller can re-key
 * anything it holds by index.
 *
 * Never starts on an assistant turn: the API rejects a message list that does,
 * and a reply with the question it answered cut away is not much use to a
 * reader either.
 */
export function trimTurns(
  turns: CoachTurn[],
  keep = MEMORY_TURNS,
): { turns: CoachTurn[]; dropped: number } {
  if (turns.length <= keep) return { turns, dropped: 0 };
  let dropped = turns.length - keep;
  while (dropped < turns.length && turns[dropped]?.role !== 'user') dropped += 1;
  return { turns: turns.slice(dropped), dropped };
}

/**
 * Turns read back from storage, keeping only what is actually a turn. Stored
 * JSON is not a type: a half-written row, or one from an older build, has to
 * come back as a shorter conversation rather than as a crash in the sheet.
 */
export function parseTurns(value: unknown): CoachTurn[] {
  if (!Array.isArray(value)) return [];
  const out: CoachTurn[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    const turn = row as Record<string, unknown>;
    if (typeof turn.text !== 'string' || !turn.text) continue;
    if (turn.role === 'user') out.push({ role: 'user', text: turn.text });
    /* An assistant turn is replayed to the model as its own content blocks, so
       one without them cannot be replayed at all. */
    else if (turn.role === 'assistant' && Array.isArray(turn.content)) {
      out.push({ role: 'assistant', text: turn.text, content: turn.content });
    }
  }
  // And never lead with a reply, for the same reason trimTurns does not.
  const lead = out.findIndex((turn) => turn.role === 'user');
  return lead <= 0 ? out : out.slice(lead);
}

/** The conversation so far, wire-shaped. Assistant turns replay unchanged. */
function wireMessages(turns: CoachTurn[], question: string): unknown[] {
  return [
    ...trimTurns(turns).turns.map((turn) =>
      turn.role === 'user'
        ? { role: 'user', content: turn.text }
        : { role: 'assistant', content: turn.content },
    ),
    { role: 'user', content: question },
  ];
}

/**
 * Asks one question and runs whatever lookups the answer needs.
 *
 * Never throws. A coach that cannot answer says so in the sheet; nothing else
 * in the app depends on it.
 */
export async function askCoach({
  question,
  turns,
  exercises,
  context,
  onText,
  signal,
  fetchImpl,
}: {
  question: string;
  turns: CoachTurn[];
  exercises: Exercise[];
  context: CoachContext;
  /**
   * Each piece of the answer as it arrives. The whole reason the reply is
   * streamed: a question that needs a lookup is two or three serial round
   * trips, and reading the first sentence while the rest lands is the
   * difference between that feeling slow and feeling immediate.
   */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CoachAnswer> {
  const system = `${SYSTEM}\n\nWhat the app already knows:\n${JSON.stringify(context.payload)}`;
  const messages = wireMessages(turns, question);
  const started = Date.now();
  let usage: AskUsage = {};
  const toolCalls: string[] = [];

  for (let round = 1; round <= MAX_TOOL_ROUNDS + 1; round += 1) {
    const result = await streamConversation(
      { system, messages, tools: COACH_TOOLS, signal },
      onText,
      fetchImpl ?? fetch,
    );
    usage = addUsage(usage, result.usage);
    if (result.error || !result.content) {
      return {
        error: result.error ?? 'No reply.',
        rounds: round,
        toolCalls,
        usage,
        ms: Date.now() - started,
        turns,
      };
    }

    messages.push({ role: 'assistant', content: result.content });

    /* Out of lookups. Whatever it has said so far is the answer, because
       another round is another wait the user did not ask for. */
    const outOfRounds = round > MAX_TOOL_ROUNDS;
    if (result.toolCalls.length === 0 || outOfRounds) {
      const text =
        result.text ??
        (outOfRounds ? 'I ran out of lookups before I could answer that.' : undefined);
      return {
        text,
        error: text ? undefined : 'Empty reply.',
        rounds: round,
        toolCalls,
        usage,
        ms: Date.now() - started,
        turns: [
          ...turns,
          { role: 'user', text: question },
          ...(text ? [{ role: 'assistant' as const, text, content: result.content }] : []),
        ],
      };
    }

    /*
     * Every result goes back in ONE user message. Splitting them across
     * several teaches the model to stop asking for things in parallel, which
     * would turn a two-lookup answer into two extra round trips.
     */
    const results = await Promise.all(
      result.toolCalls.map(async (call) => {
        toolCalls.push(call.name);
        const outcome = await runCoachTool(call.name, call.input, exercises);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError ? { is_error: true } : {}),
        };
      }),
    );
    messages.push({ role: 'user', content: results });
  }

  // Unreachable: the loop returns on its last iteration.
  return { error: 'No reply.', rounds: MAX_TOOL_ROUNDS, toolCalls, usage, ms: 0, turns };
}
