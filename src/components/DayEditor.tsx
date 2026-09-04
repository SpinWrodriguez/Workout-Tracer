import type { DaySlot, GolfDay } from '../db/types';
import { longDate } from '../lib/format';
import { WEEKDAY_LABEL, gripBufferNote, weekdayOf } from '../lib/golf';

import { useState } from 'react';

import { Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Sets what one day of the week is: a gym day running a given slot, a round  */
/*  of golf, or rest. Tapping the day used to only cycle golf, which made the  */
/*  gym half of the week read-only.                                           */
/* -------------------------------------------------------------------------- */

export function DayEditor({
  date,
  golfDates,
  slots,
  labelFor,
  onSetUsual,
  usualLabel,
  currentSlot,
  golf,
  onSetSlot,
  onSetGolf,
  onClose,
  onAsk,
  modelAvailable = false,
  asking = false,
  askError,
}: {
  date: string;
  /** Every date a round is on, so this day can say what it is close to. */
  golfDates: string[];
  /** Slots the block actually defines, so we never offer an empty day. */
  slots: DaySlot[];
  /** What each slot is called, resolved by the screen that owns the block. */
  labelFor: (slot: DaySlot) => string;
  /** Makes the day's workout fall here every week, not just this one. */
  onSetUsual?: () => void;
  usualLabel?: string;
  currentSlot?: DaySlot;
  golf?: GolfDay;
  onSetSlot: (slot: DaySlot | undefined) => void;
  onSetGolf: (status: GolfDay['status'] | undefined) => void;
  onClose: () => void;
  /**
   * Build a new workout for this date. The goal is optional: with nothing
   * typed the app derives one from what is short this week, so the common case
   * is a single tap.
   */
  onAsk?: (goal: string) => void;
  modelAvailable?: boolean;
  asking?: boolean;
  askError?: string;
}) {
  const weekday = weekdayOf(date);
  /* Why a workout built for this day will come back without pulling in it.
     The rule used to act here and say nothing. */
  const note = gripBufferNote(date, golfDates);
  const [goal, setGoal] = useState('');
  const [expanded, setExpanded] = useState(false);

  const option = (active: boolean, onClick: () => void, label: string, sub?: string) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left ${
        active ? 'bg-cta text-bg' : 'bg-surface-2'
      }`}
    >
      <span className="text-[15px] font-medium">{label}</span>
      <span className={`text-[11px] font-medium ${active ? 'text-bg/70' : 'text-text-dim'}`}>
        {sub ?? (active ? 'set' : '')}
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim" />
      <div
        className="relative rounded-t-3xl bg-surface px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="card-title">{WEEKDAY_LABEL[weekday]}</h3>
        <Label className="mt-0.5 block">{longDate(date)}</Label>

        {note && (
          <p
            className="mt-2.5 rounded-xl px-3 py-2 text-[12px] leading-snug font-medium"
            style={{
              background: 'var(--color-surface-2)',
              /* Amber where the rule bars the work, plain dim where it only
                 says the round is close: the colour has to agree with the
                 sentence or it reads as a veto either way. */
              color:
                note.severity === 'blocked'
                  ? 'var(--color-warn)'
                  : 'var(--color-text-dim)',
            }}
          >
            {note.text}
          </p>
        )}

        <Label className="mt-4 mb-1.5 block">Gym</Label>
        <div className="flex flex-col gap-1.5">

          {slots.map((slot) =>
            option(currentSlot === slot, () => onSetSlot(slot), labelFor(slot)),
          )}
          {currentSlot && option(false, () => onSetSlot(undefined), 'No gym this day', 'clear')}
        </div>

        {onAsk && modelAvailable && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-left"
            >
              <span className="text-[15px] font-medium">Build one with AI</span>
              <span className="text-[11px] font-medium text-text-dim">
                {expanded ? 'hide' : 'new workout'}
              </span>
            </button>

            {expanded && (
              <>
                <textarea
                  rows={2}
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Optional — e.g. legs, but nothing heavy on the spine"
                  className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] placeholder:text-text-faint"
                />
                <button
                  type="button"
                  disabled={asking}
                  onClick={() => onAsk(goal)}
                  className="mt-1.5 h-11 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
                >
                  {asking ? 'Thinking…' : goal.trim() ? 'Build it from that' : 'Build what I need'}
                </button>
                {askError && (
                  <p className="mt-1.5 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
                    {askError}
                  </p>
                )}
                <Label className="mt-1.5 block">
                  Leave it blank and it aims at whatever muscles are short this week, using
                  your goals from Settings. It lands on this day.
                </Label>
              </>
            )}
          </>
        )}

        {/* Moving a session used to move it in every week that would ever
            exist. It now moves this date; making it the standing arrangement
            is a separate, deliberate thing. */}
        {currentSlot && onSetUsual && (
          <button
            type="button"
            onClick={onSetUsual}
            className="mt-2 w-full rounded-xl bg-surface-2 py-2.5 text-[13px] font-medium text-text-dim"
          >
            {usualLabel ?? 'Make this the usual day'}
          </button>
        )}

        <Label className="mt-4 mb-1.5 block">Golf</Label>
        <div className="flex flex-col gap-1.5">
          {option(golf?.status === 'planned', () => onSetGolf('planned'), 'Round planned')}
          {option(golf?.status === 'played', () => onSetGolf('played'), 'Round played')}
          {golf && option(false, () => onSetGolf(undefined), 'No round', 'clear')}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-cta mt-4 w-full rounded-full bg-surface-2 font-semibold"
        >
          Done
        </button>
      </div>
    </div>
  );
}
