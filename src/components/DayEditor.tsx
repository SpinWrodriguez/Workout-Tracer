import type { DaySlot, GolfDay } from '../db/types';
import { longDate } from '../lib/format';
import { WEEKDAY_LABEL, gripBufferNote, weekdayOf } from '../lib/golf';
import { EFFORT_COLOR, EFFORT_WORD } from '../lib/effort';
import type { Intensity } from '../lib/weekTemplate';

import { Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Sets what one day of the week is: a gym day running a given slot, a round  */
/*  of golf, or rest. Tapping the day used to only cycle golf, which made the  */
/*  gym half of the week read-only.                                           */
/*                                                                            */
/*  The gym half is a row of tiles rather than a list of names. A name alone   */
/*  is not enough to choose between two workouts — how long is it, how much is */
/*  in it, how hard — and every one of those is already known here. The colour */
/*  rule is the same one the day cards and the calendar carry: red heavy,      */
/*  green light, blue a round.                                                */
/*                                                                            */
/*  "Build one with AI" used to sit in this list too. It is on the Program     */
/*  screen and inside the New-workout sheet, and a third door onto the same    */
/*  room made the day editor about making workouts rather than about the day.  */
/* -------------------------------------------------------------------------- */

/** One workout the block defines, with enough on it to choose by. */
export interface DayEditorSlot {
  slot: DaySlot;
  label: string;
  intensity: Intensity;
  exercises: number;
  sets: number;
  /** Undefined while the workout is empty and there is nothing to time. */
  minutes?: number;
}

function Tile({
  accent,
  title,
  detail,
  active,
  onClick,
  ariaLabel,
}: {
  accent: string;
  title: string;
  detail: string;
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`flex w-full items-stretch gap-3 overflow-hidden rounded-xl text-left ${
        active ? 'bg-cta text-bg' : 'bg-surface-2'
      }`}
    >
      <span className="w-1 shrink-0 self-stretch" style={{ background: accent }} aria-hidden="true" />
      <span className="min-w-0 flex-1 py-2.5 pr-3.5">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        <span
          className={`mt-0.5 block truncate text-[12px] font-medium ${
            active ? 'text-bg/70' : 'text-text-dim'
          }`}
        >
          {detail}
        </span>
      </span>
    </button>
  );
}

export function DayEditor({
  date,
  golfDates,
  slots,
  onSetUsual,
  usualLabel,
  currentSlot,
  golf,
  onSetSlot,
  onSetGolf,
  onClose,
}: {
  date: string;
  /** Every date a round is on, so this day can say what it is close to. */
  golfDates: string[];
  /** Workouts the block actually defines, so we never offer an empty day. */
  slots: DayEditorSlot[];
  /** Makes the day's workout fall here every week, not just this one. */
  onSetUsual?: () => void;
  usualLabel?: string;
  currentSlot?: DaySlot;
  golf?: GolfDay;
  onSetSlot: (slot: DaySlot | undefined) => void;
  onSetGolf: (status: GolfDay['status'] | undefined) => void;
  onClose: () => void;
}) {
  const weekday = weekdayOf(date);
  /* Why a workout built for this day will come back without pulling in it.
     The rule used to act here and say nothing. */
  const note = gripBufferNote(date, golfDates);

  /** The plain rows: clearing the day, clearing the round. */
  const clearRow = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-left"
    >
      <span className="text-[15px] font-medium">{label}</span>
      <span className="text-[11px] font-medium text-text-dim">clear</span>
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
          {slots.map((row) => (
            <Tile
              key={row.slot}
              accent={EFFORT_COLOR[row.intensity]}
              title={row.label}
              detail={
                row.exercises === 0
                  ? 'Empty — nothing in it yet'
                  : `${row.exercises} ${row.exercises === 1 ? 'exercise' : 'exercises'} · ${
                      row.sets
                    } sets${row.minutes !== undefined ? ` · about ${row.minutes} min` : ''}`
              }
              /* Spelled out, because the tile says two of these three things
                 in ways a screen reader cannot get at: the effort is a colour
                 and the totals are a second line under the name. */
              ariaLabel={`${row.label}, ${EFFORT_WORD[row.intensity]}, ${
                row.exercises === 0
                  ? 'empty'
                  : `${row.exercises} ${row.exercises === 1 ? 'exercise' : 'exercises'}, ${
                      row.sets
                    } sets`
              }`}
              active={currentSlot === row.slot}
              onClick={() => onSetSlot(row.slot)}
            />
          ))}
          {currentSlot && clearRow('No gym this day', () => onSetSlot(undefined))}
        </div>

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
          {/* One tile, not two. "Round planned" and "Round played" were the
              same fact on either side of the date, the app never read the
              difference anywhere, and choosing between them was a question
              about tense rather than about golf. */}
          <Tile
            accent={EFFORT_COLOR.golf}
            title="Round of golf"
            detail={golf ? 'On this day' : 'Nothing to work around'}
            active={golf !== undefined}
            onClick={() => onSetGolf(golf ? undefined : 'planned')}
          />
          {golf && clearRow('No round', () => onSetGolf(undefined))}
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
