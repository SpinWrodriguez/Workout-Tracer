import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { listSessionSummaries } from '../lib/sessions';
import { EM_SETS, kg, monthTitle, shiftMonth, todayIso, weekStart } from '../lib/format';
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
import { pillLabel, slotFallback } from '../lib/dayLabel';
import { MonthGrid } from '../components/MonthGrid';

/*
 * Which metrics an exercise can answer for depends on how it loads. Unloaded
 * work (bodyweight, band) logs no kg at all, so top set, 1-RM and kg volume
 * are flat zeros for it — the chart sat empty on exactly the exercise the
 * default most often picks (pull-ups). Its record is reps, so it gets rep
 * metrics instead of a dead toggle.
 */
const LOAD_METRICS: ExerciseMetric[] = ['topSetKg', 'oneRm', 'volumeKg'];
const REP_METRICS: ExerciseMetric[] = ['topReps', 'volumeReps'];
/* Bands log the rating on the band, so which band trends like a top set —
   but the kg is nominal (tension varies over the stretch), so no 1-RM, and
   volume-as-kg would multiply a nominal number. The band and the reps. */
const BAND_METRICS: ExerciseMetric[] = ['topSetKg', 'volumeReps'];

/** The metrics whose numbers are kilograms; everything else counts reps. */
const KG_METRICS: ExerciseMetric[] = ['topSetKg', 'oneRm', 'volumeKg'];

/** `unit` names what an unloaded exercise counts: reps, or seconds for holds. */
function metricLabels(unit: 'reps' | 'sec', band: boolean): Record<ExerciseMetric, string> {
  return {
    topSetKg: band ? 'Top band' : 'Top set',
    oneRm: 'Est. 1-RM',
    volumeKg: 'Volume',
    topReps: 'Top set',
    volumeReps: unit === 'sec' ? 'Total time' : 'Total reps',
  };
}

export function HistoryScreen({
  exercises,
  onOpen,
}: {
  exercises: Exercise[];
  onOpen: (sessionId: string) => void;
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

  /* The metric state survives a Change to an exercise it makes no sense for —
     Top set kg on a pull-up — so the shown metric is derived: the kept choice
     when the exercise can answer it, a metric of its own set when it cannot. */
  const mode = activeExercise?.loadMode ?? 'weight';
  const repUnit: 'reps' | 'sec' = activeExercise?.repUnit === 'seconds' ? 'sec' : 'reps';
  const metrics =
    mode === 'weight' ? LOAD_METRICS : mode === 'band' ? BAND_METRICS : REP_METRICS;
  const labels = metricLabels(repUnit, mode === 'band');

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
          /* The rep metrics, for unloaded work. The top-set reduce above ties
             on effectiveKg (all absent) and falls through to reps, so `top`
             is already the biggest set. */
          topReps: top.reps,
          volumeReps: list.reduce((sum, l) => sum + l.reps, 0),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return points;
  }, [activeId, timeframe]);

  /* Band history from before ratings were logged carries no kg, so falling
     back blindly to the metric set's first entry would re-create the dead
     chart this card just escaped. Prefer a metric that has data in it. */
  const activeMetric = metrics.includes(metric)
    ? metric
    : (metrics.find((m) => (series ?? []).some((p) => (p[m] ?? 0) > 0)) ??
      (metrics[0] as ExerciseMetric));

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

  /* What each trained cell says about itself: the workout's initials, in the
     week strip's pill language. Summaries run newest first, so on the rare
     day with two sessions the newest one names the cell. */
  const labelByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const summary of summaries ?? []) {
      if (!map.has(summary.session.date)) {
        map.set(
          summary.session.date,
          pillLabel(summary.session.daySlotName ?? slotFallback(summary.session.daySlot)),
        );
      }
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
    const values = (series ?? []).map((p) => p[activeMetric] ?? 0);
    return values.length ? Math.max(...values) : undefined;
  }, [series, activeMetric]);

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
                {/* "Top set" alone reads as kg, so it names its unit; the
                    total metrics already carry theirs in the label. */}
                <Label>
                  best {labels[activeMetric].toLowerCase()}
                  {activeMetric === 'topReps' ? ` (${repUnit})` : ''} in range
                </Label>
              </div>

              <ExerciseChart
                points={series ?? []}
                metric={activeMetric}
                unit={KG_METRICS.includes(activeMetric) ? 'kg' : repUnit}
              />

              <div className="mt-3">
                <SegmentedToggle
                  options={metrics}
                  value={activeMetric}
                  onChange={setMetric}
                  labels={labels}
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
              {mode !== 'weight' && (
                <p className="mt-3 text-[12px] font-medium text-text-dim">
                  {mode === 'band'
                    ? 'Band kg is the rating printed on the band, so this tracks which band you used and the total reps.'
                    : `${
                        mode === 'bodyweight'
                          ? 'Bodyweight work carries no load'
                          : 'This drill carries no load'
                      }, so the chart tracks ${
                        repUnit === 'sec' ? 'seconds held' : 'reps'
                      } — best set and session total.`}
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
          labelByDate={labelByDate}
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
