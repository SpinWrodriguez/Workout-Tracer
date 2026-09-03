import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The edge branch only runs when a Supabase project is configured, which is a
 * build-time env var and absent here. Mocked so the fallback can be exercised
 * at all — without it these tests silently pass by never taking the branch.
 */
const supabase = { configured: false };
/* What functions.invoke returns. Undefined means "no client at all", which is
   how an unconfigured project behaves. */
let invokeResult: { data: unknown; error: unknown } | undefined;
vi.mock('./supabaseSource', () => ({
  isSupabaseConfigured: () => supabase.configured,
  getSupabase: async () =>
    invokeResult === undefined
      ? undefined
      : { functions: { invoke: async () => invokeResult } },
}));
import {
  ANTHROPIC_VERSION,
  MODEL,
  askModel,
  buildConversationRequest,
  streamConversation,
  availableTransport,
  buildRequest,
  edgeUnavailable,
  resetTransportProbe,
  writeApiKey,
} from './askModel';

/*
 * The Edge Function pins the model it will relay, so the client and the relay
 * are two places holding one fact. Changing the model in one and not the other
 * turns every generation into a 400 that only shows up on the deployed app —
 * exactly the failure the user cannot debug from a phone in a garage.
 */
const EDGE_SOURCE = readFileSync('supabase/functions/ask-model/index.ts', 'utf8');

const options = {
  system: 'rules and library',
  user: 'a goal',
  schema: { type: 'object' },
};

const conversation = { system: 'rules', messages: [], tools: [] };

/*
 * localStorage does not exist in node. A shim keeps these tests here rather
 * than pulling in jsdom for a handful of string operations.
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

const failingFetch = () =>
  (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

const okFetch = (text: string) =>
  (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text }] }),
      text: async () => '',
    }) as unknown as Response) as unknown as typeof fetch;

describe('what the app offers when the relay is not there', () => {
  /*
   * Configuring Supabase is not deploying the relay, and the app cannot tell
   * them apart without calling it — which must never happen on open. So it
   * assumes the relay is there and corrects itself on the first failure.
   * Before this, the AI buttons appeared on a phone where nothing could
   * possibly serve them.
   */
  beforeEach(() => {
    resetTransportProbe();
    localStorage.clear();
    supabase.configured = true;
    invokeResult = undefined;
  });

  it('offers nothing once the relay has failed and no key is set', async () => {
    // Configured, so the app assumes the relay is there and offers AI.
    expect(availableTransport()).toBe('edge');

    const result = await askModel(options, failingFetch());

    // getSupabase returns nothing here, which is exactly what an undeployed
    // relay looks like from the client: configured, but no answer.
    expect(result.error).toMatch(/Deploy it, or paste a key in Settings/);
    expect(edgeUnavailable()).toBe(true);
    expect(availableTransport()).toBe('none');
  });

  it('falls through to a pasted key instead, when there is one', async () => {
    writeApiKey('sk-ant-test');
    const result = await askModel(options, okFetch('a reply'));
    expect(result.transport).toBe('device-key');
    expect(result.text).toBe('a reply');
  });

  it('gives the relay another chance when a key is saved', async () => {
    await askModel(options, failingFetch());
    expect(edgeUnavailable()).toBe(true);
    writeApiKey('sk-ant-test');
    // Whatever was wrong with the relay may have been fixed since.
    expect(edgeUnavailable()).toBe(false);
  });

  it('does not spend a second round trip on a relay already known to be down', async () => {
    await askModel(options, failingFetch());
    writeApiKey('sk-ant-test');
    resetTransportProbe();

    // First call finds the relay down and falls through to the key.
    const first = await askModel(options, okFetch('one'));
    expect(first.transport).toBe('device-key');
    expect(edgeUnavailable()).toBe(true);
    // Second goes straight to the key.
    const second = await askModel(options, okFetch('two'));
    expect(second.text).toBe('two');
  });
});

