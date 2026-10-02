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
import { ExerciseChart, WeeklyBarChart } from '../components/LazyCharts';
import type { ExerciseMetric, ExercisePoint } from '../components/Charts';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { pillLabel, slotFallback } from '../lib/dayLabel';
import { prEvents } from '../lib/prs';
import { MonthGrid } from '../components/MonthGrid';
import {
  TREND_WEEKS,
  exerciseTrends,
  muscleTrends,
  seriesTrend,
  weekStarts,
  weeklyVolume,
  type ExerciseTrendRow,
  type MuscleTrendRow,
  type Trend,
} from '../lib/progress';

/** Weeks on the charts: the eight the trend reads, plus context and this week. */
const CHART_WEEKS = 12;

const TREND_TEXT: Record<Trend, string> = {
  up: 'Rising',
  down: 'Falling',
  flat: 'Steady',
  new: 'New',
  idle: 'Dropped',
};

const TREND_COLOR: Record<Trend, string> = {
  up: 'var(--color-strength)',
  down: 'var(--color-warn)',
  flat: 'var(--color-text-dim)',
  new: 'var(--color-volume)',
  idle: 'var(--color-text-faint)',
};

const TREND_ARROW: Record<Trend, string> = {
  up: '▲',
  down: '▼',
  flat: '▬',
  new: '●',
  idle: '○',
};

function TrendTag({ trend }: { trend: Trend }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] font-semibold"
      style={{ color: TREND_COLOR[trend] }}
    >
      <span aria-hidden="true" className="text-[9px]">
        {TREND_ARROW[trend]}
      </span>
      {TREND_TEXT[trend]}
    </span>
  );
}

/**
 * A muscle's weeks at a glance. Hand-drawn rather than a chart: eighteen of
 * them would mean eighteen Recharts instances for what is nine rectangles.
 */
function MiniBars({ series, color }: { series: number[]; color: string }) {
  const max = Math.max(...series, 1);
  const w = 6;
  const gap = 2;
  const h = 20;
  return (
    <svg
      width={series.length * (w + gap) - gap}
      height={h}
      aria-hidden="true"
      className="shrink-0"
    >
      {series.map((value, i) => {
        const bh = value > 0 ? Math.max(2, (value / max) * h) : 1;
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1.5}
            fill={value > 0 ? color : 'var(--color-border)'}
            fillOpacity={i === series.length - 1 && value > 0 ? 0.35 : 1}
          />
        );
      })}
    </svg>
  );
}

/** Rising first, then the ones to act on, then the quiet ones. */
const TREND_ORDER: Trend[] = ['up', 'down', 'new', 'flat', 'idle'];

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

/**
 * One exercise over time: the chart and its toggles. Lives under its row in
 * the exercise list, so the lift being looked at is the one that was tapped.
 */
