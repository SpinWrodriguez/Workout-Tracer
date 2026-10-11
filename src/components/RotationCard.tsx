import { useState } from 'react';
import type { Block, DaySlot } from '../db/types';
import { longDate, todayIso, weekStart } from '../lib/format';
import { WEEKDAY_LABEL, type Weekday } from '../lib/golf';
import { tap } from '../lib/haptics';
import {
  nextFrom,
  rotationEnd,
  rotationWeekOf,
  writeRotation,
  type Rotation,
} from '../lib/rotation';
import { HapticTick } from './HapticTick';
import { Card, Label, SegmentedToggle } from './Layout';
import { Sheet } from './Sheet';
import type { WorkoutGuide } from '../lib/workoutGuide';

/* -------------------------------------------------------------------------- */
/*  The plan, at the top of Program: the order, the usual days, the week.      */
/*                                                                            */
/*  No plan: a way to make one from the workouts already on the shelf. With    */
/*  one: Week N of W, the order with the next workout marked, the usual days   */
/*  (editable, they are only a forecast), and End plan behind a confirm.      */
/* -------------------------------------------------------------------------- */

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The guide in three words for a list row: "Lower · heavy legs, grip". */
function shortGuide(guide: WorkoutGuide | undefined): string {
  if (!guide) return 'empty';
  if (guide.golfSafe) return `${guide.body} · golf-safe`;
  const loads = [guide.heavyLegs ? 'heavy legs' : '', guide.grip ? 'grip' : '', guide.spine && !guide.heavyLegs ? 'heavy spine' : ''].filter(Boolean);
  return `${guide.body} · ${loads.join(', ')} · not the day before golf`;
}
const WEEK_OPTIONS = ['6', '8', '10'] as const;

