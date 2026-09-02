/* -------------------------------------------------------------------------- */
/*  Server-sent events, read off a fetch body.                               */
/*                                                                           */
/*  Hand-written for the same reason the request bodies are: the app talks to */
/*  the API over plain fetch, and pulling in an SDK to read a stream would    */
/*  put a second opinion about the wire format in the bundle.                */
/*                                                                           */
/*  The whole difficulty is that chunks are not messages. A chunk can hold    */
/*  three events, or half of one — a `data:` line split through the middle of */
/*  a JSON string is normal, not an edge case — so the buffer survives across */
/*  chunks and only complete records are handed on.                          */
/* -------------------------------------------------------------------------- */

/**
 * The parsed `data:` payload of each event, in order.
 *
 * `event:` lines are ignored on purpose: every Messages API event carries its
 * own `type`, and trusting the field inside the JSON rather than the label
 * beside it means one thing to get wrong instead of two.
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      // `stream: true` keeps multi-byte characters whole across chunks.
      if (value) buffer += decoder.decode(value, { stream: true });

      if (done) {
        buffer += decoder.decode();
        /* Whatever is left without a blank line after it. A well-behaved
           stream ends on a boundary; a connection that dropped does not, and
           a half-written record is not worth guessing at. */
        const last = recordOf(buffer);
        if (last !== undefined) yield last;
        return;
      }

      let boundary = nextBoundary(buffer);
      while (boundary !== undefined) {
        const record = buffer.slice(0, boundary.at);
        buffer = buffer.slice(boundary.at + boundary.length);
        const parsed = recordOf(record);
        if (parsed !== undefined) yield parsed;
        boundary = nextBoundary(buffer);
      }
    }
  } finally {
    // Cancels the body when a consumer stops early — an abandoned request
    // otherwise holds the connection until the whole answer arrives.
    reader.releaseLock();
  }
}

/** The end of the first complete record, allowing for either line ending. */
function nextBoundary(buffer: string): { at: number; length: number } | undefined {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { at: crlf, length: 4 };
  return { at: lf, length: 2 };
}

/**
 * One record's data, parsed. Undefined for anything that is not JSON data: a
 * comment, a heartbeat, or the blank record between two events.
 */
function recordOf(record: string): unknown {
  const data: string[] = [];
  for (const line of record.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    // One optional space after the colon is part of the format, not content.
    data.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
  }
  if (data.length === 0) return undefined;
  const payload = data.join('\n');
  if (payload === '' || payload === '[DONE]') return undefined;
  try {
    return JSON.parse(payload);
  } catch {
    // A malformed event is skipped rather than killing the stream: the next
    // one may well be the answer.
    return undefined;
  }
}