describe('what the relay said when it refused', () => {
  /*
   * supabase-js reports every non-2xx as one generic sentence and hides the
   * response on error.context. Five different things can be wrong with the
   * relay and that sentence distinguishes none of them.
   */
  beforeEach(() => {
    resetTransportProbe();
    localStorage.clear();
    supabase.configured = true;
  });

  const refuse = (status: number, body: string) => {
    invokeResult = {
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(body, { status, statusText: '' }),
      }),
    };
  };

  it('reports the status and the relay\'s own reason', async () => {
    refuse(400, JSON.stringify({ error: 'model must be one of claude-opus-5' }));
    const result = await askModel(options, failingFetch());
    expect(result.error).toContain('ask-model 400');
    expect(result.error).toContain('model must be one of claude-opus-5');
  });

  it('unwraps a message nested the way Anthropic nests one', async () => {
    refuse(401, JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    const result = await askModel(options, failingFetch());
    expect(result.error).toContain('invalid x-api-key');
  });

  it('passes a non-JSON body through rather than swallowing it', async () => {
    refuse(500, 'ANTHROPIC_API_KEY is not set on the function');
    const result = await askModel(options, failingFetch());
    expect(result.error).toContain('ANTHROPIC_API_KEY is not set');
  });

  it('falls back to the generic message when there is no response to read', async () => {
    invokeResult = { data: null, error: new Error('Failed to fetch') };
    const result = await askModel(options, failingFetch());
    expect(result.error).toContain('Failed to fetch');
  });
});

describe('prompt caching', () => {
  it('is not asked for, on either shape of request', () => {
    /* Measured, not assumed: one real generation wrote 10,637 tokens to the
       cache and read 0. A write costs 1.25x input, so the cache was a 25%
       surcharge for a discount on a second call that never came. */
    const json = JSON.stringify([buildRequest(options), buildConversationRequest(conversation)]);
    expect(json).not.toContain('cache_control');
    expect(json).not.toContain('ephemeral');
  });
});

describe('the model the app asks for', () => {
  it('is one the Edge Function will relay', () => {
    const allowed = EDGE_SOURCE.match(/ALLOWED_MODELS = new Set\(\[([^\]]*)\]\)/)?.[1];
    expect(allowed, 'ALLOWED_MODELS not found — the relay was restructured').toBeDefined();
    const models = [...(allowed ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(models).toContain(MODEL);
  });

  it('is sent on the request rather than left to the relay to choose', () => {
    expect(buildRequest(options).model).toBe(MODEL);
  });

  it('is asked for a JSON reply with adaptive thinking and no token budget', () => {
    // budget_tokens is rejected outright by current models; adaptive is the
    // only on-mode. A stale prior here is a 400 on every generation.
    const body = buildRequest(options);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
    const output = body.output_config as { format?: Record<string, unknown> };
    expect(output.format?.type).toBe('json_schema');
    /* type and schema only. An unknown field in output_config.format fails the
       whole request, which is what a hand-built body has to get exactly right. */
    expect(Object.keys(output.format ?? {}).sort()).toEqual(['schema', 'type']);
  });

  it('agrees with the relay on the API version, which is not negotiated', () => {
    expect(EDGE_SOURCE).toContain(`ANTHROPIC_VERSION = '${ANTHROPIC_VERSION}'`);
  });

  it('stays under the relay ceiling on the default completion size', () => {
    const ceiling = Number(EDGE_SOURCE.match(/MAX_TOKENS_CEILING = (\d+)/)?.[1]);
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(Number(buildRequest(options).max_tokens)).toBeLessThanOrEqual(ceiling);
  });
});

/* -------------------------------------------------------------------------- */
/*  Streaming                                                                */
/*                                                                           */
/*  The assembler is the only place in the app that has to reconstruct a      */
/*  message out of pieces, and everything it gets wrong is invisible: a       */
/*  dropped signature or a half-parsed tool argument produces a turn that     */
/*  looks fine and is rejected, or worse, silently changes what was asked.    */
/* -------------------------------------------------------------------------- */

/** A body that delivers these events as SSE records. */
const sseFetch = (events: unknown[]) =>
  (async () =>
    ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      }),
      text: async () => '',
    }) as unknown as Response) as unknown as typeof fetch;

