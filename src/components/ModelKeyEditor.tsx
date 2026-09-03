import { useEffect, useState } from 'react';
import {
  API_KEY_STORAGE_KEY,
  MODEL,
  availableTransport,
  edgeUnavailable,
  readApiKey,
  writeApiKey,
} from '../lib/askModel';
import { isSupabaseConfigured } from '../lib/supabaseSource';
import {
  AI_INSTRUCTIONS_MAX,
  readAiInstructions,
  readLastModelCall,
  writeAiInstructions,
  type LastModelCall,
} from '../db/settings';
import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  The fallback transport, and it says what it costs you.                     */
/*                                                                            */
/*  There is no way to keep a key secret in a client-side PWA. This one lives  */
/*  in localStorage on this device: it works with no deploy, and anything that */
/*  can read this origin's storage can read it. The Edge Function is the        */
/*  version that does not have that property, so when it is available this     */
/*  card leads with it rather than burying the choice.                         */
/* -------------------------------------------------------------------------- */

/**
 * What the lifter is training for, in their own words, read on every
 * generation. Kept in the database rather than localStorage: unlike the key
 * this is real content that belongs in a backup and should follow them to
 * another device. Changing it changes the next workout with nothing else to do.
 */
export function AiInstructionsEditor() {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readAiInstructions().then((stored) => {
      if (cancelled) return;
      setText(stored);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card
      title="Your goals"
      collapsible
      summary={loaded ? (text.trim() ? text.trim().split('\n')[0] : 'nothing set') : '--'}
    >
      <p className="text-[13px] text-text-dim">
        What does not change week to week: what you are training for, what you are working
        around, what you would rather not do. Read on every generation, so editing this
        changes the next workout.
      </p>
      <textarea
        rows={5}
        value={text}
        disabled={!loaded}
        maxLength={AI_INSTRUCTIONS_MAX}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        placeholder={
          'Building muscle while losing fat slowly. Golf matters more than the gym — protect the swing.\n\nLeft shoulder is cranky overhead. Prefer barbell and cable work over machines.'
        }
        className="mt-3 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] leading-snug placeholder:text-text-faint"
      />
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <Label>
          {text.length}/{AI_INSTRUCTIONS_MAX}
        </Label>
        <Label>Included in a backup.</Label>
      </div>
      <button
        type="button"
        disabled={!loaded}
        onClick={() => {
          void writeAiInstructions(text);
          setSaved(true);
        }}
        className="mt-3 h-11 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
      >
        {saved ? 'Saved' : 'Save goals'}
      </button>
    </Card>
  );
}

/*
 * Sonnet 5 list prices, per million tokens. Four rates, not two: a cached read
 * is a tenth of a fresh input token and a cache write is a quarter more, so
 * charging everything at the input rate would misreport the one number this
 * card exists to tell the truth about. `input_tokens` from the API already
 * excludes what was read from cache, so these four do not double count.
 */
const PER_MTOK = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 };

function centsFor(call: LastModelCall): string {
  const dollars =
    ((call.inputTokens ?? 0) * PER_MTOK.input +
      (call.outputTokens ?? 0) * PER_MTOK.output +
      (call.cacheWriteTokens ?? 0) * PER_MTOK.cacheWrite +
      (call.cacheReadTokens ?? 0) * PER_MTOK.cacheRead) /
    1_000_000;
  return `${(dollars * 100).toFixed(1)}c`;
}

export function ModelKeyEditor() {
  const [key, setKey] = useState(() => readApiKey() ?? '');
  const [saved, setSaved] = useState(false);
  const [last, setLast] = useState<LastModelCall | undefined>(undefined);

  useEffect(() => {
    void readLastModelCall().then(setLast);
  }, []);
  const transport = availableTransport();
  const edge = isSupabaseConfigured();
  const edgeFailed = edgeUnavailable();

  const save = () => {
    writeApiKey(key);
    setSaved(true);
  };

  return (
    <Card
      title="AI workout generation"
      collapsible
      summary={
        transport === 'edge'
          ? 'Server-side key'
          : transport === 'device-key'
            ? 'Key on this device'
            : 'Off — no key'
      }
    >
      <p className="text-[13px] text-text-dim">
        Unlocks "Build the week with AI" and the AI options on the Program tab. The model only
        proposes — every pick is rechecked against your plates, your rules and your calendar
        before it lands.
      </p>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Label>Currently using</Label>
        <span className="text-[14px] font-medium">
          {transport === 'edge'
            ? 'Server-side key'
            : transport === 'device-key'
              ? 'Key on this device'
              : 'Nothing — generation is off'}
        </span>
      </div>

      {edge && edgeFailed ? (
        <p className="mt-3 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
          The <code>ask-model</code> function did not answer, so it is probably not deployed —
          see <code>docs/EDGE-FUNCTION.md</code>. Reopening the app tries it again. A key below
          works right now either way.
        </p>
      ) : edge ? (
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Supabase is configured, so the app calls the <code>ask-model</code> Edge Function and
          the key never reaches this device. Deploy it from{' '}
          <code>supabase/functions/ask-model</code> — not yet confirmed from here, since
          checking means calling it. A key below is the fallback.
        </p>
      ) : (
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          No Supabase project in this build, so a key on this device is the only option.
        </p>
      )}

      {transport === 'none' && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <p className="text-[12px] leading-relaxed font-medium">
            To turn it on: make a key at <code>console.anthropic.com</code> → API keys, put
            about $5 of credit on it under Billing, then paste it below. A workout costs
            roughly 3 cents, so that lasts months.
          </p>
        </div>
      )}

      <label className="mt-4 block">
        <Label>Anthropic API key (this device only)</Label>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setSaved(false);
          }}
          placeholder="sk-ant-..."
          className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium placeholder:text-text-faint"
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setKey('');
            writeApiKey(undefined);
            setSaved(true);
          }}
          className="h-11 flex-1 rounded-full bg-surface-2 font-medium text-text-dim"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={save}
          className="h-11 flex-[2] rounded-full bg-cta font-semibold text-bg"
        >
          {saved ? 'Saved' : 'Save key'}
        </button>
      </div>

      <p className="mt-3 text-[12px] font-medium text-text-dim">
        Kept in this browser as <code>{API_KEY_STORAGE_KEY}</code>, never backed up or synced,
        so enter it again on each device. Uses {MODEL}: one call per workout you ask for, never
        on open.
      </p>

      {/* Measured, not estimated. Output tokens are the latency: the JSON for a
          workout is a couple of hundred, so a big number there is reasoning.
          A cache read of zero means the exercise library is being re-billed
          on every call. */}
      {last && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <Label>Last generation</Label>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-text-dim">
              {(last.ms / 1000).toFixed(1)}s
              {last.attempts > 1 ? ` · ${last.attempts} attempts` : ''}
            </span>
            <span className="text-[13px] font-semibold">{centsFor(last)}</span>
          </div>
          <p className="mt-1 text-[12px] font-medium text-text-dim">
            {last.inputTokens ?? 0} in · {last.outputTokens ?? 0} out
            {/* Only worth a word when there is one. Prompt caching is off —
                it was writing a cache nothing read, which costs more than not
                caching — so a nonzero figure here means an older build. */}
            {last.cacheReadTokens ? ` · ${last.cacheReadTokens} cached` : ''}
            {last.cacheWriteTokens ? ` · ${last.cacheWriteTokens} written to cache` : ''}
          </p>
        </div>
      )}
    </Card>
  );
}
