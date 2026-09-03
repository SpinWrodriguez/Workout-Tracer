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
import { sseEvents } from './sse';

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
    system: plainSystem(options.system),
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
 * The system prompt, uncached on purpose.
 *
 * It used to carry a cache breakpoint, on the theory that a second call within
 * the window would read the rules back at a tenth of the price. Measured on
 * real use, that second call almost never came: one generation showed 10,637
 * tokens written to the cache and 0 read. A cache write costs 1.25x input, so
 * caching was making every generation about 25% MORE expensive than not
 * caching at all — a discount on a call that never happened.
 *
 * The prefix is also less stable than it looked: the library is sliced to the
 * focus being generated and the coach's context carries today's data, so
 * consecutive calls rarely share a prefix even when they are close together.
 */
function plainSystem(text: string): unknown[] {
  return [{ type: 'text', text }];
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
    system: plainSystem(options.system),
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
 * One attempt at one transport, before anyone decides what shape of answer
 * they wanted. `value` is a whole reply for a normal call and a body to read
 * for a streamed one; making it generic is what keeps the fallback rules below
 * written once instead of once per kind of request.
 */
interface Attempt<T> {
  value?: T;
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

async function viaEdge(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Attempt<unknown>> {
  const client = await getSupabase();
  if (!client) return { transport: 'edge', error: 'Supabase is not configured.' };
  const started = Date.now();
  const { data, error } = await client.functions.invoke(EDGE_FUNCTION, { body });
  const ms = Date.now() - started;
  if (error) return { transport: 'edge', error: await edgeFailure(error), ms };
  if (signal?.aborted) return { transport: 'edge', error: 'Cancelled.', ms };
  return hasContent(data)
    ? { value: data, transport: 'edge', ms }
    : { transport: 'edge', error: 'Empty reply.', ms };
}

async function viaDeviceKey(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Attempt<unknown>> {
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
    ? { value: payload, transport: 'device-key', ms }
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
 *
 * Generic over what an attempt returns so the streamed and unstreamed paths
 * cannot disagree about when the relay is considered down — the rule that the
 * AI buttons appear or disappear on.
 */
async function dispatch<T>(
  edge: () => Promise<Attempt<T>>,
  device: (key: string) => Promise<Attempt<T>>,
): Promise<Attempt<T>> {
  const key = readApiKey();

  if (isSupabaseConfigured() && !edgeDown) {
    try {
      const result = await edge();
      if (result.value) return result;
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
    return await device(key);
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
  const body = buildRequest(options);
  const raw = await dispatch<unknown>(
    () => viaEdge(body, options.signal),
    (key) => viaDeviceKey(body, key, options.signal, fetchImpl),
  );
  if (!raw.value) return { transport: raw.transport, error: raw.error, ms: raw.ms };
  const text = textOf(raw.value);
  return text
    ? { text, transport: raw.transport, usage: usageOf(raw.value), ms: raw.ms }
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
  const body = buildConversationRequest(options);
  const raw = await dispatch<unknown>(
    () => viaEdge(body, options.signal),
    (key) => viaDeviceKey(body, key, options.signal, fetchImpl),
  );
  if (!raw.value) {
    return { toolCalls: [], transport: raw.transport, error: raw.error, ms: raw.ms };
  }
  const content = (raw.value as { content?: unknown[] }).content ?? [];
  const stop = (raw.value as { stop_reason?: unknown }).stop_reason;
  return {
    content,
    text: textOf(raw.value),
    toolCalls: toolCallsOf(content),
    stopReason: typeof stop === 'string' ? stop : undefined,
    transport: raw.transport,
    usage: usageOf(raw.value),
    ms: raw.ms,
  };
}

/* --- streaming ------------------------------------------------------------ */

/*
 * Why the chat streams and the generators do not.
 *
 * A generated workout is JSON nothing can use until it is complete and
 * validated, so streaming it would only animate a wait. An answer to a
 * question is prose, and prose is readable from its first line — which matters
 * here because a question needing a lookup is two or three serial round trips,
 * and the difference between watching a spinner for all of it and reading the
 * first sentence while the rest arrives is the difference between the feature
 * feeling slow and feeling immediate.
 */

async function viaEdgeStream(
  body: Record<string, unknown>,
): Promise<Attempt<ReadableStream<Uint8Array>>> {
  const client = await getSupabase();
  if (!client) return { transport: 'edge', error: 'Supabase is not configured.' };
  const { data, error } = await client.functions.invoke(EDGE_FUNCTION, { body });
  if (error) return { transport: 'edge', error: await edgeFailure(error) };
  /*
   * supabase-js hands back the Response itself for text/event-stream, and
   * parses anything else. So a non-stream here means the relay answered with
   * something that is not a stream — an older deploy that reads the whole
   * upstream reply — and the caller should fall through rather than guess.
   */
  if (!(data instanceof Response) || !data.body) {
    return {
      transport: 'edge',
      error: 'ask-model did not stream. Redeploy it from supabase/functions/ask-model.',
    };
  }
  return { value: data.body, transport: 'edge' };
}

async function viaDeviceKeyStream(
  body: Record<string, unknown>,
  key: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Attempt<ReadableStream<Uint8Array>>> {
  const response = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
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
  if (!response.body) return { transport: 'device-key', error: 'Empty reply.' };
  return { value: response.body, transport: 'device-key' };
}

/** A block being assembled out of deltas. */
interface Building {
  block: Record<string, unknown>;
  /** Tool input arrives as JSON in pieces, and is only parseable once. */
  json?: string;
}

function numberAt(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Reads a stream into the same turn a normal call would have returned, calling
 * `onText` with each piece of prose as it arrives.
 *
 * The assembled `content` is what gets replayed as the next request's
 * assistant message, so it has to be faithful rather than merely readable:
 * a thinking block's signature arrives in its own deltas and is carried
 * through, because a turn replayed without it is not the turn that happened.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onText: ((delta: string) => void) | undefined,
): Promise<{ content: unknown[]; stopReason?: string; usage: AskUsage; error?: string }> {
  const building = new Map<number, Building>();
  const order: number[] = [];
  let stopReason: string | undefined;
  const usage: AskUsage = {};
  let error: string | undefined;

  for await (const event of sseEvents(body)) {
    if (typeof event !== 'object' || event === null) continue;
    const row = event as Record<string, unknown>;

    switch (row.type) {
      case 'message_start': {
        const message = row.message as { usage?: unknown } | undefined;
        usage.inputTokens = numberAt(message?.usage, 'input_tokens');
        usage.cacheReadTokens = numberAt(message?.usage, 'cache_read_input_tokens');
        usage.cacheWriteTokens = numberAt(message?.usage, 'cache_creation_input_tokens');
        usage.outputTokens = numberAt(message?.usage, 'output_tokens');
        break;
      }
      case 'content_block_start': {
        const index = numberAt(row, 'index') ?? order.length;
        const block = { ...((row.content_block as Record<string, unknown>) ?? {}) };
        building.set(index, { block, json: block.type === 'tool_use' ? '' : undefined });
        order.push(index);
        break;
      }
      case 'content_block_delta': {
        const index = numberAt(row, 'index');
        const current = index === undefined ? undefined : building.get(index);
        const delta = row.delta as Record<string, unknown> | undefined;
        if (!current || !delta) break;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          current.block.text = `${String(current.block.text ?? '')}${delta.text}`;
          onText?.(delta.text);
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          current.block.thinking = `${String(current.block.thinking ?? '')}${delta.thinking}`;
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          current.block.signature = `${String(current.block.signature ?? '')}${delta.signature}`;
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          current.json = `${current.json ?? ''}${delta.partial_json}`;
        }
        break;
      }
      case 'content_block_stop': {
        const index = numberAt(row, 'index');
        const current = index === undefined ? undefined : building.get(index);
        if (!current || current.json === undefined) break;
        try {
          current.block.input = current.json === '' ? {} : JSON.parse(current.json);
        } catch {
          /* Tool arguments that do not parse are not usable, and calling the
             tool with half of them would be worse than not calling it. */
          error = 'The model sent tool arguments that were not valid JSON.';
        }
        break;
      }
      case 'message_delta': {
        const delta = row.delta as { stop_reason?: unknown } | undefined;
        if (typeof delta?.stop_reason === 'string') stopReason = delta.stop_reason;
        // The final count, which supersedes the one message_start carried.
        usage.outputTokens = numberAt(row.usage, 'output_tokens') ?? usage.outputTokens;
        break;
      }
      case 'error': {
        const inner = row.error as { message?: unknown } | undefined;
        error = typeof inner?.message === 'string' ? inner.message : 'The stream failed.';
        break;
      }
      default:
        break;
    }
  }

  return {
    content: order.map((index) => building.get(index)?.block).filter((block) => block !== undefined),
    stopReason,
    usage,
    error,
  };
}

/**
 * One streamed turn of a tool-using conversation. Same result as
 * `askConversation`, assembled as it arrives.
 */
export async function streamConversation(
  options: ConversationOptions,
  onText?: (delta: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversationResult> {
  const body = { ...buildConversationRequest(options), stream: true };
  const started = Date.now();
  const raw = await dispatch<ReadableStream<Uint8Array>>(
    () => viaEdgeStream(body),
    (key) => viaDeviceKeyStream(body, key, options.signal, fetchImpl),
  );
  if (!raw.value) {
    return {
      toolCalls: [],
      transport: raw.transport,
      error: raw.error,
      ms: Date.now() - started,
    };
  }

  try {
    const read = await readStream(raw.value, onText);
    const ms = Date.now() - started;
    if (read.error) {
      return { toolCalls: [], transport: raw.transport, error: read.error, usage: read.usage, ms };
    }
    return {
      content: read.content,
      text: read.content
        .map((block) =>
          typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
            ? String((block as { text?: unknown }).text ?? '')
            : '',
        )
        .join('')
        .trim() || undefined,
      toolCalls: toolCallsOf(read.content),
      stopReason: read.stopReason,
      transport: raw.transport,
      usage: read.usage,
      ms,
    };
  } catch (cause) {
    /* A dropped connection mid-answer. Whatever arrived is not a turn that
       can be replayed, so it is reported rather than half-kept. */
    return {
      toolCalls: [],
      transport: raw.transport,
      error: cause instanceof Error ? cause.message : String(cause),
      ms: Date.now() - started,
    };
  }
}