describe('a streamed turn', () => {
  beforeEach(() => {
    supabase.configured = false;
    resetTransportProbe();
    writeApiKey('sk-ant-test');
  });

  it('asks for a stream', async () => {
    let body: Record<string, unknown> = {};
    const capture = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start: (controller) => controller.close(),
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await streamConversation(conversation, undefined, capture);
    expect(body.stream).toBe(true);
  });

  it('puts the text back together and reports it as it goes', async () => {
    const deltas: string[] = [];
    const result = await streamConversation(
      conversation,
      (delta) => deltas.push(delta),
      sseFetch([
        { type: 'message_start', message: { usage: { input_tokens: 900, cache_read_input_tokens: 800 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Up ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '5kg.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
        { type: 'message_stop' },
      ]),
    );

    expect(deltas).toEqual(['Up ', '5kg.']);
    expect(result.text).toBe('Up 5kg.');
    expect(result.stopReason).toBe('end_turn');
    // Input from the opening event, output from the closing one.
    expect(result.usage).toMatchObject({ inputTokens: 900, cacheReadTokens: 800, outputTokens: 42 });
  });

  it('keeps a thinking block and its signature, so the turn can be replayed', async () => {
    const result = await streamConversation(
      conversation,
      undefined,
      sseFetch([
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      ]),
    );
    /* Replayed verbatim on the next request. A signature assembled out of its
       deltas and then dropped is a turn the API will not accept back. */
    expect(result.content).toEqual([{ type: 'thinking', thinking: 'hm', signature: 'sig' }]);
  });

  it('assembles tool arguments that arrive in pieces', async () => {
    const result = await streamConversation(
      conversation,
      undefined,
      sseFetch([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'exercise_history', input: {} },
        },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"exerc' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'iseId":"bb_back_squat"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      ]),
    );
    expect(result.toolCalls).toEqual([
      { id: 'tu_1', name: 'exercise_history', input: { exerciseId: 'bb_back_squat' } },
    ]);
  });

  it('refuses tool arguments that never became valid JSON', async () => {
    const result = await streamConversation(
      conversation,
      undefined,
      sseFetch([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'exercise_history', input: {} },
        },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"exerc' } },
        { type: 'content_block_stop', index: 0 },
      ]),
    );
    /* Calling a tool with half its arguments is worse than not calling it:
       the answer would be about an exercise nobody asked about. */
    expect(result.error).toMatch(/not valid JSON/);
    expect(result.toolCalls).toEqual([]);
  });

  it('reports an error the stream itself carried', async () => {
    const result = await streamConversation(
      conversation,
      undefined,
      sseFetch([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Up' } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]),
    );
    expect(result.error).toBe('Overloaded');
    // Not half a turn: what arrived cannot be replayed as one.
    expect(result.content).toBeUndefined();
  });

  it('says the relay needs redeploying when it answers without a stream', async () => {
    /* An older ask-model buffers the reply with `await upstream.text()`, so
       supabase-js parses it as JSON instead of handing back a body. Silently
       losing the streaming would be the easy thing to do here. */
    supabase.configured = true;
    invokeResult = { data: { content: [{ type: 'text', text: 'hi' }] }, error: null };
    writeApiKey(undefined);

    const result = await streamConversation(conversation, undefined, okFetch('unused'));
    expect(result.error).toMatch(/did not stream/);
    expect(result.error).toMatch(/Redeploy/);
    expect(edgeUnavailable()).toBe(true);
  });
});
