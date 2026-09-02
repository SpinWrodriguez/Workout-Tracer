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
import { MAX_TOOL_ROUNDS, askCoach, buildCoachContext } from './aiCoach';

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
    /* Roughly four characters to a token, so this is about 1,300 tokens of
       rules and context on an empty database — a fraction of one library. */
    expect(system.length).toBeLessThan(5200);
  });

  it('offers the three tools and no output schema', async () => {
    const { sent } = await ask([says('ok')]);
    expect(sent[0]?.tools.map((tool) => tool.name)).toEqual([
      'search_exercises',
      'exercise_detail',
      'exercise_history',
    ]);
    /* A schema would bar the tool_use blocks this shape exists for. `effort`
       is thinking depth and still applies. */
    expect(sent[0]?.output_config.format).toBeUndefined();
    expect(sent[0]?.output_config.effort).toBe('low');
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
