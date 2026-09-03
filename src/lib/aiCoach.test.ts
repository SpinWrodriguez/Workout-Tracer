import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Unconfigured, so the device-key path is the one under test. Without this the
   edge branch is taken and the stubbed fetch below is never called. */
vi.mock('./supabaseSource', () => ({
  isSupabaseConfigured: () => false,
  getSupabase: async () => undefined,
}));

import { db } from '../db/db';
import { seedDatabase } from '../db/seed';
import { EXERCISES } from '../db/seed/exercises';
import { writeApiKey } from './askModel';
import {
  MAX_TOOL_ROUNDS,
  MEMORY_TURNS,
  askCoach,
  buildCoachContext,
  parseTurns,
  trimTurns,
  type CoachTurn,
} from './aiCoach';

/*
 * The loop, and the promise the whole feature rests on: the exercise library
 * is never sent. Everything else here — one user message per round of
 * results, a bounded number of rounds, an assistant turn replayed unchanged —
 * exists because getting it wrong is invisible until the bill or the latency
 * says so.
 */

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

interface Body {
  system: { text: string }[];
  messages: { role: string; content: unknown }[];
  tools: { name: string }[];
  output_config: Record<string, unknown>;
}

/*
 * A reply as the wire actually delivers it. The coach streams, so a plain JSON
 * body would test a path production does not take — and writing the fixtures
 * as whole messages and encoding them here is what proves the assembler puts
 * back exactly the turn that was sent, tool arguments split across deltas and
 * all.
 */
function sseBody(reply: {
  content?: Record<string, unknown>[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}): ReadableStream<Uint8Array> {
  const events: unknown[] = [
    { type: 'message_start', message: { usage: { input_tokens: reply.usage?.input_tokens } } },
  ];
  (reply.content ?? []).forEach((block, index) => {
    if (block.type === 'tool_use') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      // Split, because that is how arguments arrive: JSON in pieces.
      const json = JSON.stringify(block.input ?? {});
      const cut = Math.ceil(json.length / 2);
      for (const piece of [json.slice(0, cut), json.slice(cut)]) {
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: piece },
        });
      }
    } else if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: String(block.text ?? '') },
      });
    } else {
      events.push({ type: 'content_block_start', index, content_block: block });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: reply.stop_reason },
    usage: { output_tokens: reply.usage?.output_tokens },
  });
  events.push({ type: 'message_stop' });

  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: x\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

/** Replies in order, recording every body it was sent. */
function transport(replies: Parameters<typeof sseBody>[0][]) {
  const sent: Body[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body) as Body);
    const reply = replies[sent.length - 1] ?? { content: [{ type: 'text', text: 'done' }] };
    return {
      ok: true,
      status: 200,
      body: sseBody(reply),
      json: async () => reply,
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const says = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 700, output_tokens: 120 },
});

const asksFor = (calls: { id: string; name: string; input: unknown }[]) => ({
  content: [
    { type: 'thinking', thinking: '' },
    ...calls.map((call) => ({ type: 'tool_use', ...call })),
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 700, output_tokens: 90 },
});

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDatabase();
  store.clear();
  writeApiKey('sk-ant-test');
});

const ask = async (
  replies: Parameters<typeof sseBody>[0][],
  question = 'is my squat moving?',
  onText?: (delta: string) => void,
) => {
  const { fetchImpl, sent } = transport(replies);
  const context = await buildCoachContext(EXERCISES);
  const answer = await askCoach({
    question,
    turns: [],
    exercises: EXERCISES,
    context,
    onText,
    fetchImpl,
  });
  return { answer, sent };
};

