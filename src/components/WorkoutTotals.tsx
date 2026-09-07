import type { WorkoutTotal } from '../lib/sessions';
import { friendlyDate, kg } from '../lib/format';
import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  What every workout has added up to.                                       */
/*                                                                            */
/*  The session log below it answers "what did I do on the 3rd". This answers  */
/*  "what have I actually been doing", which is the question a week rolling    */
/*  over used to make unanswerable: the dashboard counts THIS week, and on a   */
/*  Monday morning that is nothing at all.                                    */
/*                                                                            */
/*  Grouped by the name each session was logged under. That is the durable     */
/*  record — the workout it came from can be deleted, and its slot letter      */
/*  reused by something else entirely.                                        */
/* -------------------------------------------------------------------------- */

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="min-w-0 flex-1 text-center">
      <span className="block truncate text-[19px] font-semibold tabular-nums">{value}</span>
      <span className="mt-0.5 block truncate text-[11px] font-medium text-text-dim">{label}</span>
    </span>
  );
}

export function WorkoutTotals({ totals }: { totals: WorkoutTotal[] }) {
  if (totals.length === 0) return null;

  const sessions = totals.reduce((sum, row) => sum + row.times, 0);
  const sets = totals.reduce((sum, row) => sum + row.sets, 0);
  const volume = totals.reduce((sum, row) => sum + row.volumeKg, 0);

  return (
    <Card title="Every workout, all time">
      <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-2 py-3">
        <Figure value={String(sessions)} label={sessions === 1 ? 'session' : 'sessions'} />
        <Figure value={String(sets)} label="sets" />
        <Figure value={`${kg(volume)} kg`} label="volume" />
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {totals.map((row) => (
          <div
            key={row.name}
            className="flex items-stretch gap-3 overflow-hidden rounded-xl bg-surface-2"
          >
            <span
              className="w-1 shrink-0 self-stretch"
              style={{ background: 'var(--color-volume)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 py-2.5 pr-3.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium">{row.name}</span>
                <Label>{friendlyDate(row.lastDate)}</Label>
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-medium text-text-dim">
                {row.times} {row.times === 1 ? 'time' : 'times'} · {row.sets} sets
                {row.volumeKg > 0 ? ` · ${kg(row.volumeKg)} kg` : ''}
                {row.minutes > 0 ? ` · ${row.minutes} min` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
