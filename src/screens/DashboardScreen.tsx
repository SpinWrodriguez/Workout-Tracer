import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise } from '../db/types';
import { EM_WEIGHT, friendlyDate, kg, rate, todayIso, weekStart } from '../lib/format';
import { linearTrend, rollingAverage, type DatedPoint } from '../lib/stats';
import { WEEKDAY_LABEL } from '../lib/golf';
import { entriesForSlot, nextSlot, readBlockPlan, slotForDate } from '../lib/program';
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
  /* What the block says to do today, and whether it is already done. */
  const today = useLiveQuery(async () => {
    const plan = await readBlockPlan();
    if (!plan) return undefined;
    const date = todayIso();
    const slot = slotForDate(plan.schedule, date);
    const entries = slot ? entriesForSlot(plan.entries, slot) : [];
    const logged = await db.session.where('date').equals(date).toArray();
    // Blocks generated before the schedule was stored have day slots but no
    // weekdays. Offer those days directly rather than showing nothing.
    const unscheduled = [...new Set(plan.entries.map((entry) => entry.daySlot))].sort();
    return {
      slot,
      entries,
      upcoming: nextSlot(plan.schedule, date),
      done: logged.length > 0,
      unscheduled: Object.keys(plan.schedule).length === 0 ? unscheduled : [],
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
  const unscheduledDays = today?.unscheduled ?? [];
  const todaysEntries = today?.entries ?? [];

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
      {today && (todaysEntries.length > 0 || today.upcoming || unscheduledDays.length > 0) && (
        <Card
          title={
            todaysEntries.length > 0
              ? `Today · day ${today.slot}`
              : unscheduledDays.length > 0
                ? 'Ready to train'
                : 'Nothing programmed today'
          }
          className="mb-3"
        >
          {unscheduledDays.length > 0 ? (
            <>
              <p className="text-[13px] font-medium text-text-dim">
                This block has no weekdays assigned yet — generate the week on Program to schedule
                it around your rounds, or just start a day now.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {unscheduledDays.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => onStartDay(slot as DaySlot)}
                    className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium"
                  >
                    Start day {slot}
                  </button>
                ))}
              </div>
            </>
          ) : todaysEntries.length > 0 ? (
            <>
              <p className="text-[13px] font-medium text-text-dim">
                {todaysEntries
                  .map((entry) => exercises.find((e) => e.id === entry.exerciseId)?.name)
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <button
                type="button"
                onClick={() => onStartDay(today.slot)}
                className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
              >
                {today.done ? 'Start another session' : `Start day ${today.slot}`}
              </button>
            </>
          ) : (
            <>
              <Empty>--- sets</Empty>
              {today.upcoming && (
                <p className="mt-1 text-[13px] font-medium text-text-dim">
                  Next up is day {today.upcoming.slot} on {WEEKDAY_LABEL[today.upcoming.weekday]}
                  {today.upcoming.inDays === 0
                    ? ''
                    : `, in ${today.upcoming.inDays} day${today.upcoming.inDays === 1 ? '' : 's'}`}
                  .
                </p>
              )}
              <button
                type="button"
                onClick={() => onStartDay(today.upcoming?.slot)}
                className="mt-3 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium"
              >
                {today.upcoming ? `Do day ${today.upcoming.slot} anyway` : 'Log something anyway'}
              </button>
            </>
          )}
        </Card>
      )}

      <Card title="This week">
        <div className="mt-1 flex justify-around">
          <Ring
            value={week?.setCount ?? 0}
            target={WEEKLY_TARGET.sets}
            label="sets"
            color="var(--color-volume)"
          />
          <Ring
            value={week?.exerciseCount ?? 0}
            target={WEEKLY_TARGET.exercises}
            label="exercises"
            color="var(--color-strength)"
          />
          <Ring
            value={week?.muscleCount ?? 0}
            target={WEEKLY_TARGET.muscles}
            label="muscles"
            color="var(--color-muscle)"
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
