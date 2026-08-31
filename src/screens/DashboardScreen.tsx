import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise } from '../db/types';
import { EM_WEIGHT, friendlyDate, kg, rate, shiftIso, todayIso, weekStart } from '../lib/format';
import { linearTrend, rollingAverage, type DatedPoint } from '../lib/stats';
import { WEEKDAY_LABEL } from '../lib/golf';
import { entriesForSlot, readBlockPlan, slotForDate } from '../lib/program';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { BodyWeightChart } from '../components/LazyCharts';
import { ThemeToggleButton } from '../components/ThemePicker';
import { Ring } from '../components/Ring';

/**
 * Weekly targets for a realistic two-session week (spec §1): ~6 exercises a
 * session at 3 sets. Editable targets are a Settings concern for a later
 * phase; hard-coding them now keeps Phase 1 honest about what it computes.
 */
const WEEKLY_TARGET = { sets: 36, exercises: 12, muscles: 10 };

/** Height of the ring row, and the diameter of the emphasised centre ring. */
const RING_ROW = 112;

export function DashboardScreen({
  exercises,
  onOpenSession,
  onStartDay,
  onOpenSettings,
}: {
  exercises: Exercise[];
  onOpenSession: (sessionId: string) => void;
  onStartDay: (slot?: DaySlot) => void;
  onOpenSettings: () => void;
}) {
  /*
   * The whole block's week, not just today. Answering only "what is today"
   * hid the other days entirely on a rest day, which reads as though the
   * program has one session in it.
   */
  const program = useLiveQuery(async () => {
    const plan = await readBlockPlan();
    if (!plan) return undefined;

    const date = todayIso();
    const from = weekStart(date);
    const sessions = await db.session
      .where('date')
      .between(from, shiftIso(from, 7), true, false)
      .toArray();
    const loggedSlots = new Set(sessions.map((session) => session.daySlot));

    const days = [...new Set(plan.entries.map((entry) => entry.daySlot))]
      .map((slot) => ({
        slot,
        weekday: plan.schedule[slot],
        entries: entriesForSlot(plan.entries, slot),
        doneThisWeek: loggedSlots.has(slot),
      }))
      // Scheduled days in weekday order; anything unscheduled trails behind.
      .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || a.slot.localeCompare(b.slot));

    return {
      days,
      todaySlot: slotForDate(plan.schedule, date),
      scheduled: Object.keys(plan.schedule).length > 0,
    };
  }, []);

  const week = useLiveQuery(async () => {
    const from = weekStart(todayIso());
    const sessions = await db.session.where('date').aboveOrEqual(from).toArray();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLog.toArray()).filter((l) => ids.has(l.sessionId));
    const byId = new Map(exercises.map((e) => [e.id, e]));

    const exerciseIds = new Set(logs.map((l) => l.exerciseId));
    const muscles = new Set<string>();
    for (const id of exerciseIds) {
      const exercise = byId.get(id);
      // Primary muscles only here. Weighted primary/secondary volume is the
      // Phase 4 job; this ring just answers "did I touch it this week".
      for (const m of exercise?.primaryMuscles ?? []) muscles.add(m);
    }

    return {
      from,
      sessionCount: sessions.length,
      setCount: logs.length,
      exerciseCount: exerciseIds.size,
      muscleCount: muscles.size,
      volumeKg: logs.reduce((sum, l) => sum + (l.effectiveKg ?? 0) * l.reps, 0),
    };
  }, [exercises]);

  const bodyWeight = useLiveQuery(
    () => db.sharedBodyWeight.orderBy('date').toArray(),
    [],
    undefined,
  );

  const recent = useLiveQuery(
    () => db.session.orderBy('date').reverse().limit(4).toArray(),
    [],
    undefined,
  );

  const points: DatedPoint[] = (bodyWeight ?? []).map((row) => ({
    date: row.date,
    value: row.kg,
  }));
  /* useLiveQuery hands back the previous result while a new one is in flight,
     so read the shape through locals rather than assuming every field landed. */
  const programDays = program?.days ?? [];

  const latest = points.at(-1);
  const average = rollingAverage(points, 7);
  const trend = linearTrend(points);

  return (
    <Screen
      title="Dashboard"
      trailing={
        <span className="flex gap-2">
        <ThemeToggleButton />
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="mb-1 flex size-9 items-center justify-center rounded-full bg-surface-2"
        >
          <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
            <path
              d="M4 7h10m4 0h2M4 12h4m4 0h8M4 17h12m4 0h0M16 7a2 2 0 1 0 0 0M10 12a2 2 0 1 0 0 0M18 17a2 2 0 1 0 0 0"
              stroke="var(--color-text-dim)"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
        </span>
      }
    >
      {programDays.length > 0 && (
        <Card
          title={program?.todaySlot ? `Today · day ${program.todaySlot}` : 'This week'}
          className="mb-3"
        >
          {programDays.map((day, i) => {
            const isToday = day.slot === program?.todaySlot;
            const names = day.entries
              .map((entry) => exercises.find((e) => e.id === entry.exerciseId)?.name)
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={day.slot} className={i > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-baseline gap-2">
                    <span className="card-title">Day {day.slot}</span>
                    <Label className={isToday ? 'text-text!' : ''}>
                      {isToday ? 'today' : day.weekday ? WEEKDAY_LABEL[day.weekday] : 'unscheduled'}
                      {day.doneThisWeek ? ' · done' : ''}
                    </Label>
                  </span>
                  <button
                    type="button"
                    onClick={() => onStartDay(day.slot)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
                      isToday ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                    }`}
                  >
                    Start
                  </button>
                </div>
                <p className="mt-1 text-[12px] leading-snug font-medium text-text-dim">
                  {names || '---'}
                </p>
              </div>
            );
          })}

          {!program?.scheduled && (
            <p className="mt-3 text-[12px] font-medium text-text-dim">
              No weekdays assigned yet — generate the week on Program to place these around your
              rounds.
            </p>
          )}
        </Card>
      )}

      <Card title="This week">
        {/* Sets in the middle and larger: it is the metric that drives the
            week, and the flanking two are context for it. */}
        <div className="mt-1 flex items-start">
          <Ring
            value={week?.muscleCount ?? 0}
            target={WEEKLY_TARGET.muscles}
            label="Muscles"
            color="var(--color-muscle)"
            slotHeight={RING_ROW}
          />
          <Ring
            value={week?.setCount ?? 0}
            target={WEEKLY_TARGET.sets}
            label="Sets"
            color="var(--color-volume)"
            size={RING_ROW}
            slotHeight={RING_ROW}
            emphasis
          />
          <Ring
            value={week?.exerciseCount ?? 0}
            target={WEEKLY_TARGET.exercises}
            label="Exercises"
            color="var(--color-strength)"
            slotHeight={RING_ROW}
          />
        </div>
        <p className="mt-4 text-[12px] font-medium text-text-dim">
          {week && week.sessionCount > 0
            ? `${week.sessionCount} session${week.sessionCount === 1 ? '' : 's'} · ${kg(
                week.volumeKg,
              )} kg effective volume`
            : '--- sets this week'}
        </p>
      </Card>

      <Card title="Body weight" className="mt-3">
        {latest ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <span className="stat" style={{ color: 'var(--color-bodyweight)' }}>
                  {kg(latest.value)}
                </span>
                <span className="ml-1.5 text-sm font-medium text-text-dim">kg</span>
                <p className="label mt-1">{friendlyDate(latest.date)}</p>
              </div>
              <div className="text-right">
                <span className="stat-sm">
                  {points.length > 1 ? rate(trend.perWeek) : '--'}
                </span>
                <p className="label mt-1">
                  {points.length > 1
                    ? `kg/week over ${points.length} entries`
                    : 'no trend yet'}
                </p>
              </div>
            </div>
            {points.length > 1 && (
              <div className="mt-3">
                <BodyWeightChart points={points} average={average} trend={trend} />
                <p className="label mt-1">
                  daily · 7-day average · trend {trend.r2 > 0 ? `(r² ${trend.r2})` : ''}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <Empty>{EM_WEIGHT}</Empty>
            <p className="mt-1 text-[12px] font-medium text-text-dim">
              Import the nutrition backup in Settings to bring in the shared weigh-in history.
            </p>
          </>
        )}
      </Card>

      <Card title="Recent sessions" className="mt-3">
        {recent === undefined || recent.length === 0 ? (
          <Empty>--- sets</Empty>
        ) : (
          <div className="-mx-1">
            {recent.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left"
              >
                <span className="text-[15px] font-medium">{friendlyDate(session.date)}</span>
                <Label>
                  day {session.daySlot}
                  {session.durationMin ? ` · ${session.durationMin} min` : ''}
                </Label>
              </button>
            ))}
          </div>
        )}
      </Card>
    </Screen>
  );
}
