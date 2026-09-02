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
