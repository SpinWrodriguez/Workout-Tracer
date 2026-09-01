import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_VERSION, MODEL, buildRequest } from './askModel';

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
