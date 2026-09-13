import { WEEKDAY_LABEL, monthGrid, weekdayOf, type Weekday } from '../lib/golf';
import { fromIsoDate, monthTitle, todayIso } from '../lib/format';
import { EFFORT_COLOR } from '../lib/effort';

import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  One month of training, as the index into History.                         */
/*                                                                            */
/*  A rolling 30-day window is good at "have I been consistent lately" and     */
/*  useless as an index: it has no stable shape, so the session being looked   */
/*  for sits in a different cell every day. Calendar months are the            */
/*  coordinates the lifter already thinks in, and one month is ~a dozen        */
/*  sessions — small enough to fit above the fold at tappable size, which 12   */
/*  months of dots never would on a phone.                                    */
/*                                                                            */
/*  The colour language is the strip's: trained days filled with the done      */
/*  colour, a round marked in the golf blue. Nothing new to learn.            */
/* -------------------------------------------------------------------------- */

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function MonthGrid({
  anchor,
  sessionCountByDate,
  golfDates,
  canGoBack,
  canGoForward,
  onShift,
  onToday,
  onPickDay,
}: {
  /** Any date inside the month to show. */
  anchor: string;
  sessionCountByDate: Map<string, number>;
  golfDates: Set<string>;
  /** False past the edge of the data, so the arrows never walk into a void. */
  canGoBack: boolean;
  canGoForward: boolean;
  onShift: (delta: number) => void;
  onToday: () => void;
  /** Only ever called for a day that has at least one session. */
  onPickDay: (date: string) => void;
}) {
  const today = todayIso();
  const month = anchor.slice(0, 7);

  return (
    <Card
      title={monthTitle(anchor)}
      trailing={
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onShift(-1)}
            disabled={!canGoBack}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim disabled:opacity-40"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onShift(1)}
            disabled={!canGoForward}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim disabled:opacity-40"
            aria-label="Next month"
          >
            ›
          </button>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <Label key={day} className="text-center">
            {WEEKDAY_LABEL[day]}
          </Label>
        ))}
        {monthGrid(anchor).map((date) => {
          const inMonth = date.startsWith(month);
          const sessions = sessionCountByDate.get(date) ?? 0;
          const golf = golfDates.has(date);
          const isToday = date === today;

          /* Days of the neighbouring months render as gaps, not as dimmer
             days: a cell that can be read can be miscounted, and the month's
             own shape is the whole point of a month view. */
          if (!inMonth) return <span key={date} aria-hidden="true" />;

          return (
            <button
              key={date}
              type="button"
              disabled={sessions === 0}
              onClick={() => onPickDay(date)}
              aria-label={`${WEEKDAY_LABEL[weekdayOf(date)]} ${date}${
                sessions > 0 ? `, ${sessions} ${sessions === 1 ? 'session' : 'sessions'}` : ''
              }${golf ? ', golf' : ''}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-[12px] font-semibold ${
                sessions > 0
                  ? 'bg-cta text-bg'
                  : date > today
                    ? 'text-text-faint'
                    : 'bg-surface-2 text-text-dim'
              } ${isToday ? 'outline-2 outline-cta' : ''}`}
            >
              {fromIsoDate(date).getDate()}
              {/* The round is the dot, exactly as on the week strip. */}
              {golf && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 size-1.5 rounded-full"
                  style={{ background: EFFORT_COLOR.golf }}
                />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
