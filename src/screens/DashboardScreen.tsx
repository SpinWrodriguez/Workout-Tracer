import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise } from '../db/types';
import { EM_WEIGHT, friendlyDate, fromIsoDate, kg, rate, todayIso, weekStart } from '../lib/format';
import { linearTrend, rollingAverage, type DatedPoint } from '../lib/stats';
import { WEEKDAY_LABEL } from '../lib/golf';
import { readWeekPlan } from '../lib/weekPlan';
import { WEEKLY_SET_TARGET } from '../lib/blockValidation';
import { readTraining } from '../db/settings';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { BodyWeightChart } from '../components/LazyCharts';
import { ThemeToggleButton } from '../components/ThemePicker';
import { Ring } from '../components/Ring';
import { SyncWarning } from '../components/SyncWarning';
import { dayLabel, slotFallback } from '../lib/dayLabel';

/**
 * Exercise and muscle targets for a realistic two-session week (spec §1):
 * ~6 exercises a session at 3 sets. Neither is a setting, so both stay here.
 *
 * The set target is NOT here. It became a Settings control — the stepper the
 * generator builds weeks to and the validator enforces — and this ring went on
 * printing the constant, so moving the target to 39 left the dashboard saying
 * 33 and nothing in the app agreeing with anything else.
 */
const WEEKLY_TARGET = { exercises: 12, muscles: 10 };

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
   * The set target, live. Read through useLiveQuery rather than once on mount
   * so pressing Save training updates the ring behind it — the settings row is
   * the only thing between the two screens.
   */
  const training = useLiveQuery(() => readTraining(), [], undefined);
  const setTarget = training?.weeklySetTarget ?? WEEKLY_SET_TARGET;

  /*
   * The whole block's week, not just today. Answering only "what is today"
   * hid the other days entirely on a rest day, which reads as though the
   * program has one session in it.
   */
  /*
   * The whole block's week, not just today. Answering only "what is today"
   * hid the other days entirely on a rest day, which reads as though the
   * program has one session in it.
   */
  const program = useLiveQuery(() => readWeekPlan(), []);

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
      <SyncWarning onOpenSettings={onOpenSettings} />

      {programDays.length > 0 && (
        <Card title="Your week" className="mb-3">
          {programDays.map((day, i) => {
            const isToday = day.date !== undefined && day.date === program?.today;
            const isNext = day.slot === program?.next;
            const label = dayLabel({
              slot: day.slot,
              name: day.name,
              exercises: day.entries
                .map((entry) => exercises.find((e) => e.id === entry.exerciseId))
                .filter((exercise): exercise is Exercise => exercise !== undefined),
              intensity: day.intensity,
            });
            const names = day.entries
              .map((entry) => exercises.find((e) => e.id === entry.exerciseId)?.name)
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={day.slot} className={i > 0 ? 'mt-2.5 border-t border-border pt-2.5' : ''}>
                <div className="flex items-center gap-3">
                  {/* The calendar column: which day of the week this is. */}
                  <span
                    className={`flex size-11 shrink-0 flex-col items-center justify-center rounded-xl ${
                      isToday ? 'bg-cta text-bg' : 'bg-surface-2'
                    }`}
                  >
                    <span
                      className={`text-[9px] font-semibold tracking-wide uppercase ${
                        isToday ? 'text-bg/70' : 'text-text-dim'
                      }`}
                    >
                      {day.weekday ? WEEKDAY_LABEL[day.weekday] : '--'}
                    </span>
                    <span className="text-[15px] leading-none font-semibold tabular-nums">
                      {day.date ? fromIsoDate(day.date).getDate() : '·'}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="card-title truncate">{label}</span>
                      <Label>
                        {day.intensity === 'light' ? 'light' : 'heavy'}
                        {isToday ? ' · today' : ''}
                      </Label>
                    </span>
                    <p className="mt-0.5 truncate text-[12px] font-medium text-text-dim">
                      {names || '---'}
                    </p>
                  </span>

                  {/* A finished session is not something to start again. The
                      button says so rather than going quietly missing, so the
                      row still reads as a week you can see the shape of. */}
                  {day.done ? (
                    <span
                      className="shrink-0 rounded-full bg-surface-2 px-4 py-1.5 text-[13px] font-semibold text-text-faint"
                      aria-label={`${label} is done`}
                    >
                      Done
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartDay(day.slot)}
                      disabled={day.entries.length === 0}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold disabled:text-text-faint ${
                        isNext ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                      }`}
                    >
                      Start
                    </button>
                  )}
                </div>
              </div>
            );
          })}


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
            target={setTarget}
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
                  {session.daySlotName ?? slotFallback(session.daySlot)}
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