export function RotationCard({
  block,
  rotation,
  sessions,
  slots,
  labelFor,
  guideFor,
  golfWeekdays,
}: {
  block: Block;
  rotation: Rotation | undefined;
  sessions: { date: string; slot: DaySlot }[];
  /** Every workout the block defines, in slot order. */
  slots: DaySlot[];
  labelFor: (slot: DaySlot) => string;
  /** Where each workout fits, read off its lifts. */
  guideFor: (slot: DaySlot) => WorkoutGuide | undefined;
  golfWeekdays: Weekday[];
}) {
  const [setup, setSetup] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const today = todayIso();

  const toggleDay = (day: Weekday) => {
    if (!rotation) return;
    const days = rotation.trainingDays.includes(day)
      ? rotation.trainingDays.filter((d) => d !== day)
      : [...rotation.trainingDays, day].sort((a, b) => a - b);
    void writeRotation(block.id, { ...rotation, trainingDays: days });
  };

  if (!rotation) {
    return (
      <>
        <Card title="Plan" className="mb-3">
          <p className="text-[13px] font-medium text-text-dim">
            Put your workouts in order and repeat them for a few weeks. Whatever day you
            train, you get the next one; nothing is pinned to a weekday.
          </p>
          <button
            type="button"
            disabled={slots.length === 0}
            onClick={() => setSetup(true)}
            className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            Make a plan
          </button>
        </Card>
        {setup && (
          <SetupSheet
            slots={slots}
            labelFor={labelFor}
            guideFor={guideFor}
            golfWeekdays={golfWeekdays}
            onClose={() => setSetup(false)}
            onStart={(next) => {
              void writeRotation(block.id, next).then(() => setSetup(false));
            }}
          />
        )}
      </>
    );
  }

  const week = rotationWeekOf(rotation, today);
  const next = nextFrom(rotation, sessions, today);
  const finished = week > rotation.weeks;
  const title = finished
    ? 'Plan finished'
    : week < 1
      ? `Plan starts ${longDate(rotation.start)}`
      : `Plan · Week ${week} of ${rotation.weeks}`;

  return (
    <Card title={title} className="mb-3">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${rotation.weeks}, 1fr)` }}
        aria-label={`Week ${week} of ${rotation.weeks}`}
      >
        {Array.from({ length: rotation.weeks }, (_, i) => (
          <span
            key={i}
            className="h-2 rounded-[3px]"
            style={{
              background:
                i + 1 < week || finished
                  ? 'var(--color-volume)'
                  : i + 1 === week
                    ? 'color-mix(in srgb, var(--color-volume) 45%, var(--color-surface-2))'
                    : 'var(--color-surface-2)',
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-[12px] font-medium text-text-dim">
        {longDate(rotation.start)} to {longDate(rotationEnd(rotation))}. After that the calendar
        is empty until the next plan.
      </p>

      <Label className="mt-3 block">In order</Label>
      <ol className="mt-1.5 flex flex-col gap-1.5" aria-label="Workouts in order">
        {rotation.order.map((slot) => {
          const isNext = slot === next && !finished;
          const optional = rotation.optional.includes(slot);
          const skipped = optional && rotation.trainingDays.length <= 3;
          return (
            <li
              key={slot}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                isNext ? 'bg-cta text-bg' : 'bg-surface-2'
              } ${skipped ? 'opacity-60' : ''}`}
            >
              <span className="w-5 text-[13px] font-bold">{slot}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{labelFor(slot)}</span>
                <span className={`block text-[11px] font-medium ${isNext ? 'opacity-80' : 'text-text-dim'}`}>
                  {shortGuide(guideFor(slot))}
                </span>
              </span>
              <span className={`shrink-0 text-[11px] font-medium ${isNext ? 'opacity-80' : 'text-text-dim'}`}>
                {isNext ? 'next' : skipped ? 'skipped on 3-day weeks' : optional ? '4-day weeks' : ''}
              </span>
            </li>
          );
        })}
      </ol>

      <Label className="mt-3 block">Days I usually train</Label>
      <div className="mt-1.5 grid grid-cols-7 gap-1" role="group" aria-label="Days I usually train">
        {ALL_DAYS.map((day) => (
          <DayChip
            key={day}
            day={day}
            on={rotation.trainingDays.includes(day)}
            golf={golfWeekdays.includes(day)}
            onClick={() => toggleDay(day)}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[12px] font-medium text-text-dim">
        A forecast for the week strip, not a booking. Train another day and the next
        workout comes with you.
      </p>

      {!confirmEnd ? (
        <button
          type="button"
          onClick={() => setConfirmEnd(true)}
          className="mt-3 rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
        >
          End plan…
        </button>
      ) : (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <p className="text-[14px] font-semibold">End the plan?</p>
          <p className="mt-0.5 text-[12px] font-medium text-text-dim">
            Every set you logged stays. The workouts stay on the shelf; only the order and
            the forecast go.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmEnd(false)}
              className="rounded-lg bg-surface px-3 py-1.5 text-[12px] font-semibold"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => void writeRotation(block.id, undefined)}
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: 'var(--color-danger)', color: 'var(--color-danger-text)' }}
            >
              End plan
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DayChip({
  day,
  on,
  golf,
  onClick,
}: {
  day: Weekday;
  on: boolean;
  golf: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${WEEKDAY_LABEL[day]}${golf ? ', golf' : ''}`}
      onClick={() => {
        tap();
        onClick();
      }}
      className={`relative flex flex-col items-center rounded-xl py-2 text-[12.5px] font-semibold ${
        on ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
      }`}
    >
      {WEEKDAY_LABEL[day]}
      <span className="text-[9px] font-bold uppercase opacity-70">{golf ? 'golf' : ' '}</span>
      <HapticTick radius={12} />
    </button>
  );
}

/* --- making one -------------------------------------------------------------- */

function SetupSheet({
  slots,
  labelFor,
  guideFor,
  golfWeekdays,
  onClose,
  onStart,
}: {
  slots: DaySlot[];
  labelFor: (slot: DaySlot) => string;
  guideFor: (slot: DaySlot) => WorkoutGuide | undefined;
  golfWeekdays: Weekday[];
  onClose: () => void;
  onStart: (rotation: Rotation) => void;
}) {
  const today = todayIso();
  const [order, setOrder] = useState<DaySlot[]>([]);
  const [optional, setOptional] = useState<DaySlot[]>([]);
  const [days, setDays] = useState<Weekday[]>([1, 3, 5]);
  const [weeks, setWeeks] = useState<(typeof WEEK_OPTIONS)[number]>('8');
  const [start, setStart] = useState(weekStart(today));

  const toggleSlot = (slot: DaySlot) =>
    setOrder((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  const toggleOptional = (slot: DaySlot) =>
    setOptional((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  const toggleDay = (day: Weekday) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  const ready = order.length >= 2 && days.length >= 1 && start !== '';

  return (
    <Sheet
      title="New plan"
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            onStart({
              order,
              optional: optional.filter((s) => order.includes(s)),
              trainingDays: days,
              start,
              weeks: Number(weeks),
            })
          }
          className="h-cta w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
        >
          {order.length < 2 ? 'Pick at least two workouts' : `Start plan · ${longDate(start)}`}
        </button>
      }
    >
      <div className="rounded-2xl bg-surface p-4">
        <span className="card-title">Workouts, in order</span>
        <p className="mt-1 text-[13px] font-medium text-text-dim">
          Tap in the order you want them to repeat. Put an upper day between two lower
          days, and the golf-safe one where it can land on the day before golf. Mark one
          as 4-day only if it should be skipped on three-day weeks.
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {slots.map((slot) => {
            const at = order.indexOf(slot);
            const picked = at !== -1;
            return (
              <div key={slot} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={picked}
                  aria-label={picked ? `${at + 1}. ${labelFor(slot)}` : labelFor(slot)}
                  onClick={() => toggleSlot(slot)}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                    picked ? 'bg-cta text-bg' : 'bg-surface-2'
                  }`}
                >
                  <span className="w-5 text-[13px] font-bold tabular-nums">{picked ? at + 1 : '·'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{labelFor(slot)}</span>
                    <span className={`block text-[11px] font-medium ${picked ? 'opacity-80' : 'text-text-dim'}`}>
                      {guideFor(slot)?.line ?? 'Empty'}
                    </span>
                  </span>
                </button>
                {picked && (
                  <button
                    type="button"
                    aria-pressed={optional.includes(slot)}
                    aria-label={`${labelFor(slot)}: only on 4-day weeks`}
                    onClick={() => toggleOptional(slot)}
                    className={`shrink-0 rounded-lg px-2 py-2 text-[11px] font-semibold ${
                      optional.includes(slot) ? 'bg-text text-bg' : 'bg-surface-2 text-text-dim'
                    }`}
                  >
                    4-day only
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-surface p-4">
        <span className="card-title">Days I usually train</span>
        <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label="Days I usually train">
          {ALL_DAYS.map((day) => (
            <DayChip key={day} day={day} on={days.includes(day)} golf={golfWeekdays.includes(day)} onClick={() => toggleDay(day)} />
          ))}
        </div>
        <p className="mt-2 text-[12px] font-medium text-text-dim">
          Only a forecast. Golf in the morning is a normal training day; the day before
          keeps grip and heavy back work off, so the golf-safe workout goes there.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="card-title">Weeks</span>
          <div className="w-44">
            <SegmentedToggle options={WEEK_OPTIONS} value={weeks} onChange={setWeeks} />
          </div>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3">
          <span className="card-title">Starts</span>
          <input
            type="date"
            value={start}
            aria-label="Start date"
            onChange={(event) => setStart(event.target.value)}
            className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[14px] font-medium"
          />
        </label>
        <p className="mt-2 text-[12px] font-medium text-text-dim">
          Weeks run Monday to Sunday. Week 1 is the week of the start date.
        </p>
      </div>
    </Sheet>
  );
}
