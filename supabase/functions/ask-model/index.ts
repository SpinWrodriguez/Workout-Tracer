/*
 * Relays one Messages API call, holding the key server-side.
 *
 * Why this exists: there is no way to keep a key in a client-side PWA. The
 * app's fallback is a key pasted into Settings and kept in localStorage, which
 * works but is readable by anything that can read the origin's storage. This
 * keeps the key here instead, and the caller proves who they are with the
 * Supabase session the app already has for workout_data.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy ask-model
 *
 * It is a relay on purpose. The request body is built by src/lib/askModel.ts so
 * the two transports cannot drift; this only checks the caller, enforces the
 * model and a token ceiling, and forwards.
 *
 * Redeploy after changing this. The app tells you when it is running an older
 * copy: a streamed request that comes back as one buffered reply is reported
 * as "ask-model did not stream", rather than silently losing the streaming.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/* One user, one app. Pinned here so a stolen session cannot run up a bill on a
   bigger model or a huge completion than the app ever asks for. */
const ALLOWED_MODELS = new Set(['claude-sonnet-5']);
const MAX_TOKENS_CEILING = 16000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const isEventStream = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').includes('text/event-stream');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on the function' }, 500);

  // Who is calling. Without this the function is an open proxy to a paid API.
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Not signed in' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authorization } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: 'Not signed in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body is not JSON' }, 400);
  }

  if (typeof body.model !== 'string' || !ALLOWED_MODELS.has(body.model)) {
    return json({ error: `model must be one of ${[...ALLOWED_MODELS].join(', ')}` }, 400);
  }
  const maxTokens = Number(body.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_CEILING) {
    return json({ error: `max_tokens must be 1..${MAX_TOKENS_CEILING}` }, 400);
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  /*
   * A streamed reply is handed straight back, body and all.
   *
   * Buffering it with `await upstream.text()` — which this did — turns a
   * stream into a single late response: correct, and it throws away the only
   * thing streaming is for, because the client then waits for the last token
   * before it can show the first. The body is piped instead, and the
   * content-type comes from upstream so the client can tell a stream from an
   * error object without guessing.
   *
   * Only on a 2xx. An upstream error is JSON even when a stream was asked
   * for, and passing that through as text/event-stream would leave the client
   * parsing an error as events.
   */
  if (upstream.ok && upstream.body && isEventStream(upstream)) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
        // Nothing in between may buffer it either.
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    });
  }

  const text = await upstream.text();
  // Passed through unchanged: the client already knows how to read a Messages
  // response, and rewriting errors here would hide the real reason.
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
});