describe('what the coach is sent', () => {
  it('never sends the exercise library', async () => {
    /* Seeded with a real workout, because an empty database would pass this
       test for the wrong reason. What the coach is told is the three exercises
       in this week's plan — not the seventy-three it could choose from. */
    await db.blockExercise.bulkPut(
      ['bb_back_squat', 'bb_rdl', 'cb_pallof_press'].map((exerciseId, order) => ({
        blockId: 'block_1',
        exerciseId,
        daySlot: 'A' as const,
        targetSets: 3,
        repRangeLow: 8,
        repRangeHigh: 10,
        order,
      })),
    );

    const { sent } = await ask([says('Yes, 5kg in three weeks.')]);
    const system = sent[0]?.system[0]?.text ?? '';

    /* The whole reason the tools exist. The library is ~6,200 tokens and a
       question does not need 73 exercises to answer — it needs one. */
    const leaked = EXERCISES.filter((exercise) => system.includes(exercise.name));
    expect(leaked.map((exercise) => exercise.id).sort()).toEqual([
      'bb_back_squat',
      'bb_rdl',
      'cb_pallof_press',
    ]);
    // And no ids at all, which is how a pasted payload would show up.
    expect(system).not.toContain('bb_back_squat"');
    expect(system).not.toContain('loadMultiplier');
  });

  it('keeps the always-sent context small enough not to think about', async () => {
    const { sent } = await ask([says('ok')]);
    const system = sent[0]?.system[0]?.text ?? '';
    /* Roughly four characters to a token, so this is about 1,200 tokens of
       rules and context on an empty database — a fraction of one library, and
       the whole reason a question costs a fraction of a cent. */
    expect(system.length).toBeLessThan(5200);
  });

  it('licenses general training knowledge, not just a read of the data', async () => {
    const { sent } = await ask([says('ok')]);
    const system = sent[0]?.system[0]?.text ?? '';
    /* Found by using it: asked what a good per-muscle set range was, it said
       the app does not hand it one and offered to flag gaps instead. The rule
       against inventing numbers ABOUT THEIR TRAINING had gagged the general
       knowledge that is most of why anyone asks. */
    expect(system).toMatch(/General training knowledge is yours to give/);
    expect(system).toMatch(/Declining to answer a training question/);
    /* And it had learnt to punt to the Program screen, which is a real
       boundary for writing a workout and not a reason to dodge a question. */
    expect(system).toMatch(/Never use the Program screen, or anything else in the app, as a reason not to answer/);
  });

  it('offers every lookup and no output schema', async () => {
    const { sent } = await ask([says('ok')]);
    expect(sent[0]?.tools.map((tool) => tool.name)).toEqual([
      'search_exercises',
      'exercise_detail',
      'exercise_history',
      'session_detail',
    ]);
    /* A schema would bar the tool_use blocks this shape exists for. `effort`
       is thinking depth and still applies. */
    expect(sent[0]?.output_config.format).toBeUndefined();
    expect(sent[0]?.output_config.effort).toBe('low');
  });

  it('says where the app\'s own numbers come from, so it does not invent one', async () => {
    const { sent } = await ask([says('ok')]);
    const system = sent[0]?.system[0]?.text ?? '';
    /* Found by using it: asked what the weekly set target was for, it
       explained that the app derives it from recovery capacity and session
       count — which is not a thing the app does — and tied it to the
       under-the-floor flag, which is a different rule with fixed numbers.
       Both were invented to fill a gap in what it had been told. */
    expect(system).toMatch(/lifter sets it themselves/);
    expect(system).toMatch(/Nothing derives it/);
    /* And the shortfall list is measured against a share of that target, not
       the 8-set floor from the literature — two numbers that used to be one
       sentence apart and got conflated. */
    expect(system).toMatch(/musclesUnderTheirShare is measured against fairSharePerMuscle/);
    expect(system).toMatch(/spread evenly over the 18 muscles/);
    expect(system).toMatch(/floor from the literature is 8/);
    expect(system).toMatch(/Never explain one of the app's numbers by inventing/);
  });

  it('tells it what the app already knows, so it does not ask', async () => {
    await db.session.put({
      id: 's1',
      blockId: 'block_1',
      daySlot: 'A',
      daySlotName: 'Lower + Core',
      date: '2026-01-05',
      durationMin: 38,
    });
    const { sent } = await ask([says('ok')]);
    const system = sent[0]?.system[0]?.text ?? '';
    expect(system).toContain('Lower + Core');
    expect(system).toContain('weeklySetTarget');
  });
});

describe('running a lookup', () => {
  it('executes the tool and sends the result back under its own id', async () => {
    await db.session.put({ id: 's1', blockId: 'block_1', daySlot: 'A', date: '2026-01-05' });
    await db.setLog.put({
      sessionId: 's1',
      exerciseId: 'bb_back_squat',
      setNo: 1,
      weightKg: 100,
      reps: 5,
    });

    const { answer, sent } = await ask([
      asksFor([{ id: 'tu_1', name: 'exercise_history', input: { exerciseId: 'bb_back_squat' } }]),
      says('Up 5kg since last month.'),
    ]);

    expect(answer.text).toBe('Up 5kg since last month.');
    expect(answer.toolCalls).toEqual(['exercise_history']);

    const results = sent[1]?.messages.at(-1) as { role: string; content: { tool_use_id: string; content: string }[] };
    expect(results.role).toBe('user');
    expect(results.content[0]?.tool_use_id).toBe('tu_1');
    // Answered from the database, not from anything the model supplied.
    expect(results.content[0]?.content).toContain('100');
  });

  it('replays the assistant turn unchanged, thinking blocks included', async () => {
    const { sent } = await ask([
      asksFor([{ id: 'tu_1', name: 'search_exercises', input: { pattern: 'hinge' } }]),
      says('Romanian deadlift.'),
    ]);
    const assistant = sent[1]?.messages.find((message) => message.role === 'assistant');
    /* Echoed back as it arrived. Rebuilding it from the text would drop the
       thinking block, which the API asks to see again on the same model. */
    expect(assistant?.content).toEqual([
      { type: 'thinking', thinking: '' },
      { type: 'tool_use', id: 'tu_1', name: 'search_exercises', input: { pattern: 'hinge' } },
    ]);
  });

  it('answers two lookups in one message rather than one each', async () => {
    const { sent } = await ask([
      asksFor([
        { id: 'tu_1', name: 'exercise_detail', input: { exerciseId: 'bb_back_squat' } },
        { id: 'tu_2', name: 'exercise_detail', input: { exerciseId: 'bb_deadlift' } },
      ]),
      says('Both are heavy spinal work.'),
    ]);
    const last = sent[1]?.messages.at(-1) as { content: unknown[] };
    /* Splitting them teaches the model to stop asking in parallel, which turns
       a two-lookup answer into two extra round trips the user waits through. */
    expect(last.content).toHaveLength(2);
    expect(sent[1]?.messages.filter((message) => message.role === 'user')).toHaveLength(2);
  });

  it('sends a failed tool back as an error the model can work around', async () => {
    const { sent, answer } = await ask([
      asksFor([{ id: 'tu_1', name: 'no_such_tool', input: {} }]),
      says('I could not look that up.'),
    ]);
    const results = sent[1]?.messages.at(-1) as { content: { is_error?: boolean }[] };
    expect(results.content[0]?.is_error).toBe(true);
    // The conversation carries on rather than dying mid-answer.
    expect(answer.text).toBe('I could not look that up.');
  });
});

describe('streaming the answer', () => {
  it('hands over each piece as it arrives, not just the finished reply', async () => {
    const deltas: string[] = [];
    const { answer } = await ask(
      [
        asksFor([{ id: 'tu_1', name: 'exercise_history', input: { exerciseId: 'bb_back_squat' } }]),
        says('Up 5kg. Keep going.'),
      ],
      'is my squat moving?',
      (delta) => deltas.push(delta),
    );

    /* The point of streaming: something to read before the answer is
       finished. A lookup makes this two serial round trips, so the wait is
       long enough to matter. */
    expect(deltas.join('')).toBe('Up 5kg. Keep going.');
    expect(answer.text).toBe('Up 5kg. Keep going.');
  });

  it('does not stream the thinking, which arrives empty anyway', async () => {
    const deltas: string[] = [];
    await ask([says('Fine.')], 'how am I doing?', (delta) => deltas.push(delta));
    // `display` defaults to omitted on this model, so a thinking block carries
    // no text — and prose is the only thing a reader wants mid-answer.
    expect(deltas).toEqual(['Fine.']);
  });
});

describe('when it will not stop asking', () => {
  it('stops after a bounded number of rounds', async () => {
    const forever = Array.from({ length: 10 }, (_, index) =>
      asksFor([{ id: `tu_${index}`, name: 'search_exercises', input: {} }]),
    );
    const { answer, sent } = await ask(forever);

    /* Each round is a whole round trip. Left unbounded this is a spinner that
       never resolves and a bill that keeps growing. */
    expect(sent).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(answer.rounds).toBe(MAX_TOOL_ROUNDS + 1);
    expect(answer.text).toContain('ran out of lookups');
  });

  it('adds up what the whole answer cost, not just the last round', async () => {
    const { answer } = await ask([
      asksFor([{ id: 'tu_1', name: 'search_exercises', input: {} }]),
      says('Right.'),
    ]);
    expect(answer.usage.inputTokens).toBe(1400);
    expect(answer.usage.outputTokens).toBe(210);
  });
});

describe('when the model cannot be reached', () => {
  it('reports it and keeps the conversation as it was', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const context = await buildCoachContext(EXERCISES);
    const answer = await askCoach({
      question: 'anything',
      turns: [{ role: 'user', text: 'earlier' }],
      exercises: EXERCISES,
      context,
      fetchImpl: failing,
    });
    expect(answer.error).toContain('network down');
    expect(answer.text).toBeUndefined();
    // The failed question is not written into the history it would replay.
    expect(answer.turns).toEqual([{ role: 'user', text: 'earlier' }]);
  });
});

