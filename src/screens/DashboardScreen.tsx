import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import { HapticTick } from '../components/HapticTick';
import { tap } from '../lib/haptics';
import type { DaySlot, Exercise, MuscleId } from '../db/types';
import {
  EM_WEIGHT,
  friendlyDate,
  kg,
  rate,
  shiftIso,
  todayIso,
  weekStart,
} from '../lib/format';
import { linearTrend, rollingAverage, type DatedPoint } from '../lib/stats';
import { WEEKDAY_LABEL, buildWeek, weekdayOf } from '../lib/golf';
import { readWeekPlan, type PlannedDay } from '../lib/weekPlan';
import { WEEKLY_SET_TARGET, sessionMinutes } from '../lib/blockValidation';
import { readTimeFactor, realMinutes } from '../lib/timeModel';
import { readTraining } from '../db/settings';
import { setsPerMuscle } from '../lib/volume';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { BodyWeightChart } from '../components/LazyCharts';
import { ThemeToggleButton } from '../components/ThemePicker';
import { Ring } from '../components/Ring';
import { SyncWarning } from '../components/SyncWarning';
import { dayLabel, shortDayLabels, slotFallback } from '../lib/dayLabel';
import { WeekStrip, type WeekStripDay } from '../components/WeekStrip';
import { MiniMap } from '../components/PlanLevels';
import { EFFORT_WORD } from '../lib/effort';
import { caddieLine } from '../lib/caddie';
import { describePr, prEvents, type PrEvent } from '../lib/prs';

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

/**
 * The one day the strip has picked, with the body map beside it. It used to
 * be a list of every day, each with its own Start button, above a second card
 * that said the next one again: a whole screen to answer what one row can.
 */
function DayPanel({
  day,
  date,
  today,
  golf,
  isNext,
  label,
  names,
  minutes,
  exercisesById,
  onStart,
  onFreestyle,
}: {
  day?: PlannedDay;
  date: string;
  today: string;
  golf: boolean;
  isNext: boolean;
  label: string;
  names: string;
  minutes?: number;
  exercisesById: Map<string, Exercise>;
  onStart: () => void;
  onFreestyle?: () => void;
}) {
  const weekday = WEEKDAY_LABEL[weekdayOf(date)];
  const when = date === today ? 'today' : weekday;
  if (!day) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3" data-testid="day-panel">
        <p className="text-[13px] font-medium text-text-dim">
          {golf ? `Golf ${when}, nothing planned around it.` : `Nothing planned ${when}.`}
        </p>
        {onFreestyle && (
          <button
            type="button"
            onClick={() => {
              tap();
              onFreestyle();
            }}
            className="relative shrink-0 rounded-full bg-surface-2 px-4 py-1.5 text-[13px] font-semibold text-text-dim"
          >
            Freestyle
            <HapticTick />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-3" data-testid="day-panel">
      <MiniMap entries={day.entries} exercisesById={exercisesById} />
      <span className="min-w-0 flex-1">
        <span className="card-title block truncate">{label}</span>
        <Label>
          {EFFORT_WORD[day.intensity]} · {when}
          {minutes !== undefined ? ` · ${minutes} min` : ''}
          {golf ? ' · golf' : ''}
        </Label>
        <p className="mt-0.5 truncate text-[12px] font-medium text-text-dim">{names || '---'}</p>
      </span>
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
          onClick={() => {
            tap();
            onStart();
          }}
          disabled={day.entries.length === 0}
          className={`relative shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold disabled:text-text-faint ${
            isNext ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
          }`}
        >
          Start
          <HapticTick />
        </button>
      )}
    </div>
  );
}

