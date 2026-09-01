import { useState } from 'react';
import {
  API_KEY_STORAGE_KEY,
  MODEL,
  availableTransport,
  readApiKey,
  writeApiKey,
} from '../lib/askModel';
import { isSupabaseConfigured } from '../lib/supabaseSource';
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

export function ModelKeyEditor() {
  const [key, setKey] = useState(() => readApiKey() ?? '');
  const [saved, setSaved] = useState(false);
  const transport = availableTransport();
  const edge = isSupabaseConfigured();

  const save = () => {
    writeApiKey(key);
    setSaved(true);
  };

  return (
    <Card title="AI workout generation">
      <p className="text-[13px] text-text-dim">
        Describe a session in words on the Program tab and a model picks the exercises from
        your list. It only ever proposes — every choice is recomputed against your plates,
        your rules and your calendar before it lands, and with no key or no signal the app
        falls back to the built-in generator.
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

      {edge ? (
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Your Supabase project is configured, so the app calls the <code>ask-model</code> Edge
          Function and the key never reaches this device. Deploy it with the source in{' '}
          <code>supabase/functions/ask-model</code>. A key below is only used if that function
          does not answer.
        </p>
      ) : (
        <p className="mt-3 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
          No Supabase project configured, so the only option is a key on this device.
        </p>
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
        Stored under <code>{API_KEY_STORAGE_KEY}</code> in this browser, never in a backup and
        never synced — enter it again on each device. Uses {MODEL}, one call per workout you ask
        for, never on open.
      </p>
    </Card>
  );
}
