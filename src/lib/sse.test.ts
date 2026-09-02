import { describe, expect, it } from 'vitest';
import { sseEvents } from './sse';

/*
 * A chunk is not a message. Everything here is about that: the API happily
 * splits a `data:` line through the middle of a JSON string, and a reader that
 * assumes otherwise works perfectly on a fast connection and drops half the
 * answer on a slow one — which is the connection this app actually runs on.
 */

/** A body that hands out exactly these chunks, boundaries and all. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of sseEvents(streamOf(chunks))) events.push(event);
  return events;
}

const event = (payload: unknown) => `event: x\ndata: ${JSON.stringify(payload)}\n\n`;

describe('reading events', () => {
  it('parses one event per record', async () => {
    expect(await collect([event({ type: 'a' }), event({ type: 'b' })])).toEqual([
      { type: 'a' },
      { type: 'b' },
    ]);
  });

  it('reads several events out of one chunk', async () => {
    expect(await collect([event({ n: 1 }) + event({ n: 2 }) + event({ n: 3 })])).toHaveLength(3);
  });

  it('reads one event split across chunks, mid-JSON', async () => {
    const whole = event({ type: 'content_block_delta', delta: { text: 'hello there' } });
    const cut = whole.indexOf('hello') + 3;
    /* The exact failure this file exists for: a break inside a JSON string
       value, which parses as neither half. */
    expect(await collect([whole.slice(0, cut), whole.slice(cut)])).toEqual([
      { type: 'content_block_delta', delta: { text: 'hello there' } },
    ]);
  });

  it('reads an event whose record boundary is itself split', async () => {
    const whole = event({ type: 'done' });
    const cut = whole.length - 1;
    expect(await collect([whole.slice(0, cut), whole.slice(cut)])).toEqual([{ type: 'done' }]);
  });

  it('handles a character split across chunks', async () => {
    const bytes = new TextEncoder().encode(event({ text: '—' }));
    const at = [...bytes].indexOf(0xe2) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, at));
        controller.enqueue(bytes.slice(at));
        controller.close();
      },
    });
    const events: unknown[] = [];
    for await (const parsed of sseEvents(stream)) events.push(parsed);
    // A multi-byte dash cut in half decodes to a replacement character unless
    // the decoder is told the stream continues.
    expect(events).toEqual([{ text: '—' }]);
  });
});

describe('what is not an event', () => {
  it('ignores comments and heartbeats', async () => {
    expect(await collect([': keep-alive\n\n', event({ type: 'a' }), '\n\n'])).toEqual([
      { type: 'a' },
    ]);
  });

  it('ignores the event: label and trusts the type inside the JSON', async () => {
    const mislabelled = 'event: message_start\ndata: {"type":"message_stop"}\n\n';
    expect(await collect([mislabelled])).toEqual([{ type: 'message_stop' }]);
  });

  it('skips a malformed event rather than ending the stream', async () => {
    expect(await collect(['data: {oh no\n\n', event({ type: 'a' })])).toEqual([{ type: 'a' }]);
  });

  it('joins a data field written across several lines', async () => {
    expect(await collect(['data: {"a":\ndata: 1}\n\n'])).toEqual([{ a: 1 }]);
  });
});

describe('a stream that ends badly', () => {
  it('takes a last event with no blank line after it', async () => {
    expect(await collect(['data: {"type":"message_stop"}'])).toEqual([{ type: 'message_stop' }]);
  });

  it('drops a half-written record rather than guessing', async () => {
    expect(await collect([event({ type: 'a' }), 'data: {"type":"cut'])).toEqual([{ type: 'a' }]);
  });
});
