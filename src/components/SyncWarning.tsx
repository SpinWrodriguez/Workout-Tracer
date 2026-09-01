import { useEffect, useState } from 'react';
import { lastSyncReport, onSyncReport, type WorkoutSyncReport } from '../lib/workoutSync';

/* -------------------------------------------------------------------------- */
/*  Nothing is being saved.                                                   */
/*                                                                            */
/*  The push is fire-and-forget so it can never interrupt logging a set, which */
/*  also meant a signed-out device or a missing table looked exactly like a    */
/*  working one — for as long as you cared to keep training. Only the two      */
/*  outcomes where NOTHING will ever save are shown: a failed network call in  */
/*  a garage is normal and retries on its own.                                 */
/* -------------------------------------------------------------------------- */

function messageFor(report: WorkoutSyncReport | undefined): string | undefined {
  if (report?.outcome === 'needs-sign-in') {
    return 'Your training data is only on this device — sign in under Settings to back it up.';
  }
  if (report?.outcome === 'no-table') {
    return 'Cloud backup is not set up yet: run supabase/workout_data.sql once in the Supabase SQL editor.';
  }
  return undefined;
}

export function SyncWarning({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [report, setReport] = useState<WorkoutSyncReport | undefined>(() => lastSyncReport());
  useEffect(() => onSyncReport(setReport), []);

  const message = messageFor(report);
  if (!message) return null;

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: 'var(--color-warn)' }}
        aria-hidden="true"
      />
      <span className="flex-1 text-[12px] leading-snug font-medium text-text-dim">{message}</span>
      <span className="text-[18px] text-text-faint">›</span>
    </button>
  );
}
