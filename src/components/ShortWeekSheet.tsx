import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Block, Exercise } from '../db/types';
import { longDate } from '../lib/format';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/golf';
import { prescription } from '../lib/repUnit';
import {
  applyShortWeek,
  golfBlocked,
  readWeekStatus,
  shortWeekPlan,
  skipRestOfWeek,
} from '../lib/shortWeek';
import { Label } from './Layout';
import { Sheet } from './Sheet';

/* -------------------------------------------------------------------------- */
/*  "Can't make all three this week?" — docs/GOAL-PLANS.md §3.                */
/*                                                                            */
/*  Pick the days that are left; the sheet shows what they can hold, built    */
/*  from the plan's own exercises, and puts it on the calendar. Picking none   */
/*  is skipping: a week with nothing logged repeats next week.                */
/* -------------------------------------------------------------------------- */

export function ShortWeekSheet({
  block,
  exercisesById,
  onClose,
}: {
  block: Block;
  exercisesById: Map<string, Exercise>;
  onClose: () => void;
}) {
  const status = useLiveQuery(() => readWeekStatus(block), [block]);
  const entries = useLiveQuery(
    () => db.blockExercise.where('blockId').equals(block.id).toArray(),
    [block.id],
  );
  const golf = useLiveQuery(() => db.golfDay.toArray(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const days = useMemo(
    () =>
      status && entries && golf
        ? shortWeekPlan({
            dates: picked,
            todo: status.todo,
            workouts: status.workouts,
            entries,
            exercisesById,
            golf,
          })
        : [],
    [status, entries, golf, picked, exercisesById],
  );

  if (!status || !entries || !golf) return null;
  const doneCount = status.done.length;
  const total = status.workouts.length;
  const nameOf = (slot: string) => status.workouts.find((w) => w.slot === slot)?.name ?? slot;

  const toggle = (date: string) =>
    setPicked((prev) =>
      prev.includes(date)
        ? prev.filter((d) => d !== date)
        : prev.length >= 2
          ? [...prev.slice(1), date].sort()
          : [...prev, date].sort(),
    );

  const save = async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="Short week"
      onClose={onClose}
      footer={
        status.todo.length === 0 ? undefined : picked.length > 0 ? (
          <button
            type="button"
            disabled={saving || days.length === 0}
            onClick={() => void save(() => applyShortWeek(block, days))}
            className="h-cta w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {days.length === 1 ? `Use ${days[0]?.name.toLowerCase()} on ${WEEKDAY_LABEL[weekdayOf(days[0]?.date ?? '')]}` : 'Use these'}
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(() => skipRestOfWeek(block))}
            className="h-cta w-full rounded-full bg-surface-2 font-semibold"
          >
            {doneCount === 0 ? 'Skip this week' : 'Leave the rest of this week'}
          </button>
        )
      }
    >
      <div className="rounded-2xl bg-surface p-4">
        <span className="card-title">
          {doneCount} of {total} done this week
        </span>
        <p className="mt-1 text-[13px] font-medium text-text-dim">
          {status.todo.length === 0
            ? 'Nothing left to fit in.'
            : `Still to do: ${status.todo.map(nameOf).join(', ')}.`}
        </p>
      </div>

      {status.todo.length > 0 && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <span className="card-title">Days you can still train</span>
          <p className="mt-1 text-[12px] font-medium text-text-dim">
            Pick one or two. None means skipping.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {status.daysLeft.map((date) => {
              const on = picked.includes(date);
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(date)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${
                    on ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                  }`}
                >
                  {WEEKDAY_LABEL[weekdayOf(date)]}
                  {golfBlocked(date, golf) ? ' · golf next day' : ''}
                </button>
              );
            })}
            {status.daysLeft.length === 0 && <Label>No days left this week.</Label>}
          </div>
        </div>
      )}

      {days.map((day) => (
        <section key={day.date} className="mt-3 rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="card-title">{day.rows ? day.name : nameOf(day.slot)}</h3>
            <Label>{longDate(day.date)}</Label>
          </div>
          {day.rows ? (
            <ul className="mt-2">
              {day.rows.map((row) => {
                const exercise = exercisesById.get(row.exerciseId);
                return (
                  <li
                    key={row.exerciseId}
                    className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
                  >
                    <span className="truncate text-[14px] font-medium">{exercise?.name ?? row.exerciseId}</span>
                    <span className="shrink-0 text-[12px] font-medium text-text-dim tabular-nums">
                      {prescription(exercise, row.targetSets, row.repRangeLow, row.repRangeHigh)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] font-medium text-text-dim">The workout as planned, moved to this day.</p>
          )}
          {day.dropped.length > 0 && (
            <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
              Left out for golf the next day: {day.dropped.join(', ')}.
            </p>
          )}
        </section>
      ))}

      <section className="mt-3 rounded-2xl bg-surface p-4">
        <h3 className="card-title">How a week counts</h3>
        <ul className="mt-2 text-[13px] font-medium">
          <li className="flex justify-between gap-3 py-1"><span>Any workout done</span><span className="text-text-dim">counts, plan moves on</span></li>
          <li className="flex justify-between gap-3 border-t border-border py-1"><span>Nothing done</span><span className="text-text-dim">week repeats, plan +1 week</span></li>
          <li className="flex justify-between gap-3 border-t border-border py-1"><span>2+ weeks off</span><span className="text-text-dim">one easier re-entry week</span></li>
        </ul>
        <p className="mt-2 text-[12px] font-medium text-text-dim">
          Short days use your plan's own exercises, so every lift's progress carries on. Next week is
          back to normal.
        </p>
      </section>
    </Sheet>
  );
}
