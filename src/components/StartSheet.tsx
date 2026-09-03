import type { DaySlot } from '../db/types';
import { WEEKDAY_LABEL, type Weekday } from '../lib/golf';
import { friendlyDate } from '../lib/format';
import { Sheet } from './Sheet';
import { Label } from './Layout';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  What are we doing today?                                                  */
/*                                                                            */
/*  The + used to drop straight into the exercise picker, which answers a      */
/*  question nobody asked: most sessions are the one already programmed for    */
/*  today, and the picker is the rare case. Asking first costs one tap and     */
/*  makes the common path shorter, not longer.                                 */
/* -------------------------------------------------------------------------- */

export interface StartOption {
  slot: DaySlot;
  label: string;
  weekday?: Weekday;
  date?: string;
  exerciseCount: number;
  done: boolean;
  isToday: boolean;
  /** The one the app would pick for you: soonest unfinished session. */
  isNext: boolean;
  preview: string;
}

function Row({
  title,
  meta,
  detail,
  tone = 'plain',
  onClick,
}: {
  title: string;
  meta?: string;
  detail?: string;
  tone?: 'plain' | 'primary' | 'muted';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative mt-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left ${
        tone === 'primary' ? 'bg-cta text-bg' : 'bg-surface'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="card-title truncate">{title}</span>
          {meta && (
            <span
              className={`text-[11px] font-medium ${
                tone === 'primary' ? 'text-bg/70' : 'text-text-dim'
              }`}
            >
              {meta}
            </span>
          )}
        </span>
        {detail && (
          <span
            className={`mt-0.5 block truncate text-[12px] font-medium ${
              tone === 'primary' ? 'text-bg/70' : 'text-text-dim'
            }`}
          >
            {detail}
          </span>
        )}
      </span>
      <span className={`text-[18px] ${tone === 'primary' ? 'text-bg/70' : 'text-text-faint'}`}>
        ›
      </span>
      <HapticTick radius={16} />
    </button>
  );
}

export function StartSheet({
  options,
  onPick,
  onFreestyle,
  onClose,
}: {
  options: StartOption[];
  onPick: (slot: DaySlot) => void;
  onFreestyle: () => void;
  onClose: () => void;
}) {
  const runnable = options.filter((option) => option.exerciseCount > 0);
  const pending = runnable.filter((option) => !option.done);
  const done = runnable.filter((option) => option.done);

  return (
    <Sheet title="Start a session" onClose={onClose}>
      {pending.length > 0 && <Label className="mt-1 block">From your program</Label>}

      {pending.map((option) => (
        <Row
          key={option.slot}
          title={option.label}
          meta={
            option.isToday
              ? 'today'
              : option.date
                ? friendlyDate(option.date)
                : option.weekday
                  ? WEEKDAY_LABEL[option.weekday]
                  : 'unscheduled'
          }
          detail={`${option.exerciseCount} exercises · ${option.preview}`}
          tone={option.isNext ? 'primary' : 'plain'}
          onClick={() => onPick(option.slot)}
        />
      ))}

      <Label className="mt-5 block">Or</Label>
      <Row
        title="Freestyle"
        meta="nothing programmed"
        detail="Pick exercises as you go"
        onClick={onFreestyle}
      />

      {/* Finished days are listed but not offered: seeing the week is useful,
          starting Monday again on Wednesday is not. */}
      {done.length > 0 && (
        <>
          <Label className="mt-5 block">Already done this week</Label>
          {done.map((option) => (
            <div
              key={option.slot}
              className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5"
            >
              <span className="min-w-0 flex-1">
                <span className="card-title truncate text-text-dim">{option.label}</span>
                <span className="mt-0.5 block truncate text-[12px] font-medium text-text-faint">
                  {option.date ? friendlyDate(option.date) : ''}
                </span>
              </span>
              <span className="text-[12px] font-semibold text-text-faint">Done</span>
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
