// @vitest-environment jsdom

/*
 * The coach sheet, driven through a stream held open on purpose.
 *
 * This is the only way to prove the thing streaming exists for: that the first
 * sentence is on screen while the rest of the answer is still arriving. A
 * browser check cannot show it — Playwright hands the whole body over in one
 * chunk, so a sheet that waited for the last token would look identical.
 */

import '../test/dom';

import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseSource', () => ({
  isSupabaseConfigured: () => false,
  getSupabase: async () => undefined,
}));

import { db } from '../db/db';
import { COACH_CHAT_KEY, writeCoachChat } from '../db/settings';
import { exercises, draw, user } from '../test/dom';
import { resetTransportProbe, writeApiKey } from '../lib/askModel';
import { CoachSheet } from './CoachSheet';

/** A body whose events are released one call at a time. */
function heldStream() {
  const encoder = new TextEncoder();
  let push: (event: unknown) => void = () => {};
  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      close = () => controller.close();
    },
  });
  return { stream, push, close };
}

let held: ReturnType<typeof heldStream>;

beforeEach(async () => {
  writeApiKey('sk-ant-test');
  resetTransportProbe();
  held = heldStream();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, body: held.stream, text: async () => '' })),
  );
  await db.session.put({
    id: 's1',
    blockId: 'block_1',
    daySlot: 'A',
    daySlotName: 'Lower',
    date: '2026-08-26',
  });
  await db.setLog.put({
    sessionId: 's1',
    exerciseId: 'bb_back_squat',
    setNo: 1,
    weightKg: 95,
    reps: 5,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const openSheet = (initialQuestion?: string) => {
  draw(<CoachSheet exercises={exercises} initialQuestion={initialQuestion} onClose={() => {}} />);
  return user();
};

/** Runs one whole answer through the held stream and closes it. */
function answerWith(text: string, outputTokens = 44) {
  held.push({ type: 'message_start', message: { usage: { input_tokens: 900 } } });
  held.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  held.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  held.push({ type: 'content_block_stop', index: 0 });
  held.push({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: outputTokens },
  });
  held.push({ type: 'message_stop' });
  held.close();
}

describe('an answer arriving a piece at a time', () => {
  it('shows the first words while the rest is still coming', async () => {
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));

    held.push({ type: 'message_start', message: { usage: { input_tokens: 900 } } });
    held.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    held.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Yes — up 5kg' },
    });

    /* On screen with the request still open. This assertion failing is the
       whole feature failing, however green the stream parser is. */
    await waitFor(() => expect(screen.getByText('Yes — up 5kg')).toBeTruthy());

    held.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: ' in three weeks.' },
    });
    await waitFor(() => expect(screen.getByText('Yes — up 5kg in three weeks.')).toBeTruthy());

    held.push({ type: 'content_block_stop', index: 0 });
    held.push({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 44 },
    });
    held.push({ type: 'message_stop' });
    held.close();

    // Settled into a real turn, with what it cost underneath it.
    await waitFor(() => expect(screen.getByText(/44 tokens out/)).toBeTruthy());
  });

  it('says what it is doing before there is anything to read', async () => {
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));
    /* The gap before the first token is real — it is a thinking model — so it
       is filled with a word rather than an empty bubble. */
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Reading your/));
  });

  it('reports a stream that dies mid-answer rather than keeping half of it', async () => {
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));

    held.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    held.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Your squat' } });
    held.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    held.close();

    await waitFor(() => expect(screen.getByText('Overloaded')).toBeTruthy());
    /* Half an answer is not an answer, and replaying it as a turn would put
       words in the model's mouth on the next question. */
    expect(screen.queryByText('Your squat')).toBeNull();
  });
});

describe('a conversation that survives the sheet closing', () => {
  it('is there again on the next open, footnote and all', async () => {
    /* It lived in component state, so closing the sheet ended the thread —
       and so did iOS reloading the PWA. Every follow-up then started from
       nothing, which is the one thing a conversation cannot survive. */
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));
    answerWith('Yes — up 5kg in three weeks.');
    await waitFor(() => expect(screen.getByText(/44 tokens out/)).toBeTruthy());

    cleanup();
    held = heldStream();
    openSheet();

    await waitFor(() =>
      expect(screen.getByText('Yes — up 5kg in three weeks.')).toBeTruthy(),
    );
    // The question it answered, and where the answer came from.
    expect(screen.getByText('Is my squat actually moving?')).toBeTruthy();
    expect(screen.getByText(/44 tokens out/)).toBeTruthy();
  });

  it('is replayed to the model, so a follow-up has a referent', async () => {
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));
    answerWith('Yes — up 5kg.');
    await waitFor(() => expect(screen.getByText('Yes — up 5kg.')).toBeTruthy());

    cleanup();
    held = heldStream();
    const next = openSheet();
    await waitFor(() => expect(screen.getByText('Yes — up 5kg.')).toBeTruthy());

    await next.type(screen.getByLabelText('Ask about your training'), 'what about the bench?');
    await next.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const init = calls[calls.length - 1]?.[1] as { body: string } | undefined;
      expect(init).toBeDefined();
      const body = JSON.parse(init?.body ?? '{}') as {
        messages: { role: string; content: unknown }[];
      };
      // question, answer, question — not one message with no history behind it.
      expect(body.messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
    });
  });

  it('drops it on New, which is the only way to now', async () => {
    const ui = openSheet();
    await ui.click(await screen.findByRole('button', { name: /Is my squat/ }));
    answerWith('Yes — up 5kg.');
    await waitFor(() => expect(screen.getByText('Yes — up 5kg.')).toBeTruthy());

    await ui.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect(screen.queryByText('Yes — up 5kg.')).toBeNull());
    // And it stays dropped: the stored row went with it.
    cleanup();
    held = heldStream();
    openSheet();
    await screen.findByRole('button', { name: /Is my squat/ });
    expect(screen.queryByText('Yes — up 5kg.')).toBeNull();
  });

  it('forgets a thread older than a few days rather than resuming it cold', async () => {
    /* The context is this week and the last few sessions, so a fortnight-old
       thread would be continuing a conversation about a week that is gone. */
    await writeCoachChat({
      turns: [
        { role: 'user', text: 'from a fortnight ago' },
        { role: 'assistant', text: 'an old answer', content: [{ type: 'text', text: 'an old answer' }] },
      ],
    });
    const row = await db.settings.get(COACH_CHAT_KEY);
    await db.settings.put({
      key: COACH_CHAT_KEY,
      value: {
        ...(row?.value as object),
        savedAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      },
    });

    openSheet();

    await screen.findByRole('button', { name: /Is my squat/ });
    expect(screen.queryByText('an old answer')).toBeNull();
    // Cleared, not just ignored.
    await waitFor(async () => expect(await db.settings.get(COACH_CHAT_KEY)).toBeUndefined());
  });
});

describe('a question handed over by another screen', () => {
  it('is asked as soon as the sheet opens', async () => {
    // How History gives the coach one session to look at.
    openSheet('About my Lower session on 2026-08-26: how did it go?');
    await waitFor(() =>
      expect(screen.getByText('About my Lower session on 2026-08-26: how did it go?')).toBeTruthy(),
    );
    answerWith('Three sets of squats, and you stopped there.');
    await waitFor(() =>
      expect(screen.getByText('Three sets of squats, and you stopped there.')).toBeTruthy(),
    );
  });
});
