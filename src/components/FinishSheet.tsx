import { Label } from './Layout';
import type { SessionDraft } from '../lib/sessions';
import { tap } from '../lib/haptics';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  Behind Finish: what the session is logged against, its date, how long it  */
/*  took, a note, and the buttons that end it. Off the main screen because    */
/*  none of it is needed mid-set, and under the sets it pushed the work up    */
/*  to say something you fill in once, at the end.                            */
/* -------------------------------------------------------------------------- */

export function FinishSheet({
  draft,
  workoutName,
  loggedSets,
  saving,
  canSave,
  editing,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  onClose,
}: {
  draft: SessionDraft;
  workoutName?: string;
  loggedSets: number;
  saving: boolean;
  canSave: boolean;
  /** A saved session opened from History: Delete instead of Discard. */
  editing: boolean;
  onChange: (patch: Partial<SessionDraft>) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim" />
      <div
        role="dialog"
        aria-label="Finish the workout"
        className="relative rounded-t-3xl bg-surface px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border" aria-hidden="true" />
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="card-title">{editing ? 'Session details' : 'Finish'}</h3>
          <span className="text-[13px] font-medium text-text-dim">
            {loggedSets} set{loggedSets === 1 ? '' : 's'}
            {workoutName ? ` · ${workoutName}` : ''}
          </span>
        </div>

        <div className="mt-4 flex gap-3">
          <label className="flex-1">
            <Label>Date</Label>
            <input
              id="finish-date"
              type="date"
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
              className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium"
            />
          </label>
          <label className="w-28">
            <Label>Minutes</Label>
            <input
              id="finish-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="auto"
              value={draft.durationMin ?? ''}
              onChange={(event) =>
                onChange({ durationMin: event.target.value === '' ? undefined : Number(event.target.value) })
              }
              className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium placeholder:text-text-faint"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <Label>Notes</Label>
          <textarea
            id="finish-notes"
            rows={2}
            value={draft.notes ?? ''}
            onChange={(event) => onChange({ notes: event.target.value })}
            placeholder="How it went"
            className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] placeholder:text-text-faint"
          />
        </label>

        {canSave && (
          <button
            type="button"
            onClick={() => {
              tap();
              onSave();
            }}
            disabled={saving}
            className="h-cta relative mt-4 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {saving ? 'Saving…' : `Save · ${loggedSets} set${loggedSets === 1 ? '' : 's'}`}
            <HapticTick />
          </button>
        )}

        <button
          type="button"
          onClick={editing ? onDelete : onDiscard}
          className="mt-4 w-full py-2 text-center text-[13px] font-medium"
          style={{ color: 'var(--color-rir-1)' }}
        >
          {editing ? 'Delete session' : 'Discard this workout'}
        </button>
      </div>
    </div>
  );
}