export function DashboardScreen({
  exercises,
  onStartDay,
  onFreestyle,
  onOpenSettings,
}: {
  exercises: Exercise[];
  onStartDay: (slot?: DaySlot) => void;
  /** A session with no workout behind it: the rare case, so a line, not a button. */
  onFreestyle?: () => void;
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
      /* The sessions themselves, for the strip: which days were trained and
         what each was called. */
      sessions: sessions.map((session) => ({
        id: session.id,
        date: session.date,
        name: session.daySlotName,
        exerciseIds: [...new Set(logs.filter((l) => l.sessionId === session.id).map((l) => l.exerciseId))],
      })),
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

  const golfDays = useLiveQuery(() => db.golfDay.toArray(), [], undefined);

  const bodyWeight = useLiveQuery(
    () => db.sharedBodyWeight.orderBy('date').toArray(),
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

  /*
   * The strip: the calendar week with this week's workouts on it, built the
   * way Program builds it so the two read as one calendar. The dates come
   * from the plan, which has already resolved the rotation's forecast.
   */
  const strip: WeekStripDay[] = (() => {
    const today = program?.today ?? todayIso();
    const base = buildWeek({
      anchorDate: today,
      golfDays: golfDays ?? [],
      sessions: week?.sessions ?? [],
      exercisesById: byId,
    });
    const kinds = program?.rotation?.kinds ?? {};
    return base.map((day) => {
      const planned = programDays.find((d) => d.date === day.date);
      const kind = kinds[day.date];
      return {
        ...day,
        plannedSlot: planned?.slot,
        intensity: planned?.intensity,
        forecast: kind === 'forecast' || kind === 'next',
      };
    });
  })();

  const labelFor = (slot: DaySlot): string => {
    const day = program?.all.find((d) => d.slot === slot);
    return dayLabel({
      slot,
      name: day?.name,
      exercises: (day?.entries ?? [])
        .map((entry) => byId.get(entry.exerciseId))
        .filter((exercise): exercise is Exercise => exercise !== undefined),
      intensity: day?.intensity,
    });
  };
  const shortLabelFor = (() => {
    const inWeek = strip
      .map((day) => day.plannedSlot)
      .filter((slot): slot is DaySlot => slot !== undefined);
    const shorts = shortDayLabels(inWeek.map((slot) => labelFor(slot)));
    const map = new Map(inWeek.map((slot, i) => [slot, shorts[i] as string]));
    return (slot: DaySlot) => map.get(slot) ?? labelFor(slot);
  })();

  /*
   * Which day the panel shows. Today, unless today has nothing on it and a
   * later day does: then the next workout, which is what you came to see.
   * A tap on the strip overrides either for as long as the screen is open.
   */
  const [tapped, setPicked] = useState<string | undefined>(undefined);
  const picked = (() => {
    if (tapped) return tapped;
    const today = program?.today ?? todayIso();
    const onToday = programDays.find((d) => d.date === today);
    if (onToday && !onToday.done) return today;
    const upcoming = programDays.find((d) => d.date !== undefined && d.date > today && !d.done);
    if (upcoming?.date) return upcoming.date;
    /* Nothing ahead this week: the last day that had something, so the
       week still has a face on a Sunday or a rest day at its end. */
    const latest = [...programDays].reverse().find((d) => d.date !== undefined);
    return latest?.date ?? today;
  })();
  const pickedDay = programDays.find((d) => d.date === picked);

  /* The caddie line: one deterministic sentence about today, assembled from
     the plan, the log and the golf calendar. Never a model, never more than a
     sentence — see lib/caddie.ts. */
  const caddie = useLiveQuery(async () => {
    const today = todayIso();
    const tomorrow = shiftIso(today, 1);
    const golf = await db.golfDay.where('date').anyOf([today, tomorrow]).toArray();

    const todaySessions = await db.session.where('date').equals(today).toArray();
    const trainedSession = todaySessions.at(-1);
    const trainedToday = trainedSession
      ? (trainedSession.daySlotName ?? slotFallback(trainedSession.daySlot))
      : undefined;

    /* A PR only matters on the line the day it happened. Replaying the whole
       log is cheap at this size and keeps the record a fact, not a cache. */
    let pr: string | undefined;
    if (trainedSession) {
      const logs = await db.setLog.toArray();
      const sessions = await db.session.toArray();
      const dateBySession = new Map(sessions.map((session) => [session.id, session.date]));
      const events = prEvents(logs, dateBySession, byId).get(today);
      if (events && events.length > 0) {
        const biggest = events[events.length - 1] as PrEvent;
        pr = describePr(biggest, byId);
      }
    }

    return { golfToday: golf.some((d) => d.date === today), golfTomorrow: golf.some((d) => d.date === tomorrow), trainedToday, pr };
    /* Keyed on the exercises array, not the byId map: the map is rebuilt every
       render and identity-keyed deps would re-run the query per render. */
  }, [exercises]);

  const caddieText = (() => {
    if (!caddie || program === undefined) return undefined;
    const today = program?.today ?? todayIso();
    const nameOf = (day: (typeof programDays)[number]) =>
      dayLabel({
        slot: day.slot,
        name: day.name,
        exercises: day.entries
          .map((entry) => byId.get(entry.exerciseId))
          .filter((exercise): exercise is Exercise => exercise !== undefined),
        intensity: day.intensity,
      });
    const todayPlan = programDays.find((day) => day.date === today && !day.done);
    const upcoming = programDays
      .filter((day) => day.date !== undefined && day.date > today && !day.done)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string))[0];
    return caddieLine({
      golfToday: caddie.golfToday,
      golfTomorrow: caddie.golfTomorrow,
      trainedToday: caddie.trainedToday,
      pr: caddie.pr,
      plannedToday: todayPlan
        ? { name: nameOf(todayPlan), light: todayPlan.intensity === 'light' }
        : undefined,
      next: upcoming
        ? { name: nameOf(upcoming), weekday: WEEKDAY_LABEL[weekdayOf(upcoming.date as string)] }
        : undefined,
      weekEmpty: programDays.every((day) => day.date === undefined),
    });
  })();

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

      {/* One sentence, then the data. It reads like a caddie, not a report. */}
      {caddieText && (
        <p className="mb-3 text-[14px] leading-snug font-medium">{caddieText}</p>
      )}

      {programDays.length > 0 && (
        <Card
          title="Your week"
          className="mb-3"
          trailing={
            program?.rotation ? (
              <Label>
                {program.rotation.week < 1
                  ? `starts ${WEEKDAY_LABEL[weekdayOf(program.rotation.plan.start)]}`
                  : program.rotation.week > program.rotation.plan.weeks
                    ? 'plan finished'
                    : `week ${program.rotation.week} of ${program.rotation.plan.weeks}`}
              </Label>
            ) : undefined
          }
        >
          {/* The same strip as Program: the week in one row, a tap picks a
              day, and the one day picked is the only one that takes up room. */}
          <WeekStrip
            week={strip}
            labelFor={labelFor}
            shortLabelFor={shortLabelFor}
            selected={picked}
            onPickDay={(date) => {
              tap();
              setPicked(date);
            }}
          />
          <DayPanel
            day={pickedDay}
            date={picked}
            today={program?.today ?? todayIso()}
            golf={strip.find((d) => d.date === picked)?.golf !== undefined}
            isNext={pickedDay !== undefined && pickedDay.slot === program?.next}
            label={pickedDay ? labelFor(pickedDay.slot) : ''}
            names={(pickedDay?.entries ?? [])
              .map((entry) => byId.get(entry.exerciseId)?.name)
              .filter(Boolean)
              .join(' · ')}
            minutes={
              pickedDay && pickedDay.entries.length > 0
                ? realMinutes(sessionMinutes(pickedDay.entries, byId), timeFactor)
                : undefined
            }
            exercisesById={byId}
            onStart={() => onStartDay(pickedDay?.slot)}
            onFreestyle={onFreestyle}
          />
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
    </Screen>
  );
}
