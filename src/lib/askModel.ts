/* -------------------------------------------------------------------------- */
/*  The one place the app talks to a model.                                    */
/*                                                                            */
/*  Two transports, because the choice is a real tradeoff and not mine to      */
/*  make silently:                                                            */
/*                                                                            */
/*   1. A Supabase Edge Function holding the key server-side, called with the  */
/*      session the app already has. Nothing secret reaches the device. Needs  */
/*      one deploy outside the Pages workflow (supabase/functions/ask-model).  */
/*   2. A key pasted into Settings, kept in localStorage. No deploy, works     */
/*      immediately, and the key is readable by anything that can read this    */
/*      origin's storage — and has to be entered again on every device.        */
/*                                                                            */
/*  The Edge Function is preferred whenever it answers. The pasted key is the  */
/*  fallback, so the feature is usable before anything is deployed and keeps    */
/*  working if the function is removed.                                        */
/*                                                                            */
/*  Everything here fails cleanly. No key, no function, no network: callers    */
/*  get `undefined` and fall back to the deterministic generator. A model is    */
/*  never load-bearing — the app has to work in a garage with no signal.       */
/* -------------------------------------------------------------------------- */

import { getSupabase, isSupabaseConfigured } from './supabaseSource';

/** Opus 5. Structured outputs and adaptive thinking both need a current model. */
export const MODEL = 'claude-opus-5';
export const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const EDGE_FUNCTION = 'ask-model';
export const API_KEY_STORAGE_KEY = 'workout-model-key';

export type Transport = 'edge' | 'device-key' | 'none';

export interface AskOptions {
  /** Stable, cached prefix: the rules and the exercise library. */
  system: string;
  /** Volatile: the goal and what the block already holds. */
  user: string;
  /** JSON schema the reply is constrained to. */
  schema: unknown;
  schemaName: string;
  /**
   * Prior turns, for the validation retry. The assistant's rejected reply and
   * the violations it has to fix, so it repairs rather than starts over.
   */
  priorTurns?: { role: 'assistant' | 'user'; content: string }[];
  maxTokens?: number;
  signal?: AbortSignal;
}

/* --- the device key -------------------------------------------------------- */

export function readApiKey(): string | undefined {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY)?.trim();
    return stored ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function writeApiKey(key: string | undefined): void {
  try {
    if (key?.trim()) localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    else localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // Blocked storage. The caller finds out from availableTransport().
  }
}

/**
 * Which transport would be used. The Edge Function is assumed available when
 * Supabase is configured — whether it is actually deployed is only knowable by
 * calling it, and a failed call falls through to the device key anyway.
 */
export function availableTransport(): Transport {
  if (isSupabaseConfigured()) return 'edge';
  if (readApiKey()) return 'device-key';
  return 'none';
}

export function isModelAvailable(): boolean {
  return availableTransport() !== 'none';
}

/* --- request shaping ------------------------------------------------------- */

/**
 * The request body, shared by both transports so the Edge Function is a pure
 * relay and cannot drift from what the device path sends.
 *
 * Ordering is load-bearing for prompt caching: `system` holds the rules and the
 * whole exercise library, identical on every call, and carries the cache
 * breakpoint. The goal and the current block go in `messages`, after it.
 */
export function buildRequest(options: AskOptions): Record<string, unknown> {
  return {
    model: MODEL,
    max_tokens: options.maxTokens ?? 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', name: options.schemaName, schema: options.schema },
    },
    system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: options.user },
      ...(options.priorTurns ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    ],
  };
}

/** The first text block, which with a json_schema format is the whole answer. */
function textOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      return (block as { text: string }).text;
    }
  }
  return undefined;
}

export interface AskResult {
  text?: string;
  transport: Transport;
  /** Set when the call was attempted and failed, for the UI to show once. */
  error?: string;
}

async function viaEdge(body: Record<string, unknown>, signal?: AbortSignal): Promise<AskResult> {
  const client = await getSupabase();
  if (!client) return { transport: 'edge', error: 'Supabase is not configured.' };
  const { data, error } = await client.functions.invoke(EDGE_FUNCTION, { body });
  if (error) return { transport: 'edge', error: error.message };
  if (signal?.aborted) return { transport: 'edge', error: 'Cancelled.' };
  const text = textOf(data);
  return text ? { text, transport: 'edge' } : { transport: 'edge', error: 'Empty reply.' };
}

async function viaDeviceKey(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AskResult> {
  const response = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for a browser to call the API directly at all.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      transport: 'device-key',
      error: `${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
    };
  }
  const text = textOf(await response.json());
  return text ? { text, transport: 'device-key' } : { transport: 'device-key', error: 'Empty reply.' };
}

/**
 * Asks the model, preferring the Edge Function and falling back to a pasted
 * key. Never throws: a caller that cannot get an answer carries on without one.
 */
export async function askModel(
  options: AskOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<AskResult> {
  const body = buildRequest(options);
  const key = readApiKey();

  if (isSupabaseConfigured()) {
    try {
      const result = await viaEdge(body, options.signal);
      if (result.text) return result;
      // The function may simply not be deployed yet; a device key still works.
      if (!key) return result;
    } catch (cause) {
      if (!key) {
        return { transport: 'edge', error: cause instanceof Error ? cause.message : String(cause) };
      }
    }
  }

  if (!key) return { transport: 'none', error: 'No model key set.' };

  try {
    return await viaDeviceKey(body, key, options.signal, fetchImpl);
  } catch (cause) {
    return {
      transport: 'device-key',
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
