import { useCallback, useEffect, useState } from 'react';
import { readLastSync } from '../db/settings';
import { friendlyDate, toIsoDate } from '../lib/format';
import { syncNow, syncWorkoutNow } from '../lib/nutritionSync';
import { lastPushedAt, type WorkoutSyncReport } from '../lib/workoutSync';
import type { SyncReport } from '../lib/remoteSync';
import {
  currentSession,
  isSupabaseConfigured,
  sendCode,
  signOut,
  verifySignIn,
  type SessionInfo,
} from '../lib/supabaseSource';
import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Nutrition sync.                                                           */
/*                                                                            */
/*  Replaces the manual export/import for the weigh-in history. The nutrition  */
/*  app owns that data in Supabase, so this reads it rather than asking you to */
/*  carry a file between two apps.                                            */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'email' | 'numeric';
}) {
  return (
    <label className="mt-3 block">
      <Label>{label}</Label>
      <input
        type={type}
        inputMode={inputMode}
        autoComplete={type === 'email' ? 'email' : 'one-time-code'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium placeholder:text-text-faint"
      />
    </label>
  );
}

export function NutritionSync() {
  const [session, setSession] = useState<SessionInfo>({ signedIn: false });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [lastSync, setLastSync] = useState<string | undefined>(undefined);
  const [workout, setWorkout] = useState<WorkoutSyncReport | null>(null);
  const [pushedAt, setPushedAt] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setSession(await currentSession());
    setLastSync(await readLastSync());
    setPushedAt(lastPushedAt());
  }, []);

  useEffect(() => {
    // Reading the session and the last-sync stamp is exactly the external
    // synchronisation an effect is for; the guard stops a late resolve
    // landing on an unmounted card.
    let cancelled = false;
    void (async () => {
      const [next, at] = await Promise.all([currentSession(), readLastSync()]);
      if (cancelled) return;
      setSession(next);
      setLastSync(at);
      setPushedAt(lastPushedAt());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isSupabaseConfigured()) {
    return (
      <Card title="Cloud sync">
        <p className="text-[13px] text-text-dim">
          No Supabase project is configured in this build. Copy{' '}
          <code className="text-text">.env.example</code> to{' '}
          <code className="text-text">.env.local</code> with the same values the nutrition app
          uses, then rebuild.
        </p>
      </Card>
    );
  }

  const run = async (work: () => Promise<string | undefined>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) setError(message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Cloud sync">
      <p className="text-[13px] text-text-dim">
        Both directions, same account and same Supabase project as the nutrition app. Weigh-ins
        come down from it; the training data is saved up to a row of its own, a couple of
        seconds after every change. It runs on open, and everything keeps working offline from
        the local copy.
      </p>

      {session.signedIn ? (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <Label>Signed in</Label>
            <span className="truncate text-[14px] font-medium">{session.email ?? 'account'}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <Label>Weigh-ins pulled</Label>
            <span className="text-[14px] font-medium">
              {lastSync ? friendlyDate(toIsoDate(new Date(lastSync))) : 'never'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <Label>Training data saved</Label>
            <span className="text-[14px] font-medium">
              {pushedAt ? friendlyDate(toIsoDate(new Date(pushedAt))) : 'never'}
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const [pulled, saved] = await Promise.all([syncNow(), syncWorkoutNow()]);
                  setReport(pulled);
                  setWorkout(saved);
                  if (saved.outcome === 'no-table') {
                    return 'The workout_data table is missing. Run supabase/workout_data.sql in the SQL editor once.';
                  }
                  if (saved.outcome === 'failed') return saved.error;
                  return pulled.ok ? undefined : pulled.error;
                })
              }
              className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => (await signOut(), undefined))}
              className="h-11 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-text-dim"
            >
              Sign out
            </button>
          </div>

          {report?.ok && (
            <p className="mt-3 text-[12px] font-medium text-text-dim">
              {report.bodyWeight} weigh-ins, {report.activity} activity entries and {report.goals}{' '}
              goal rows merged.
            </p>
          )}

          {workout && (
            <p className="mt-1 text-[12px] font-medium text-text-dim">
              {workout.outcome === 'pushed'
                ? `Training data saved — ${workout.sessions} sessions, ${workout.setLogs} set logs.`
                : workout.outcome === 'pulled'
                  ? `Training data restored from the cloud — ${workout.sessions} sessions.`
                  : workout.outcome === 'up-to-date'
                    ? 'Training data already matches the cloud copy.'
                    : ''}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-[13px] font-medium text-text-dim">
            Sign in with the same email the nutrition app uses. Depending on how the project
            template is set up the email holds a 6-digit code or a link — paste either one.
          </p>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
          />
          {codeSent && (
            <Field
              label="Code, or the link from the email"
              value={code}
              onChange={setCode}
              placeholder="123456 or https://..."
            />
          )}
          <div className="mt-3 flex gap-2">
            {!codeSent ? (
              <button
                type="button"
                disabled={busy || email.trim() === ''}
                onClick={() =>
                  void run(async () => {
                    const message = await sendCode(email.trim());
                    if (!message) setCodeSent(true);
                    return message;
                  })
                }
                className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
              >
                {busy ? 'Sending…' : 'Send code'}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || code.trim() === ''}
                onClick={() =>
                  void run(async () => {
                    const message = await verifySignIn(email.trim(), code.trim());
                    if (!message) {
                      setCode('');
                      setCodeSent(false);
                      const next = await syncNow();
                      setReport(next);
                    }
                    return message;
                  })
                }
                className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
              >
                {busy ? 'Checking…' : 'Verify and sync'}
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 text-[13px] font-medium" style={{ color: 'var(--color-rir-1)' }}>
          {error}
        </p>
      )}
    </Card>
  );
}
