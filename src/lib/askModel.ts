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

/*
 * Sonnet 5. Structured outputs and adaptive thinking both need a current
 * model; within those, this is the cheapest one that reliably holds a 73-row
 * constrained selection together. Roughly a third of Opus 5 per generation,
 * which for twenty workouts a month is the difference between a $5 top-up
 * lasting a few months and lasting most of a year.
 *
 * Changing this means changing ALLOWED_MODELS in the Edge Function too, or the
 * relay rejects the request. askModel.test.ts asserts the two agree.
 */
export const MODEL = 'claude-sonnet-5';
export const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const EDGE_FUNCTION = 'ask-model';
export const API_KEY_STORAGE_KEY = 'workout-model-key';

export type Transport = 'edge' | 'device-key' | 'none';

/*
 * Whether the Edge Function has been found not to answer THIS session.
 *
 * Configuring Supabase is not the same as deploying the relay, and there is no
 * way to tell them apart without calling it — which must not happen on open.
 * So the app assumes the relay is there, and remembers when it is not: the AI
 * buttons then disappear and Settings says generation is off, instead of
 * offering a feature nothing can serve.
 *
 * In memory rather than storage on purpose. A reload retries, so deploying the
 * function is picked up by reopening the app and never needs clearing by hand.
 */
let edgeDown = false;

export interface AskOptions {
  /** Stable, cached prefix: the rules and the exercise library. */
  system: string;
  /** Volatile: the goal and what the block already holds. */
  user: string;
  /** JSON schema the reply is constrained to. */
  schema: unknown;
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
  // Changing the key is a reason to try the relay again: whatever was wrong
  // with it may have been fixed in the meantime.
  resetTransportProbe();
}

/**
 * Which transport would be used. The Edge Function is assumed available when
 * Supabase is configured — whether it is actually deployed is only knowable by
 * calling it, and a failed call falls through to the device key anyway.
 */
export function availableTransport(): Transport {
  if (isSupabaseConfigured() && !edgeDown) return 'edge';
  if (readApiKey()) return 'device-key';
  return 'none';
}

/** True when Supabase is configured but its relay did not answer. */
export function edgeUnavailable(): boolean {
  return edgeDown;
}

/** Test seam, and what saving a key calls to give the relay another chance. */
export function resetTransportProbe(): void {
  edgeDown = false;
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
    ...shared(options.maxTokens ?? 8000),
    output_config: {
      /*
       * Low, not medium. This is constrained selection from a fixed 71-row
       * list with a validator recomputing every pick behind it — not
       * open-ended reasoning. At medium the measured output was 1,000-2,600
       * tokens for a workout whose JSON is about two hundred, so the thinking
       * was most of a twelve-second wait. Raise it if the picks get worse;
       * the numbers to judge that by are in Settings.
       */
      effort: 'low',
      /*
       * type and schema, and nothing else. An extra key here — a `name` for the
       * schema, which seemed harmless — is an unknown field, and the Messages
       * API rejects the whole request rather than ignoring it.
       */
      format: { type: 'json_schema', schema: options.schema },
    },
    system: cachedSystem(options.system),
    messages: [
      { role: 'user', content: options.user },
      ...(options.priorTurns ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    ],
  };
}

/** What both shapes send. Split out so the two cannot drift on the model. */
function shared(maxTokens: number): Record<string, unknown> {
  return { model: MODEL, max_tokens: maxTokens, thinking: { type: 'adaptive' } };
}

/*
 * The cache breakpoint. Everything before it is identical between calls of the
 * same kind, so a second question in the same minute reads the rules back at a
 * tenth of the price instead of paying for them again.
 */
