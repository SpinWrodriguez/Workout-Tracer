import { useState } from 'react';
import type { BlockExercise, Exercise } from '../db/types';
import { WEEKDAY_LABEL, type Weekday } from '../lib/golf';

import { Card, Empty, Label } from './Layout';
import { prescription, repUnitWord } from '../lib/repUnit';

/* -------------------------------------------------------------------------- */
/*  One day of the block, readable or editable.                               */
/*                                                                            */
/*  The generator is a starting point, not a cage — every day can be built by  */
/*  hand: add and remove exercises, reorder them, set the sets and rep range.  */
/* -------------------------------------------------------------------------- */

function Stepper({
  value,
  onChange,
  label,
  min = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  min?: number;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`One fewer ${label}`}
        className="size-7 rounded-lg bg-surface-2 text-[15px] font-semibold disabled:text-text-faint"
      >
        −
      </button>
      <span className="w-6 text-center text-[13px] font-semibold">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label={`One more ${label}`}
        className="size-7 rounded-lg bg-surface-2 text-[15px] font-semibold"
      >
        +
      </button>
    </span>
  );
}

export function DaySlotCard({
  weekday,
  intensity = 'heavy',
  entries,
  exercisesById,
  editing,
  isToday,
  onToggleEdit,
  onStart,
  onAdd,
  onRemove,
  onMove,
  onUpdate,
  onClearDay,
  onGenerate,
  onShuffle,
  canGenerate,
  generated,
  label,
  customName,
  onRename,
}: {
  weekday?: Weekday;
  intensity?: 'heavy' | 'light';
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  editing: boolean;
  isToday: boolean;
  onToggleEdit: () => void;
  onStart: () => void;
  onAdd: () => void;
  onRemove: (exerciseId: string) => void;
  onMove: (exerciseId: string, direction: -1 | 1) => void;
  onUpdate: (entry: BlockExercise, patch: Partial<BlockExercise>) => void;
  onClearDay: () => void;
  onGenerate: () => void;
  onShuffle: () => void;
  /** False when the day has no weekday yet, so there is nothing to build to. */
  canGenerate: boolean;
  /** This day came out of the generator, so re-rolling it costs nothing. */
  generated: boolean;
  /** What to show: a name the user typed, or one derived from the exercises. */
  label: string;
  /** Only what the user typed, so the field is empty when nothing is set. */
  customName?: string;
  onRename: (next: string | undefined) => void;
}) {
  /* Local while editing; the stored name is the source of truth everywhere
     else, so it re-seeds whenever the day is renamed or regenerated. Adjusted
     during render rather than in an effect, which is React's own answer to
     "reset some state when a prop changes" and avoids a second render pass. */
  const [typed, setTyped] = useState(customName ?? '');
  const [lastSeen, setLastSeen] = useState(customName);
  if (lastSeen !== customName) {
    setLastSeen(customName);
    setTyped(customName ?? '');
  }

  return (
    <Card
      title={label}
      className="mt-3"
      trailing={
        <span className="flex items-center gap-2">
          {weekday !== undefined && (
            <Label className={isToday ? 'text-text!' : ''}>
              {isToday ? 'today' : WEEKDAY_LABEL[weekday]}
              {intensity === 'light' ? ' · light' : ''}
            </Label>
          )}
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-text-dim"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={onStart}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
                isToday ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
              }`}
            >
              Start
            </button>
          )}
        </span>
      }
    >
      {entries.length === 0 && (
        <>
          <Empty>--- sets</Empty>
          {canGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              className="mt-3 h-11 w-full rounded-full bg-cta font-semibold text-bg"
            >
              Generate this day
            </button>
          )}
        </>
      )}

      {entries.map((entry, index) => {
        const exercise = exercisesById.get(entry.exerciseId);
        return (
          <div
            key={entry.exerciseId}
            className={editing ? 'border-t border-border py-2.5 first:border-t-0 first:pt-0' : ''}
          >
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-[15px] font-medium">
                {exercise?.name ?? entry.exerciseId}
              </span>
              {!editing && (
                <Label>
                  {prescription(exercise, entry.targetSets, entry.repRangeLow, entry.repRangeHigh)}
                </Label>
              )}
              {editing && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onMove(entry.exerciseId, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="size-7 rounded-lg bg-surface-2 text-[13px] disabled:text-text-faint"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(entry.exerciseId, 1)}
                    disabled={index === entries.length - 1}
                    aria-label="Move down"
                    className="size-7 rounded-lg bg-surface-2 text-[13px] disabled:text-text-faint"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.exerciseId)}
                    aria-label={`Remove ${exercise?.name ?? entry.exerciseId}`}
                    className="size-7 rounded-lg bg-surface-2 text-[13px]"
                    style={{ color: 'var(--color-rir-1)' }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>

            {editing && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex items-center gap-2">
                  <Label>sets</Label>
                  <Stepper
                    value={entry.targetSets}
                    label="set"
                    onChange={(targetSets) => onUpdate(entry, { targetSets })}
                  />
                </span>
                <span className="flex items-center gap-2">
                  <Label>{repUnitWord(exercise)}</Label>
                  <Stepper
                    value={entry.repRangeLow}
                    label={`minimum ${repUnitWord(exercise)}`}
                    onChange={(repRangeLow) => onUpdate(entry, { repRangeLow })}
                  />
                  <span className="text-[13px] font-medium text-text-dim">to</span>
                  <Stepper
                    value={entry.repRangeHigh}
                    label={`maximum ${repUnitWord(exercise)}`}
                    onChange={(repRangeHigh) => onUpdate(entry, { repRangeHigh })}
                  />
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Shuffle is offered only on a generated day: it re-rolls the draw, and
          on a hand-built day that would silently throw the day away. */}
      {!editing && entries.length > 0 && generated && canGenerate && (
        <button
          type="button"
          onClick={onShuffle}
          className="mt-3 h-9 w-full rounded-full bg-surface-2 text-[12px] font-medium text-text-dim"
        >
          Shuffle this day
        </button>
      )}

      {editing && (
        <label className="mt-1 mb-3 block">
          <span className="label">Name</span>
          <input
            type="text"
            value={typed}
            placeholder={label}
            onChange={(event) => setTyped(event.target.value)}
            /* Committed on blur, not per keystroke: writing every character
               back through the database made the field fight what was being
               typed into it. Blank clears the name rather than storing "", so
               the day goes back to describing itself. */
            onBlur={() => onRename(typed.trim() || undefined)}
            className="mt-1 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium outline-none placeholder:text-text-faint"
          />
          <span className="label mt-1 block">
            Leave it blank and the day names itself from what is in it.
          </span>
        </label>
      )}

      {editing && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onAdd}
            className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg"
          >
            Add exercise
          </button>
          {canGenerate && entries.length > 0 && (
            <button
              type="button"
              onClick={onGenerate}
              className="h-11 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-text-dim"
            >
              Regenerate
            </button>
          )}
          <button
            type="button"
            onClick={onClearDay}
            className="h-11 rounded-full bg-surface-2 px-4 text-[13px] font-medium"
            style={{ color: 'var(--color-rir-1)' }}
          >
            Delete day
          </button>
        </div>
      )}
    </Card>
  );
}
