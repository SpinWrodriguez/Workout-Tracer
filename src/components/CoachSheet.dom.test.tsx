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

import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseSource', () => ({
  isSupabaseConfigured: () => false,
  getSupabase: async () => undefined,
}));

import { db } from '../db/db';
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

const openSheet = () => {
  draw(<CoachSheet exercises={exercises} onClose={() => {}} />);
  return user();
};

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
