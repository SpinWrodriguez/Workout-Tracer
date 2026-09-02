import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The edge branch only runs when a Supabase project is configured, which is a
 * build-time env var and absent here. Mocked so the fallback can be exercised
 * at all — without it these tests silently pass by never taking the branch.
 */
const supabase = { configured: false };
vi.mock('./supabaseSource', () => ({
  isSupabaseConfigured: () => supabase.configured,
  getSupabase: async () => undefined,
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
  schemaName: 'workout',
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
    const output = body.output_config as { format?: { type?: string; name?: string } };
    expect(output.format?.type).toBe('json_schema');
    expect(output.format?.name).toBe('workout');
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
