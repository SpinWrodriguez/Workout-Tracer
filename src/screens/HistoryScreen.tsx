import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { listSessionSummaries } from '../lib/sessions';
import { EM_SETS, friendlyDate, kg, monthTitle, shiftMonth, todayIso, weekStart } from '../lib/format';
import { hasLoadTranslation } from '../lib/load';
import {
  TIMEFRAMES,
  estimate1RM,
  timeframeCutoff,
  type Timeframe,
} from '../lib/stats';
import { Card, Empty, Label, Screen, SegmentedToggle } from '../components/Layout';
import { ExerciseChart } from '../components/LazyCharts';
import type { ExerciseMetric, ExercisePoint } from '../components/Charts';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { slotFallback } from '../lib/dayLabel';
import { MonthGrid } from '../components/MonthGrid';

const METRICS: ExerciseMetric[] = ['topSetKg', 'oneRm', 'volumeKg'];
const METRIC_LABEL: Record<ExerciseMetric, string> = {
  topSetKg: 'Top set',
  oneRm: 'Est. 1-RM',
  volumeKg: 'Volume',
};

export function HistoryScreen({
  exercises,
  onOpen,
  onAsk,
}: {
  exercises: Exercise[];
  onOpen: (sessionId: string) => void;
  /**
   * Hands one session to the coach as a question. Absent when there is no
   * model to answer it, so the chip is not offered where nothing can.
   */
  onAsk?: (question: string) => void;
}) {
  const [exerciseId, setExerciseId] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [metric, setMetric] = useState<ExerciseMetric>('topSetKg');
  /* The month the log is showing. A date inside it, not a month string, so
     the grid and the shift arithmetic share one representation. */
  const [monthAnchor, setMonthAnchor] = useState(todayIso());

  const summaries = useLiveQuery(() => listSessionSummaries(), [], undefined);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /** Most-logged exercise, so the chart has something in it on arrival. */
  const defaultExerciseId = useLiveQuery(async () => {
    const logs = await db.setLog.toArray();
    const counts = new Map<string, number>();
    for (const log of logs) counts.set(log.exerciseId, (counts.get(log.exerciseId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, []);

  const activeId = exerciseId ?? defaultExerciseId;
  const activeExercise = activeId ? byId.get(activeId) : undefined;

  const series = useLiveQuery(async () => {
    if (!activeId) return [];
    const logs = await db.setLog.where('exerciseId').equals(activeId).toArray();
    if (logs.length === 0) return [];
    const sessions = await db.session.bulkGet([...new Set(logs.map((l) => l.sessionId))]);
    const dateById = new Map(
      sessions.filter((s) => s !== undefined).map((s) => [s.id, s.date]),
    );

    const cutoff = timeframeCutoff(timeframe, todayIso());
    const bySession = new Map<string, typeof logs>();
    for (const log of logs) {
      const date = dateById.get(log.sessionId);
      if (!date || (cutoff && date < cutoff)) continue;
      const list = bySession.get(log.sessionId) ?? [];
      list.push(log);
      bySession.set(log.sessionId, list);
    }

    const points: ExercisePoint[] = [...bySession.entries()]
      .map(([sessionId, list]) => {
        // Compare on effectiveKg, never the loaded number (spec §5 rule 2).
        const top = list.reduce(
          (best, log) =>
            (log.effectiveKg ?? 0) > (best.effectiveKg ?? 0) ||
            ((log.effectiveKg ?? 0) === (best.effectiveKg ?? 0) && log.reps > best.reps)
              ? log
              : best,
          list[0] as (typeof list)[number],
        );
        return {
          date: dateById.get(sessionId) ?? '',
          topSetKg: top.effectiveKg,
          oneRm: top.effectiveKg ? estimate1RM(top.effectiveKg, top.reps) : undefined,
          volumeKg: Math.round(list.reduce((sum, l) => sum + (l.effectiveKg ?? 0) * l.reps, 0)),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return points;
  }, [activeId, timeframe]);

  /* The month on show, and only it: the grid above is the way to the rest.
     A flat all-time list was the thing that got messy. */
  const monthSummaries = useMemo(() => {
    const month = monthAnchor.slice(0, 7);
    return (summaries ?? []).filter((summary) => summary.session.date.startsWith(month));
  }, [summaries, monthAnchor]);

  const sessionCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const summary of summaries ?? []) {
      map.set(summary.session.date, (map.get(summary.session.date) ?? 0) + 1);
    }
    return map;
  }, [summaries]);

  const golfDates = useLiveQuery(
    async () => new Set((await db.golfDay.toArray()).map((day) => day.date)),
    [],
  );

  /* The data's own edges. summaries are newest first, so the last is the
     oldest — and with nothing logged, the current month is the only one. */
  const earliestMonth = (summaries?.at(-1)?.session.date ?? todayIso()).slice(0, 7);
  const currentMonth = todayIso().slice(0, 7);
  const thisWeekStart = weekStart(todayIso());

  const best = useMemo(() => {
    const values = (series ?? []).map((p) => p[metric] ?? 0);
    return values.length ? Math.max(...values) : undefined;
  }, [series, metric]);

  return (
    <>
      <Screen title="History">
        <Card
          title={activeExercise?.name ?? 'Per-exercise history'}
          trailing={
            <span className="flex gap-1.5">
              {activeExercise && (
                <button
                  type="button"
                  onClick={() => setDetailId(activeExercise.id)}
                  className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
                >
                  About
                </button>
              )}
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
              >
                Change
              </button>
            </span>
          }
        >
          {!activeExercise || (series?.length ?? 0) === 0 ? (
            <>
              <Empty>{EM_SETS}</Empty>
              <p className="mt-1 text-[12px] font-medium text-text-dim">
                Log an exercise twice and its progression shows up here — across blocks, not just
                within one.
              </p>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-baseline gap-2">
                <span className="stat-sm" style={{ color: 'var(--color-strength)' }}>
                  {best === undefined ? '--' : kg(best)}
                </span>
                <Label>best {METRIC_LABEL[metric].toLowerCase()} in range</Label>
              </div>

              <ExerciseChart points={series ?? []} metric={metric} />

              <div className="mt-3">
                <SegmentedToggle
                  options={METRICS}
                  value={metric}
                  onChange={setMetric}
                  labels={METRIC_LABEL}
                />
              </div>
              <div className="mt-2">
                <SegmentedToggle options={TIMEFRAMES} value={timeframe} onChange={setTimeframe} />
              </div>

              {hasLoadTranslation(activeExercise) && (
                <p className="mt-3 text-[12px] font-medium text-strength">
                  Charted on effective kg — ×{activeExercise.loadMultiplier.toFixed(2)} of the stack
                  selection, so this sits on the same axis as the barbell lifts.
                </p>
              )}
              {activeExercise.loadMode !== 'weight' && (
                <p className="mt-3 text-[12px] font-medium text-text-dim">
                  {activeExercise.loadMode === 'bodyweight'
                    ? 'Bodyweight work carries no load, so only volume moves here.'
                    : 'Band resistance is not quantifiable — reps and RPE only.'}
                </p>
              )}
            </>
          )}
        </Card>

        <h2 className="label mt-5 mb-2 block">Session log</h2>

        <MonthGrid
          anchor={monthAnchor}
          weekCount={(summaries ?? []).filter((row) => row.session.date >= thisWeekStart).length}
          sessionCountByDate={sessionCountByDate}
          golfDates={golfDates ?? new Set()}
          canGoBack={monthAnchor.slice(0, 7) > earliestMonth}
          canGoForward={monthAnchor.slice(0, 7) < currentMonth}
          onShift={(delta) => setMonthAnchor(shiftMonth(monthAnchor, delta))}
          onToday={() => setMonthAnchor(todayIso())}
          /* A day holds one session almost always; when it holds two, the most
             recent is the one being looked for. */
          onPickDay={(date) => {
            const hit = (summaries ?? []).find((summary) => summary.session.date === date);
            if (hit) onOpen(hit.session.id);
          }}
        />

        {summaries !== undefined && summaries.length === 0 && (
          <Card title="Nothing logged yet" className="mt-3">
            <p className="text-text-dim">{EM_SETS}</p>
            <p className="mt-2 text-[13px] text-text-dim">
              Tap the + to log a session. Past dates are fine — set the date in Session details.
            </p>
          </Card>
        )}

        {summaries !== undefined && summaries.length > 0 && monthSummaries.length === 0 && (
          <p className="mt-3 text-[13px] font-medium text-text-dim">
            Nothing logged in {monthTitle(monthAnchor)}.
          </p>
        )}

        {monthSummaries.length > 0 && (
          <div className="mt-3 mb-5">
            <div className="overflow-hidden rounded-2xl bg-surface">
              {monthSummaries.map((summary, i) => (
                <div
                  key={summary.session.id}
                  className={`relative ${i > 0 ? 'border-t border-border' : ''}`}
                >
                {/* Its own button rather than something inside the row: a
                    button inside a button is not a thing a browser will
                    render, and the row already means "open it". */}
                {onAsk && (
                  <button
                    type="button"
                    onClick={() =>
                      onAsk(
                        `About my ${
                          summary.session.daySlotName ?? slotFallback(summary.session.daySlot)
                        } session on ${summary.session.date}: how did it go, and what should I change next time?`,
                      )
                    }
                    aria-label={`Ask about ${friendlyDate(summary.session.date)}`}
                    className="absolute right-3 bottom-2.5 z-10 rounded-full px-3 py-1 text-[11px] font-semibold"
                    style={{ background: 'var(--color-bodyweight)', color: 'var(--color-bg)' }}
                  >
                    Ask
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(summary.session.id)}
                  className="w-full px-4 py-3.5 pr-16 text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="card-title">
                      {friendlyDate(summary.session.date)}
                      <span className="ml-2 text-[12px] font-medium text-text-dim">
                        {summary.session.daySlotName ?? slotFallback(summary.session.daySlot)}
                      </span>
                    </span>
                    <span
                      className="text-[15px] font-semibold"
                      style={{ color: 'var(--color-volume)' }}
                    >
                      {summary.setCount}
                      {/* Only when they differ: "12 of 12" on a finished
                          session is noise, "8 of 12" is the whole point. */}
                      {summary.plannedCount > summary.setCount && (
                        <span className="text-[13px] font-medium text-text-dim">
                          {' of '}
                          {summary.plannedCount}
                        </span>
                      )}
                      <span className="ml-1 text-[11px] font-medium text-text-dim">sets</span>
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] font-medium text-text-dim">
                    {summary.exerciseIds.length === 0
                      ? '---'
                      : summary.exerciseIds.map((id) => byId.get(id)?.name ?? id).join(' · ')}
                  </p>
                  {/* Planned and never started. The one thing a set log can
                      never tell you, because there is no row for it. */}
                  {summary.untouched.length > 0 && (
                    <p className="mt-1 truncate text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
                      Not started: {summary.untouched.map((id) => byId.get(id)?.name ?? id).join(' · ')}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-medium text-text-faint">
                    {kg(summary.volumeKg)} kg effective volume
                    {summary.session.durationMin ? ` · ${summary.session.durationMin} min` : ''}
                  </p>
                </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Screen>

      {picking && (
        <ExercisePicker
          exercises={exercises}
          selectedIds={activeId ? [activeId] : []}
          onPick={(id) => {
            setExerciseId(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
          onInfo={setDetailId}
        />
      )}

      {detailId && byId.get(detailId) && (
        <ExerciseDetail
          exercise={byId.get(detailId) as Exercise}
          onClose={() => setDetailId(undefined)}
        />
      )}
    </>
  );
}
