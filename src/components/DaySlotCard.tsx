import { useState } from 'react';
import type { BlockExercise, Exercise } from '../db/types';
import { WEEKDAY_LABEL, type Weekday } from '../lib/golf';

import { Card, Empty, Label } from './Layout';
import { SortableRows } from './SortableRows';
import { HapticTick } from './HapticTick';
import { formatDuration, isTimed, prescription, repUnitWord, stepFor } from '../lib/repUnit';

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
  step = 1,
  format,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  min?: number;
  /** Seconds move in fives: a two-minute plank one tap at a time is not one. */
  step?: number;
  format?: (value: number) => string;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label={`One fewer ${label}`}
        className="size-7 rounded-lg bg-surface-2 text-[15px] font-semibold disabled:text-text-faint"
      >
        −
      </button>
      <span className="min-w-6 px-0.5 text-center text-[13px] font-semibold tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + step)}
        aria-label={`One more ${label}`}
        className="size-7 rounded-lg bg-surface-2 text-[15px] font-semibold"
      >
        +
      </button>
    </span>
  );
}

/** Same mark as the picker uses, so the two read as the same affordance. */
function InfoButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`About ${name}`}
      className="-my-2 flex size-8 shrink-0 items-center justify-center text-text-faint"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 11v5.5M12 7.6v.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
export function DaySlotCard({
  weekday,
  intensity = 'heavy',
  entries,
  exercisesById,
  minutes,
  editing,
  isToday,
  onToggleEdit,
  onStart,
  onAdd,
  onRemove,
  onInfo,
  onReorder,
  onUpdate,
  onClearDay,
  onGenerate,
  label,
  customName,
  onRename,
}: {
  weekday?: Weekday;
  intensity?: 'heavy' | 'light';
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  /**
   * How long this day should take on the clock, already scaled by what past
   * sessions actually took. Undefined while there is nothing to say.
   */
  minutes?: number;
  editing: boolean;
  isToday: boolean;
  onToggleEdit: () => void;
  onStart: () => void;
  onAdd: () => void;
  onRemove: (exerciseId: string) => void;
  /** The exercise ids in their new order, after a drag or an arrow key. */
  /** Opens the cue, the photo and the steps for one exercise. */
  onInfo: (exerciseId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpdate: (entry: BlockExercise, patch: Partial<BlockExercise>) => void;
  onClearDay: () => void;
  onGenerate: () => void;
  /** False when the day has no weekday yet, so there is nothing to build to. */
  /** This day came out of the generator, so re-rolling it costs nothing. */
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
  const totalSets = entries.reduce((sum, entry) => sum + entry.targetSets, 0);
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
              className={`relative rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
                isToday ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
              }`}
            >
              Start
              <HapticTick />
            </button>
          )}
        </span>
      }
    >
      {/* The only draw offered on a card, and only when there is nothing to
          lose. Shuffle and Regenerate used to sit here too, both re-rolling
          the same deterministic selector: they replaced a workout you had
          chosen with a differently-shaped one and never explained the
          difference, so the honest options are the two you already have —
          build it yourself, or ask the AI. */}
      {entries.length === 0 && (
        <>
          <Empty>--- sets</Empty>
          <button
            type="button"
            onClick={onGenerate}
            className="relative mt-3 h-11 w-full rounded-full bg-cta font-semibold text-bg"
          >
            Build this workout
            <HapticTick />
          </button>
        </>
      )}

      {!editing &&
        entries.map((entry) => {
          const exercise = exercisesById.get(entry.exerciseId);
          return (
            <div
              key={entry.exerciseId}
              className="flex items-baseline justify-between gap-3 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate text-[15px] font-medium">
                  {exercise?.name ?? entry.exerciseId}
                </span>
                <InfoButton
                  name={exercise?.name ?? entry.exerciseId}
                  onClick={() => onInfo(entry.exerciseId)}
                />
              </span>
              <Label>
                {prescription(exercise, entry.targetSets, entry.repRangeLow, entry.repRangeHigh)}
              </Label>
            </div>
          );
        })}

      {/* Drag the grip to reorder, swipe the row to uncover Delete. It was
          three small buttons: two taps to move an exercise two places, with
          the delete target 28px from them. */}
      {editing && (
        <SortableRows
          onReorder={onReorder}
          onDelete={onRemove}
          rows={entries.map((entry) => {
            const exercise = exercisesById.get(entry.exerciseId);
            const name = exercise?.name ?? entry.exerciseId;
            return {
              key: entry.exerciseId,
              label: name,
              content: (
                <>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-[15px] font-medium">{name}</span>
                    <InfoButton name={name} onClick={() => onInfo(entry.exerciseId)} />
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
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
                        step={stepFor(exercise)}
                        format={isTimed(exercise) ? formatDuration : undefined}
                        onChange={(repRangeLow) => onUpdate(entry, { repRangeLow })}
                      />
                      <span className="text-[13px] font-medium text-text-dim">to</span>
                      <Stepper
                        value={entry.repRangeHigh}
                        label={`maximum ${repUnitWord(exercise)}`}
                        step={stepFor(exercise)}
                        format={isTimed(exercise) ? formatDuration : undefined}
                        onChange={(repRangeHigh) => onUpdate(entry, { repRangeHigh })}
                      />
                    </span>
                  </div>
                </>
              ),
            };
          })}
        />
      )}

      {/* What the day adds up to. The estimate has been computed since the
          first generator and never shown, so the one question you ask before
          starting — have I got time for this — was the one thing the card
          could not answer. Scaled by the factor learned from real durations,
          so it is minutes rather than arithmetic. */}
      {entries.length > 0 && (
        <Label className="mt-2 block">
          {entries.length} {entries.length === 1 ? 'exercise' : 'exercises'} · {totalSets} sets
          {minutes !== undefined ? ` · about ${minutes} min` : ''}
        </Label>
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
          <button
            type="button"
            onClick={onClearDay}
            className="h-11 rounded-full bg-surface-2 px-4 text-[13px] font-medium"
            style={{ color: 'var(--color-rir-1)' }}
          >
            Delete workout
          </button>
        </div>
      )}
    </Card>
  );
}