function cachedSystem(text: string): unknown[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

/**
 * One turn of a conversation that can call tools.
 *
 * Deliberately not the same entry point as `buildRequest`: a constrained JSON
 * answer and a conversation are different requests, and folding them into one
 * builder full of optional keys is how an unsupported field gets sent by
 * accident. That already cost an afternoon once, when `output_config.format`
 * carried a `name` the API rejected outright.
 */
export interface ConversationOptions {
  /** Cached prefix: the rules and what the app already knows. */
  system: string;
  /**
   * The whole conversation so far, wire-shaped: assistant turns are the
   * `content` arrays that came back, replayed unchanged. Thinking blocks are
   * part of that content and are echoed back as they arrived, which is what
   * the API asks for when continuing on the same model.
   */
  messages: unknown[];
  /** What the model may call. Executed by the app, never by the API. */
  tools: unknown[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export function buildConversationRequest(options: ConversationOptions): Record<string, unknown> {
  return {
    ...shared(options.maxTokens ?? 4000),
    /*
     * No `format`: the reply is prose for a person to read, and a schema would
     * also bar the tool_use blocks this whole shape exists for. `effort` still
     * applies — it is thinking depth, not output shape.
     */
    output_config: { effort: 'low' },
    system: cachedSystem(options.system),
    tools: options.tools,
    messages: options.messages,
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

/** What one call cost and how long it took. Reported, never guessed at. */
export interface AskUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AskResult {
  text?: string;
  transport: Transport;
  /** Set when the call was attempted and failed, for the UI to show once. */
  error?: string;
  usage?: AskUsage;
  /** Round trip in milliseconds, measured here rather than inferred. */
  ms?: number;
}

/*
 * The output token count is the whole latency story on a thinking model: the
 * JSON for a four-exercise workout is a couple of hundred tokens, so an
 * output of two thousand is nine parts reasoning to one part answer. Without
 * this the only evidence was "it feels slow".
 */
function usageOf(payload: unknown): AskUsage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const read = (key: string): number | undefined => {
    const value = (usage as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : undefined;
  };
  return {
    inputTokens: read('input_tokens'),
    outputTokens: read('output_tokens'),
    cacheReadTokens: read('cache_read_input_tokens'),
    cacheWriteTokens: read('cache_creation_input_tokens'),
  };
}

/**
 * What the relay actually said.
 *
 * supabase-js reports every failed status as "Edge Function returned a non-2xx
 * status code" and puts the real response on `error.context`. That message is
 * useless for the five distinct things that can be wrong — no key on the
 * function, not signed in, a model the relay does not allow, too many tokens,
 * or Anthropic itself refusing — and the relay is deliberately a pass-through
 * so that the real reason is available. Reading it is the difference between a
 * one-minute fix and an afternoon.
 */
async function edgeFailure(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context;
  if (!(context instanceof Response)) return error.message;
  const status = `${context.status}${context.statusText ? ` ${context.statusText}` : ''}`;
  let detail = '';
  try {
    const body = await context.clone().text();
    if (body) {
      // The relay answers {"error": "..."}; Anthropic nests its own message.
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        const inner =
          typeof parsed.error === 'string'
            ? parsed.error
            : (parsed.error as { message?: string } | undefined)?.message;
        detail = inner ?? body;
      } catch {
        detail = body;
      }
    }
  } catch {
    // A body that cannot be read is not worth failing over.
  }
  return `ask-model ${status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`;
}

/*
 * The raw reply, before anyone decides what shape of answer they wanted. Both
 * transports return this and both entry points read it, so the fallback logic
 * below is written once rather than once per kind of request.
 */
interface RawResult {
  payload?: unknown;
  transport: Transport;
  error?: string;
  ms?: number;
}

/** Whether a reply carries content at all, which is what "answered" means. */
function hasContent(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { content?: unknown }).content)
  );
}

async function viaEdge(body: Record<string, unknown>, signal?: AbortSignal): Promise<RawResult> {
  const client = await getSupabase();
  if (!client) return { transport: 'edge', error: 'Supabase is not configured.' };
  const started = Date.now();
  const { data, error } = await client.functions.invoke(EDGE_FUNCTION, { body });
  const ms = Date.now() - started;
  if (error) return { transport: 'edge', error: await edgeFailure(error), ms };
  if (signal?.aborted) return { transport: 'edge', error: 'Cancelled.', ms };
  return hasContent(data)
    ? { payload: data, transport: 'edge', ms }
    : { transport: 'edge', error: 'Empty reply.', ms };
}

async function viaDeviceKey(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<RawResult> {
  const started = Date.now();
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
      ms: Date.now() - started,
    };
  }
  const payload: unknown = await response.json();
  const ms = Date.now() - started;
  return hasContent(payload)
    ? { payload, transport: 'device-key', ms }
    : { transport: 'device-key', error: 'Empty reply.', ms };
}

