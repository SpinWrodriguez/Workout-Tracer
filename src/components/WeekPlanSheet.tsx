import { useState } from 'react';
import type { Weekday } from '../lib/golf';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/golf';
import { fromIsoDate } from '../lib/format';
import {
  WORKOUT_FOCUSES,
  WORKOUT_FOCUS_LABEL,
  type Intensity,
  type WorkoutFocus,
} from '../lib/weekTemplate';
import { Sheet } from './Sheet';
import { Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Planning a week, as three answers: which days, how hard, and what each     */
/*  one trains.                                                               */
/*                                                                            */
/*  It replaces the old starter week, which asked "sessions per week" and then */
/*  chose the days itself from a fixed template — so the answer to "which      */
/*  days" was never actually yours. It also wrote a standing weekday, putting  */
/*  every generated workout into every week of the block at once.              */
/*                                                                            */
/*  Days here are DATES, in the week being looked at. That is the whole reason */
/*  this can exist without the old bug: nothing it writes outlives the week.   */
/* -------------------------------------------------------------------------- */

export interface PlannedWeekDay {
  date: string;
  intensity: Intensity;
  focus: WorkoutFocus;
}

/** One day of the week on screen, and what is already true about it. */
export interface WeekPlanDay {
  date: string;
  /** A round is on this date, so no session goes here. */
  golf: boolean;
  /** A workout is already planned here; generating would be a second one. */
  taken?: string;
}

const INTENSITIES: Intensity[] = ['heavy', 'light'];
const INTENSITY_LABEL: Record<Intensity, string> = { heavy: 'Heavy', light: 'Light' };

/*
 * Each day added takes the next focus in this order, so three days cover the
 * body instead of landing on two Lower days — which is what a straight
 * upper/lower alternation gives you on an odd number of sessions. A screen of
 * identical "Full body" pickers would be a screen asking you to do its job.
 */
const FOCUS_ORDER: WorkoutFocus[] = ['lower', 'upper', 'full', 'push', 'pull', 'core'];

function defaultFocus(taken: WorkoutFocus[]): WorkoutFocus {
  return FOCUS_ORDER.find((option) => !taken.includes(option)) ?? 'full';
}

/*
 * The first two are heavy and the rest lighter. Days are picked one at a time,
 * so there is no final count to divide in half — and two hard sessions with
 * easier work around them is the shape the block was built on anyway.
 */
const HEAVY_DAYS = 2;

function defaultIntensity(index: number): Intensity {
  return index < HEAVY_DAYS ? 'heavy' : 'light';
}

export function WeekPlanSheet({
  days,
  onBuild,
  onClose,
  asking = false,
  progress,
  error,
}: {
  days: WeekPlanDay[];
  onBuild: (chosen: PlannedWeekDay[], note: string) => void;
  onClose: () => void;
  asking?: boolean;
  /** "2 of 4" while a run is in flight. One call per workout, so it is slow. */
  progress?: string;
  error?: string;
}) {
  const [chosen, setChosen] = useState<Record<string, PlannedWeekDay>>({});
  const [note, setNote] = useState('');

  const picked = days
    .filter((day) => chosen[day.date] !== undefined)
    .map((day) => chosen[day.date] as PlannedWeekDay);

  const toggle = (date: string) =>
    setChosen((prev) => {
      if (prev[date]) {
        const next = { ...prev };
        delete next[date];
        return next;
      }
      const already = Object.values(prev);
      return {
        ...prev,
        [date]: {
          date,
          focus: defaultFocus(already.map((day) => day.focus)),
          intensity: defaultIntensity(already.length),
        },
      };
    });

  const patch = (date: string, part: Partial<PlannedWeekDay>) =>
    setChosen((prev) => {
      const day = prev[date];
      return day ? { ...prev, [date]: { ...day, ...part } } : prev;
    });

  const chip = (active: boolean, onClick: () => void, label: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
        active ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Sheet
      title="Build the week"
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={asking || picked.length === 0}
          onClick={() => onBuild(picked, note)}
          className="h-cta w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
        >
          {asking
            ? `Building${progress ? ` ${progress}` : ''}…`
            : picked.length === 0
              ? 'Pick your training days'
              : `Build ${picked.length} workout${picked.length === 1 ? '' : 's'}`}
        </button>
      }
    >
      <Label className="mt-1 block">
        Pick the days you are training this week, then say how hard each one is and what it
        trains. One workout is built per day and lands on that day — this week only.
      </Label>

      <div className="mt-3 flex flex-col gap-1.5" role="group" aria-label="Training days">
        {days.map((day) => {
          const weekday = weekdayOf(day.date) as Weekday;
          const plan = chosen[day.date];
          const active = plan !== undefined;
          return (
            <div key={day.date} className="rounded-xl bg-surface px-3 py-2.5">
              <button
                type="button"
                disabled={day.golf}
                onClick={() => toggle(day.date)}
                /* Spelled out rather than left to run the two labels together,
                   the same way the week strip does it. */
                aria-label={`${WEEKDAY_LABEL[weekday]} ${day.date}${
                  day.golf ? ', golf' : active ? ', training' : day.taken ? `, ${day.taken}` : ''
                }`}
                className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-40"
              >
                <span className="text-[15px] font-semibold">
                  {WEEKDAY_LABEL[weekday]} {fromIsoDate(day.date).getDate()}
                </span>
                <span className="text-[11px] font-medium text-text-dim">
                  {day.golf
                    ? 'golf'
                    : active
                      ? 'training'
                      : day.taken
                        ? `has ${day.taken}`
                        : 'rest'}
                </span>
              </button>

              {active && (
                <>
                  <div className="mt-2 flex gap-1.5">
                    {INTENSITIES.map((option) =>
                      chip(
                        plan.intensity === option,
                        () => patch(day.date, { intensity: option }),
                        INTENSITY_LABEL[option],
                        option,
                      ),
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {WORKOUT_FOCUSES.map((option) =>
                      chip(
                        plan.focus === option,
                        () => patch(day.date, { focus: option }),
                        WORKOUT_FOCUS_LABEL[option],
                        option,
                      ),
                    )}
                  </div>
                  {day.taken && (
                    <Label className="mt-1.5 block">
                      {day.taken} is already on this day. A new workout replaces it here; the
                      old one keeps its exercises and goes back to having no day.
                    </Label>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <Label className="mt-4 block">Anything to add</Label>
      <textarea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional — applies to the whole week"
        className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] placeholder:text-text-faint"
      />

      {error && (
        <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
          {error}
        </p>
      )}

      <Label className="mt-3 block">
        Each day is built knowing what the earlier days took, so the week does not repeat
        itself. Every choice is checked against the rules — including grip work near a round —
        before it lands. It takes a few seconds a day.
      </Label>
    </Sheet>
  );
}