describe('a conversation that is kept', () => {
  const said = (text: string): CoachTurn => ({
    role: 'assistant',
    text,
    content: [{ type: 'text', text }],
  });
  const asked = (text: string): CoachTurn => ({ role: 'user', text });

  /** n exchanges: a question and its answer, numbered. */
  const thread = (n: number): CoachTurn[] =>
    Array.from({ length: n }, (_, i) => [asked(`q${i}`), said(`a${i}`)]).flat();

  it('keeps the recent end of a long thread', () => {
    /* The thread outlives the sheet now, so without a cap every question
       would re-bill a fortnight of chat. */
    const { turns, dropped } = trimTurns(thread(10));
    expect(turns).toHaveLength(MEMORY_TURNS);
    expect(dropped).toBe(20 - MEMORY_TURNS);
    expect(turns[turns.length - 1]?.text).toBe('a9');
  });

  it('never starts on a reply, which the API rejects outright', () => {
    for (let length = 1; length <= 12; length += 1) {
      const { turns } = trimTurns(thread(6).slice(0, length), 3);
      if (turns.length > 0) expect(turns[0]?.role, `length ${length}`).toBe('user');
    }
  });

  it('leaves a short thread exactly as it is', () => {
    const short = thread(2);
    expect(trimTurns(short)).toEqual({ turns: short, dropped: 0 });
  });

  it('reads back only what is actually a turn', () => {
    /* Stored JSON is not a type. A row from an older build has to come back
       as a shorter conversation, not as a crash in the sheet. */
    expect(parseTurns(parseTurns(thread(2)))).toEqual(thread(2));
    expect(parseTurns(undefined)).toEqual([]);
    expect(parseTurns([null, 7, 'hello'])).toEqual([]);
    // A question with no text, and a reply with no blocks to replay.
    expect(parseTurns([{ role: 'user' }, { role: 'assistant', text: 'a' }])).toEqual([]);
  });

  it('drops a leading reply on the way back in', () => {
    const stored = [said('a0'), asked('q1'), said('a1')];
    expect(parseTurns(stored).map((turn) => turn.text)).toEqual(['q1', 'a1']);
  });

  it('replays the trimmed thread, not the whole of it', async () => {
    const { fetchImpl, sent } = transport([says('ok')]);
    const context = await buildCoachContext(EXERCISES);
    await askCoach({
      question: 'and the other one?',
      turns: thread(10),
      exercises: EXERCISES,
      context,
      fetchImpl,
    });
    // The trimmed thread plus the new question, starting on a question.
    expect(sent[0]?.messages).toHaveLength(MEMORY_TURNS + 1);
    expect(sent[0]?.messages[0]?.role).toBe('user');
  });
});
