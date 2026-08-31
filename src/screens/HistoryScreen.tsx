import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Exercise } from '../db/types';
import { listSessionSummaries } from '../lib/sessions';
import { friendlyDate, kg } from '../lib/format';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { EM_SETS } from '../lib/format';

export function HistoryScreen({
  exercises,
  onOpen,
}: {
  exercises: Exercise[];
  onOpen: (sessionId: string) => void;
}) {
  const summaries = useLiveQuery(() => listSessionSummaries(), [], undefined);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof summaries>();
    for (const s of summaries ?? []) {
      const month = s.session.date.slice(0, 7);
      const list = map.get(month) ?? [];
      list!.push(s);
      map.set(month, list);
    }
    return [...map.entries()];
  }, [summaries]);

  return (
    <Screen title="History">
      {summaries === undefined && <Empty>--</Empty>}

      {summaries !== undefined && summaries.length === 0 && (
        <Card title="Nothing logged yet">
          <p className="text-text-dim">{EM_SETS}</p>
          <p className="mt-2 text-[13px] text-text-dim">
            Tap the + to log a session. Past dates are fine — set the date in Session details.
          </p>
        </Card>
      )}

      {grouped.map(([month, list]) => (
        <div key={month} className="mb-5">
          <Label className="mb-2 block">
            {new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </Label>
          <div className="overflow-hidden rounded-2xl bg-surface">
            {(list ?? []).map((summary, i) => (
              <button
                key={summary.session.id}
                type="button"
                onClick={() => onOpen(summary.session.id)}
                className={`w-full px-4 py-3.5 text-left ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="card-title">
                    {friendlyDate(summary.session.date)}
                    <span className="ml-2 text-[12px] font-medium text-text-dim">
                      day {summary.session.daySlot}
                    </span>
                  </span>
                  <span className="text-[15px] font-semibold" style={{ color: 'var(--color-volume)' }}>
                    {summary.setCount}
                    <span className="ml-1 text-[11px] font-medium text-text-dim">sets</span>
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px] font-medium text-text-dim">
                  {summary.exerciseIds.length === 0
                    ? '---'
                    : summary.exerciseIds
                        .map((id) => byId.get(id)?.name ?? id)
                        .join(' · ')}
                </p>
                <p className="mt-1 text-[11px] font-medium text-text-faint">
                  {kg(summary.volumeKg)} kg effective volume
                  {summary.session.durationMin ? ` · ${summary.session.durationMin} min` : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Screen>
  );
}
