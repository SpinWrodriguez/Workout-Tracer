import { WEEKDAY_LABEL, monthGrid, weekdayOf, type Weekday } from '../lib/golf';
import { monthTitle, todayIso } from '../lib/format';
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
/*                                                                            */
/*  The cells carry no day numbers, on the lifter's own call — the look is     */
/*  their Apple-widget example, quiet squares and one accent. Position under   */
/*  the weekday header says when; the exact date lives in each cell's          */
/*  aria-label and in the session the tap opens.                              */
/* -------------------------------------------------------------------------- */

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The month's dates, minus any leading or trailing week entirely outside it. */
function weeksOf(anchor: string): string[] {
  const month = anchor.slice(0, 7);
  const weeks: string[][] = [];
  const grid = monthGrid(anchor);
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));
  return weeks.filter((week) => week.some((date) => date.startsWith(month))).flat();
}

export function MonthGrid({
  anchor,
  sessionCountByDate,
  golfDates,
  canGoBack,
  canGoForward,
  onShift,
  onToday,
  onPickDay,
  weekCount,
}: {
  /** Any date inside the month to show. */
  anchor: string;
  sessionCountByDate: Map<string, number>;
  golfDates: Set<string>;
  /** Sessions in the CURRENT week, for the example's "N this week" line. */
  weekCount: number;
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
  const currentMonth = month === today.slice(0, 7);
  const monthCount = [...sessionCountByDate.entries()]
    .filter(([date]) => date.startsWith(month))
    .reduce((sum, [, count]) => sum + count, 0);

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
      {/* Small on purpose — the reference is a widget, and half the point of
          a glanceable grid is that it does not push the list off the screen.
          28px keeps a usable thumb target; weeks with no day of this month in
          them are not rendered at all. */}
      <div className="grid w-fit grid-cols-7 gap-1.5">
        {WEEKDAYS.map((day) => (
          <span key={day} className="w-7 text-center text-[9px] font-semibold text-text-faint">
            {WEEKDAY_LABEL[day]}
          </span>
        ))}
        {weeksOf(anchor).map((date) => {
          const inMonth = date.startsWith(month);
          const sessions = sessionCountByDate.get(date) ?? 0;
          const golf = golfDates.has(date);
          const isToday = date === today;

          /* Days of the neighbouring months render as gaps, not as dimmer
             days: a cell that can be read can be miscounted, and the month's
             own shape is the whole point of a month view. */
          if (!inMonth) return <span key={date} aria-hidden="true" className="size-7" />;

          return (
            <button
              key={date}
              type="button"
              disabled={sessions === 0}
              onClick={() => onPickDay(date)}
              aria-label={`${WEEKDAY_LABEL[weekdayOf(date)]} ${date}${
                sessions > 0 ? `, ${sessions} ${sessions === 1 ? 'session' : 'sessions'}` : ''
              }${golf ? ', golf' : ''}`}
              className={`relative size-7 rounded-md ${
                sessions > 0 ? 'bg-cta' : date > today ? 'bg-surface-2 opacity-40' : 'bg-surface-2'
              } ${isToday ? 'outline-2 outline-cta' : ''}`}
            >
              {/* The round is the dot, exactly as on the week strip. */}
              {golf && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0.5 mx-auto size-1 rounded-full"
                  style={{ background: EFFORT_COLOR.golf }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* The example's footer line, kept honest about which month is open. */}
      <div className="mt-2.5 border-t border-border pt-2">
        <span className="stat-sm">{currentMonth ? weekCount : monthCount}</span>
        <Label className="ml-1.5">
          {currentMonth ? 'this week' : `in ${monthTitle(anchor).split(' ')[0]?.toLowerCase()}`}
        </Label>
      </div>
    </Card>
  );
}
