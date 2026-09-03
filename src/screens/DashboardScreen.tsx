import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, MuscleId } from '../db/types';
import {
  EM_WEIGHT,
  friendlyDate,
  fromIsoDate,
  kg,
  rate,
  shiftIso,
  todayIso,
  weekStart,
} from '../lib/format';
import { linearTrend, rollingAverage, type DatedPoint } from '../lib/stats';
import { WEEKDAY_LABEL } from '../lib/golf';
import { readWeekPlan } from '../lib/weekPlan';
import { WEEKLY_SET_TARGET, sessionMinutes } from '../lib/blockValidation';
import { readTimeFactor, realMinutes } from '../lib/timeModel';
import { readTraining } from '../db/settings';
import { setsPerMuscle } from '../lib/volume';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { BodyWeightChart } from '../components/LazyCharts';
import { ThemeToggleButton } from '../components/ThemePicker';
import { Ring } from '../components/Ring';
import { SyncWarning } from '../components/SyncWarning';
import { dayLabel, slotFallback } from '../lib/dayLabel';

/**
 * Fallbacks for a week with nothing planned in it: a realistic two-session
 * week (spec §1) at ~6 exercises a session.
 *
 * Only fallbacks. Both rings now take their denominator from the week that is
 * actually planned, because a constant is a number nobody chose: 12 exercises
 * was invented for Phase 1, and a real week of three sessions put 18 on the
 * board — a ring reading "18 of 12" is not measuring anything. The set target
 * is neither: it is the stepper in Settings.
 */
const WEEKLY_FALLBACK = { exercises: 12, muscles: 10 };

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
    /*
     * Bounded at both ends. `aboveOrEqual` counted anything dated after this
     * week too, and the date on a session is editable — so one session typed
     * with next month's date sat in "This week" until next month, against
     * targets that come from the week's own plan.
     */
    const to = shiftIso(from, 7);
    const sessions = await db.session.where('date').between(from, to, true, false).toArray();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLog.toArray()).filter((l) => ids.has(l.sessionId));
    const byId = new Map(exercises.map((e) => [e.id, e]));

    const exerciseIds = new Set(logs.map((l) => l.exerciseId));
    /*
     * Every muscle the week actually worked, primary or secondary, through the
     * app's own definition of volume — a set counts 1 for a muscle it trains
     * directly and 0.5 for one it trains indirectly, so anything above zero
     * got work. Counting primaries only reported 10 muscles for a week that
     * had touched 17, and read as a maxed-out ring because the invented target
     * was also 10.
     */
    const volume = setsPerMuscle(logs, byId);
    const muscles = (Object.keys(volume) as MuscleId[]).filter((id) => (volume[id] ?? 0) > 0);

    return {
      from,
      sessionCount: sessions.length,
      setCount: logs.length,
      exerciseCount: exerciseIds.size,
      muscleCount: muscles.length,
      volumeKg: logs.reduce((sum, l) => sum + (l.effectiveKg ?? 0) * l.reps, 0),
    };
  }, [exercises]);

  /*
   * How long each of this week's days should take on the clock. The estimate
   * has always existed; nothing showed it, so "have I got time for this" was
   * the one question the week could not answer. Scaled by what past sessions
   * really took.
   */
  const timeFactor = useLiveQuery(
    () => readTimeFactor(new Map(exercises.map((e) => [e.id, e]))),
    [exercises],
    undefined,
  );

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

  /*
   * What this week set out to do: the exercises it programmed, and the muscles
   * those exercises touch. Recomputed from the plan rather than stored, like
   * every other number in the app — and it moves when the week does, which a
   * constant never did.
   */
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  /*
   * Warm-up mobility is skipped, because `setsPerMuscle` skips it: a 90/90 hip
   * switch is not a set of training. Counting it here and not there made a
   * target the numerator could never reach — and the picker will happily add
   * one, so this is reachable by hand rather than theoretical.
   */
  const plannedExercises = new Set(
    programDays
      .flatMap((day) => day.entries.map((entry) => entry.exerciseId))
      .filter((id) => byId.get(id)?.isMobility === false),
  );
  const plannedMuscles = new Set<MuscleId>();
  for (const id of plannedExercises) {
    const exercise = byId.get(id);
    for (const muscle of exercise?.primaryMuscles ?? []) plannedMuscles.add(muscle);
    for (const muscle of exercise?.secondaryMuscles ?? []) plannedMuscles.add(muscle);
  }
  const exerciseTarget = plannedExercises.size || WEEKLY_FALLBACK.exercises;
  const muscleTarget = plannedMuscles.size || WEEKLY_FALLBACK.muscles;

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
                        {day.entries.length > 0
                          ? ` · ${realMinutes(
                              sessionMinutes(day.entries, byId),
                              timeFactor,
                            )} min`
                          : ''}
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
            target={muscleTarget}
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
            target={exerciseTarget}
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