function ExerciseProgress({ exercise }: { exercise: Exercise }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [metric, setMetric] = useState<ExerciseMetric>('topSetKg');
  const activeId = exercise.id;

  /* The metric state survives a Change to an exercise it makes no sense for —
     Top set kg on a pull-up — so the shown metric is derived: the kept choice
     when the exercise can answer it, a metric of its own set when it cannot. */
  const mode = exercise.loadMode;
  const repUnit: 'reps' | 'sec' = exercise.repUnit === 'seconds' ? 'sec' : 'reps';
  const metrics =
    mode === 'weight' ? LOAD_METRICS : mode === 'band' ? BAND_METRICS : REP_METRICS;
  const labels = metricLabels(repUnit, mode === 'band');

  const series = useLiveQuery(async () => {
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

  const best = useMemo(() => {
    const values = (series ?? []).map((p) => p[activeMetric] ?? 0);
    return values.length ? Math.max(...values) : undefined;
  }, [series, activeMetric]);

  if (series === undefined) return null;
  if (series.length === 0) {
    return (
      <>
        <Empty>{EM_SETS}</Empty>
        <p className="mt-1 text-[12px] font-medium text-text-dim">
          Log an exercise twice and its progression shows up here — across blocks, not just within
          one.
        </p>
      </>
    );
  }

  return (
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
        points={series}
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

      {hasLoadTranslation(exercise) && (
        <p className="mt-3 text-[12px] font-medium text-strength">
          Charted on effective kg — ×{exercise.loadMultiplier.toFixed(2)} of the stack selection,
          so this sits on the same axis as the barbell lifts.
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
  );
}

function MuscleRow({
  row,
  weeks,
  open,
  onToggle,
}: {
  row: MuscleTrendRow;
  weeks: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const color = row.trend === 'idle' ? 'var(--color-text-faint)' : 'var(--color-muscle)';
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{row.name}</span>
          <TrendTag trend={row.trend} />
        </span>
        <MiniBars series={row.series} color={color} />
        <span className="w-[64px] shrink-0 text-right">
          <span className="block text-[14px] font-semibold">
            {row.recent > 0 ? kg(row.recent) : '--'}
          </span>
          <span className="block text-[11px] font-medium text-text-dim">
            {row.prior > 0 || row.recent > 0 ? `was ${kg(row.prior)}` : 'sets/wk'}
          </span>
        </span>
      </button>
      {open && (
        <div className="pb-3">
          <WeeklyBarChart
            bars={row.series.map((value, i) => ({ week: weeks[i] as string, value }))}
            average={row.recent}
            color="var(--color-muscle)"
            unit="sets"
          />
        </div>
      )}
    </div>
  );
}

function ExerciseRow({
  row,
  exercise,
  open,
  onToggle,
}: {
  row: ExerciseTrendRow;
  exercise: Exercise;
  open: boolean;
  onToggle: () => void;
}) {
  const unit = row.metricLabel === 'e1RM' ? 'kg e1RM' : row.metricLabel === 'band' ? 'kg band' : 'reps';
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{exercise.name}</span>
          <span className="flex items-center gap-2">
            <TrendTag trend={row.trend} />
            <span className="text-[11px] font-medium text-text-faint">
              {friendlyDate(row.lastDate)}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[14px] font-semibold">
            {row.recentBest !== undefined ? kg(row.recentBest) : kg(row.priorBest)}
          </span>
          <span className="block text-[11px] font-medium text-text-dim">
            {row.recentBest !== undefined && row.priorBest !== undefined
              ? `was ${kg(row.priorBest)} ${unit}`
              : unit}
          </span>
        </span>
      </button>
      {open && (
        <div className="pb-3">
          <ExerciseProgress exercise={exercise} />
        </div>
      )}
    </div>
  );
}

export function HistoryScreen({
  exercises,
  onOpen,
}: {
  exercises: Exercise[];
  onOpen: (sessionId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  /* undefined = the default (the most recent lift open); null = all shut. */
  const [openExercise, setOpenExercise] = useState<string | null | undefined>(undefined);
  /* An exercise reached through the picker that has no row of its own —
     nothing logged in the last eight weeks — shown above the list. */
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [openMuscle, setOpenMuscle] = useState<string | undefined>(undefined);
  const [volumeMetric, setVolumeMetric] = useState<'sets' | 'kg'>('sets');
  const [showAllMuscles, setShowAllMuscles] = useState(false);
  /* The month the log is showing. A date inside it, not a month string, so
     the grid and the shift arithmetic share one representation. */
  const [monthAnchor, setMonthAnchor] = useState(todayIso());

  const summaries = useLiveQuery(() => listSessionSummaries(), [], undefined);
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /* The whole log, once, for every weekly figure on the screen. */
  const progress = useLiveQuery(async () => {
    const today = todayIso();
    const weeks = weekStarts(today, CHART_WEEKS);
    const sessions = await db.session.where('date').aboveOrEqual(weeks[0] as string).toArray();
    const dateBySession = new Map(sessions.map((s) => [s.id, s.date]));
    const logs = (await db.setLog.toArray()).filter((log) => dateBySession.has(log.sessionId));
    const weekly = weeklyVolume(logs, dateBySession, byId, weeks);
    return {
      weeks,
      weekly,
      muscles: muscleTrends(weekly),
      exercises: exerciseTrends(logs, dateBySession, byId, today),
    };
  }, [byId]);

  const totals = useMemo(() => {
    if (!progress) return undefined;
    const series = progress.weekly.map((w) => (volumeMetric === 'sets' ? w.sets : w.tonnageKg));
    return {
      bars: progress.weekly.map((w, i) => ({ week: w.week, value: series[i] as number })),
      ...seriesTrend(series),
      thisWeek: series.at(-1) ?? 0,
    };
  }, [progress, volumeMetric]);

  const muscleGroups = useMemo(() => {
    const rows = progress?.muscles ?? [];
    const trained = rows.filter((row) => row.series.some((value) => value > 0));
    return TREND_ORDER.flatMap((trend) =>
      trained
        .filter((row) => row.trend === trend)
        .sort((a, b) => b.recent - a.recent || a.name.localeCompare(b.name)),
    );
  }, [progress]);
  const untrainedMuscles = (progress?.muscles ?? []).filter((row) =>
    row.series.every((value) => value === 0),
  );
  const shownMuscles = showAllMuscles ? muscleGroups : muscleGroups.slice(0, 8);

  const exerciseRows = (progress?.exercises ?? []).filter((row) => byId.has(row.exerciseId));
  const expanded = openExercise === undefined ? exerciseRows[0]?.exerciseId : openExercise;
  const pickedExercise =
    pickedId && !exerciseRows.some((row) => row.exerciseId === pickedId)
      ? byId.get(pickedId)
      : undefined;

  const counts = useMemo(() => {
    const out: Partial<Record<Trend, number>> = {};
    for (const row of exerciseRows) out[row.trend] = (out[row.trend] ?? 0) + 1;
    return out;
  }, [exerciseRows]);

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

  /* Days whose session set a record, replayed from the whole log each time —
     a record is a fact about the past, cheap to recompute at this size. */
  const prDates = useLiveQuery(async () => {
    const logs = await db.setLog.toArray();
    const sessions = await db.session.toArray();
    const dateBySession = new Map(sessions.map((session) => [session.id, session.date]));
    return new Set(prEvents(logs, dateBySession, byId).keys());
  }, [byId]);

  /* The data's own edges. summaries are newest first, so the last is the
     oldest — and with nothing logged, the current month is the only one. */
  const earliestMonth = (summaries?.at(-1)?.session.date ?? todayIso()).slice(0, 7);
  const currentMonth = todayIso().slice(0, 7);
  const thisWeekStart = weekStart(todayIso());
  const hasRecent = (totals?.bars ?? []).some((bar) => bar.value > 0);
  const volumeUnit = volumeMetric === 'sets' ? 'sets' : 'kg';

  return (
    <>
      <Screen title="History">
        <Card
          title="Weekly volume"
          trailing={totals && hasRecent ? <TrendTag trend={totals.trend} /> : undefined}
        >
          {!totals || !hasRecent ? (
            <Empty>{EM_SETS}</Empty>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div>
                  <span className="stat-sm block" style={{ color: 'var(--color-volume)' }}>
                    {kg(totals.recent)}
                  </span>
                  <Label>{volumeUnit}/wk, last {TREND_WEEKS}</Label>
                </div>
                <div>
                  <span className="stat-sm block text-text-dim">{kg(totals.prior)}</span>
                  <Label>{TREND_WEEKS} before</Label>
                </div>
                <div>
                  <span className="stat-sm block text-text-dim">{kg(totals.thisWeek)}</span>
                  <Label>this week so far</Label>
                </div>
              </div>
              <WeeklyBarChart bars={totals.bars} average={totals.recent} unit={volumeUnit} />
              <div className="mt-3">
                <SegmentedToggle
                  options={['sets', 'kg'] as const}
                  value={volumeMetric}
                  onChange={setVolumeMetric}
                  labels={{ sets: 'Working sets', kg: 'Kg lifted' }}
                />
              </div>
              <p className="mt-3 text-[12px] font-medium text-text-dim">
                {volumeMetric === 'sets'
                  ? 'Hard sets are the volume that drives growth. The trend compares your last four full weeks with the four before; this week is left out until it is over.'
                  : 'Effective kg × reps. Useful context, but a heavy triple and a light twelve can total the same — judge growth on sets, strength on the lifts below.'}
              </p>
            </>
          )}
        </Card>

        <Card
          title="Muscles"
          className="mt-3"
          trailing={<Label>sets/wk · last {TREND_WEEKS} wks</Label>}
        >
          {muscleGroups.length === 0 ? (
            <Empty>{EM_SETS}</Empty>
          ) : (
            <>
              {shownMuscles.map((row) => (
                <MuscleRow
                  key={row.muscleId}
                  row={row}
                  weeks={progress?.weeks ?? []}
                  open={openMuscle === row.muscleId}
                  onToggle={() =>
                    setOpenMuscle((prev) => (prev === row.muscleId ? undefined : row.muscleId))
                  }
                />
              ))}
              {muscleGroups.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAllMuscles((prev) => !prev)}
                  className="mt-1 w-full rounded-lg bg-surface-2 py-2 text-[13px] font-medium text-text-dim"
                >
                  {showAllMuscles ? 'Show fewer' : `Show all ${muscleGroups.length}`}
                </button>
              )}
              {untrainedMuscles.length > 0 && (
                <p className="mt-3 text-[13px] font-medium text-text-dim">
                  Not trained in {CHART_WEEKS} weeks:{' '}
                  {untrainedMuscles.map((row) => row.name).join(', ')}.
                </p>
              )}
              <p className="mt-2 text-[12px] font-medium text-text-dim">
                1 set per primary muscle, 0.5 per secondary. Steady means within a set a week
                (or 10%) of the four weeks before.
              </p>
            </>
          )}
        </Card>

        <Card
          title="Exercises"
          className="mt-3"
          trailing={
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
            >
              Other
            </button>
          }
        >
          {exerciseRows.length > 0 && (
            <p className="mb-2 text-[13px] font-medium text-text-dim">
              {[
                counts.up && `${counts.up} rising`,
                counts.flat && `${counts.flat} steady`,
                counts.down && `${counts.down} falling`,
                counts.new && `${counts.new} new`,
                counts.idle && `${counts.idle} dropped`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {pickedExercise && (
            <div className="mb-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[14px] font-medium">{pickedExercise.name}</span>
                <span className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDetailId(pickedExercise.id)}
                    className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
                  >
                    About
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickedId(undefined)}
                    className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
                  >
                    Close
                  </button>
                </span>
              </div>
              <ExerciseProgress exercise={pickedExercise} />
            </div>
          )}

          {exerciseRows.length === 0 && !pickedExercise ? (
            <>
              <Empty>{EM_SETS}</Empty>
              <p className="mt-1 text-[12px] font-medium text-text-dim">
                Log an exercise twice and its progression shows up here — across blocks, not just
                within one.
              </p>
            </>
          ) : (
            exerciseRows.map((row) => (
              <ExerciseRow
                key={row.exerciseId}
                row={row}
                exercise={byId.get(row.exerciseId) as Exercise}
                open={expanded === row.exerciseId}
                onToggle={() =>
                  setOpenExercise(expanded === row.exerciseId ? null : row.exerciseId)
                }
              />
            ))
          )}
          {exerciseRows.length > 0 && (
            <p className="mt-2 text-[12px] font-medium text-text-dim">
              Best set in the last four weeks against the four before — estimated 1-RM for loaded
              lifts, so 60 × 10 and 65 × 8 compare fairly. Reps for bodyweight work.
            </p>
          )}
        </Card>

        <h2 className="label mt-5 mb-2 block">Session log</h2>

        <MonthGrid
          anchor={monthAnchor}
          weekCount={(summaries ?? []).filter((row) => row.session.date >= thisWeekStart).length}
          sessionCountByDate={sessionCountByDate}
          labelByDate={labelByDate}
          golfDates={golfDates ?? new Set()}
          prDates={prDates}
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
          selectedIds={pickedId ? [pickedId] : []}
          onPick={(id) => {
            /* A lift with a row of its own opens there; anything else gets
               the slot above the list. */
            if (exerciseRows.some((row) => row.exerciseId === id)) {
              setOpenExercise(id);
              setPickedId(undefined);
            } else {
              setPickedId(id);
            }
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