/** Joins an upstream message to our own advice without running the two together. */
function withStop(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/*
 * The Edge Function first, a pasted key second. Never throws: a caller that
 * cannot get an answer carries on without one.
 */
async function dispatch(
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<RawResult> {
  const key = readApiKey();

  if (isSupabaseConfigured() && !edgeDown) {
    try {
      const result = await viaEdge(body, signal);
      if (result.payload) return result;
      /*
       * Configured but not answering — most likely never deployed. Remembered
       * so the UI stops offering AI it cannot deliver, and so the next
       * generation does not pay for the same round trip again.
       */
      edgeDown = true;
      if (!key) {
        return {
          ...result,
          error: `${withStop(result.error ?? 'The ask-model function did not answer')} Deploy it, or paste a key in Settings.`,
        };
      }
    } catch (cause) {
      edgeDown = true;
      if (!key) {
        return {
          transport: 'edge',
          error: `${withStop(cause instanceof Error ? cause.message : String(cause))} Deploy ask-model, or paste a key in Settings.`,
        };
      }
    }
  }

  if (!key) return { transport: 'none', error: 'No model key set.' };

  try {
    return await viaDeviceKey(body, key, signal, fetchImpl);
  } catch (cause) {
    return {
      transport: 'device-key',
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Asks the model, preferring the Edge Function and falling back to a pasted
 * key. Never throws: a caller that cannot get an answer carries on without one.
 */
export async function askModel(
  options: AskOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<AskResult> {
  const raw = await dispatch(buildRequest(options), options.signal, fetchImpl);
  if (!raw.payload) return { transport: raw.transport, error: raw.error, ms: raw.ms };
  const text = textOf(raw.payload);
  return text
    ? { text, transport: raw.transport, usage: usageOf(raw.payload), ms: raw.ms }
    : { transport: raw.transport, error: 'Empty reply.', ms: raw.ms };
}

/** One tool_use block, as the API sent it. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ConversationResult {
  /**
   * The assistant turn exactly as it arrived, to be replayed as the next
   * request's assistant message. Not rebuilt from the parts below: a turn
   * carries thinking blocks that have to go back unchanged, and rebuilding it
   * would quietly drop them.
   */
  content?: unknown[];
  /** The prose, if any. A turn that only calls a tool has none. */
  text?: string;
  /** What it wants run. Non-empty exactly when stopReason is 'tool_use'. */
  toolCalls: ToolCall[];
  stopReason?: string;
  transport: Transport;
  error?: string;
  usage?: AskUsage;
  ms?: number;
}

function toolCallsOf(content: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const row = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (row.type !== 'tool_use') continue;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    calls.push({ id: row.id, name: row.name, input: row.input });
  }
  return calls;
}

/**
 * One turn of a tool-using conversation. The caller owns the loop, because the
 * loop is where the app's own rules live: which tools exist, how many rounds
 * are worth paying for, and what to do with an answer.
 */
export async function askConversation(
  options: ConversationOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationResult> {
  const raw = await dispatch(buildConversationRequest(options), options.signal, fetchImpl);
  if (!raw.payload) {
    return { toolCalls: [], transport: raw.transport, error: raw.error, ms: raw.ms };
  }
  const content = (raw.payload as { content?: unknown[] }).content ?? [];
  const stop = (raw.payload as { stop_reason?: unknown }).stop_reason;
  return {
    content,
    text: textOf(raw.payload),
    toolCalls: toolCallsOf(content),
    stopReason: typeof stop === 'string' ? stop : undefined,
    transport: raw.transport,
    usage: usageOf(raw.payload),
    ms: raw.ms,
  };
}
