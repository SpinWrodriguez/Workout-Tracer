import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, Muscle, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { friendlyDate, longDate, todayIso } from '../lib/format';
import { WEEKDAY_LABEL, buildWeek, gripSafeWeekdays, weekdayOf, type Weekday } from '../lib/golf';
import { readInventory } from '../db/settings';
import { DEFAULT_INVENTORY, ladderFor, type Inventory } from '../lib/loadable';
import { balanceSets, generateDay, type DayPlan } from '../lib/blockBuilder';
import { severityOf, validateBlock, type ValidationContext } from '../lib/blockValidation';
import { dayLabel, describeDay } from '../lib/dayLabel';
import {
  DEFAULT_THIRD_DAY,
  MAX_SESSIONS,
  maxSessionsFor,
  templateDayFor,
  templateWeek,
  templateWeekdays,
  workoutTemplate,
  type WorkoutFocus,
  SESSION_SHAPES,
  SESSION_SHAPE_HINT,
  SESSION_SHAPE_LABEL,
  type SessionShape,
  type TemplateDay,
} from '../lib/weekTemplate';
import { readTraining, writeTraining, DEFAULT_TRAINING, type TrainingPrefs } from '../db/settings';
import {
  addBlockExercise,
  clearDaySlot,
  configFromSchedule,
  entriesForSlot,
  moveBlockExercise,
  orderedSlots,
  planDate,
  readPlans,
  readSchedules,
  removeBlockExercise,
  SLOTS,
  slotForDate,
  setUsualWeekday,
  updateBlockExercise,
  writePlan,
  writeSchedule,
  type BlockSchedule,
} from '../lib/program';
import { DayEditor } from '../components/DayEditor';
import { NewWorkoutSheet } from '../components/NewWorkoutSheet';
import { DaySlotCard } from '../components/DaySlotCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { Card, Chip, Empty, Label, Screen, SegmentedToggle } from '../components/Layout';
import { WeekStrip, type WeekStripDay } from '../components/WeekStrip';
import { shiftIso, weekStart } from '../lib/format';

const DAY_SLOTS = SLOTS;
const SESSION_COUNTS = ['2', '3', '4', '5'] as const;
const SESSION_LENGTHS = ['30', '40', '60'] as const;
type SessionLength = (typeof SESSION_LENGTHS)[number];

const REGION_LABEL: Record<Muscle['region'], string> = {
  upper: 'Upper',
  lower: 'Lower',
  core: 'Core',
};

export function ProgramScreen({
  exercises,
  onStartDay,
}: {
  exercises: Exercise[];
  onStartDay: (slot: DaySlot) => void;
}) {
  const [anchor, setAnchor] = useState(() => todayIso());
  const [sessionsPerWeek, setSessionsPerWeek] = useState<(typeof SESSION_COUNTS)[number]>('2');
  const [sessionMinutes, setSessionMinutes] = useState<SessionLength>('40');
  const [focus, setFocus] = useState<MuscleId[]>([]);
  /* Which draw each day is showing. Its presence is also what says "this day
     came from the generator", which is what earns it a Shuffle button. */
  const [variantBySlot, setVariantBySlot] = useState<Partial<Record<DaySlot, number>>>({});
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [thirdDay] = useState<number>(DEFAULT_THIRD_DAY);
  /* null means the app balances it; an empty array means every session light. */
  const [heavyWeekdays, setHeavyWeekdays] = useState<Weekday[] | null>(null);
  const [shape, setShape] = useState<SessionShape>('mixed');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [training, setTraining] = useState<TrainingPrefs>(DEFAULT_TRAINING);
  /* What the schedule looked like when the controls last synced to it, so a
     choice being made right now is not stamped on mid-edit. */
  const [seenSchedule, setSeenSchedule] = useState<string | undefined>(undefined);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);
  const [addingTo, setAddingTo] = useState<DaySlot | null>(null);
  const [creating, setCreating] = useState(false);
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);

  useEffect(() => {
    let cancelled = false;
    void readInventory().then((next) => {
      if (!cancelled) setInventory(next);
    });
    void readTraining().then((next) => {
      if (!cancelled) {
        setTraining(next);
        setSessionMinutes(String(next.sessionMinutes) as SessionLength);
        setShape(next.shape);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* A first block has no history, which is what bars advanced movements. */
  const hasHistory = useLiveQuery(async () => (await db.setLog.count()) > 0, [], false);

  const block = useLiveQuery(() => db.block.orderBy('startDate').reverse().first(), [], undefined);
  const golfDays = useLiveQuery(() => db.golfDay.toArray(), [], undefined);
  const slots = useLiveQuery(
    async () => (block ? db.blockExercise.where('blockId').equals(block.id).toArray() : []),
    [block?.id],
    undefined,
  );
  const schedule = useLiveQuery(
    async () => (block ? ((await readSchedules())[block.id] ?? {}) : {}),
    [block?.id],
    undefined,
  );
  const datePlan = useLiveQuery(
    async () => (block ? ((await readPlans())[block.id] ?? {}) : {}),
    [block?.id],
    undefined,
  );

  const sessionRows = useLiveQuery(async () => {
    const start = weekStart(anchor);
    const rows = await db.session
      .where('date')
      .between(start, shiftIso(start, 7), true, false)
      .toArray();
    const logs = await db.setLog.toArray();
    return rows.map((s) => ({
      id: s.id,
      date: s.date,
      exerciseIds: [...new Set(logs.filter((l) => l.sessionId === s.id).map((l) => l.exerciseId))],
    }));
  }, [anchor]);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /* The days this many sessions lands on, so the heavy picker can list them. */
  const sessionWeekdays = useMemo(
    () =>
      templateWeekdays(
        Number(sessionsPerWeek),
        training.golfWeekdays as never,
        thirdDay as never,
      ),
    [sessionsPerWeek, training.golfWeekdays, thirdDay],
  );

  /*
   * The controls are a view of the program, not a fresh form. Opening Program
   * with three days scheduled and being told "2 sessions, Mon and Tue heavy"
   * describes somebody else's week — and generating from it would quietly
   * rebuild yours to match.
   *
   * Re-synced only when the stored schedule actually changes, so a selection
   * being made right now survives until it is applied or abandoned.
   */
  const fromSchedule = configFromSchedule(schedule ?? {});
  const scheduleKey = JSON.stringify(fromSchedule);
  if (fromSchedule && scheduleKey !== seenSchedule) {
    setSeenSchedule(scheduleKey);
    setSessionsPerWeek(
      String(
        Math.max(2, Math.min(fromSchedule.sessionsPerWeek, MAX_SESSIONS)),
      ) as (typeof SESSION_COUNTS)[number],
    );
    setHeavyWeekdays(fromSchedule.heavyWeekdays);
  }

  const effectiveHeavy = heavyWeekdays ?? sessionWeekdays.slice(0, 2);
  const heavyCount = effectiveHeavy.length;
  const heavyLabel = effectiveHeavy.map((day) => WEEKDAY_LABEL[day]).join(' and ');

  /* Which of those days can actually carry grip work — computed, not claimed.
     A heavy Thursday two days out from a round still loses it. */
  const gripDays = effectiveHeavy.filter((day) =>
    gripSafeWeekdays(training.golfWeekdays as never).includes(day),
  );
  const gripLabel = gripDays.map((day) => WEEKDAY_LABEL[day]).join(' and ');

  const week: WeekStripDay[] = useMemo(() => {
    return buildWeek({
      anchorDate: anchor,
      golfDays: golfDays ?? [],
      sessions: sessionRows ?? [],
      exercisesById: byId,
    }).map((day) => ({
      ...day,
      // Resolved per date, so a session moved in one week shows as moved in
      // that week and nowhere else.
      plannedSlot: slotForDate(schedule ?? {}, day.date, datePlan ?? {}),
    }));
  }, [anchor, golfDays, sessionRows, byId, schedule, datePlan]);

  /** Slots the block actually defines, for the day editor's gym options. */
  const definedSlots = useMemo(
    () => [...new Set((slots ?? []).map((entry) => entry.daySlot))].sort(),
    [slots],
  );

  /**
   * What a day is called. A name the user typed wins; otherwise the day is
   * named after what is actually in it, which means a regenerated day renames
   * itself instead of keeping a caption for a workout it no longer holds.
   */
  const labelFor = (slot: DaySlot): string =>
    dayLabel({
      slot,
      name: schedule?.[slot]?.name,
      exercises: entriesForSlot(slots ?? [], slot)
        .map((entry) => byId.get(entry.exerciseId))
        .filter((exercise): exercise is Exercise => exercise !== undefined),
      intensity: schedule?.[slot]?.intensity,
    });

  const renameSlot = async (slot: DaySlot, name: string | undefined) => {
    if (!block) return;
    const stored = (await readSchedules())[block.id] ?? {};
    const day = stored[slot];
    if (!day) return;
    const next = { ...day };
    if (name?.trim()) next.name = name.trim();
    else delete next.name;
    await writeSchedule(block.id, { ...stored, [slot]: next });
  };

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftIso(weekStart(anchor), i)),
    [anchor],
  );

  /** Moves a workout to one date. The recurring pattern is left alone. */
  const movePlanned = async (slot: DaySlot | undefined, date: string) => {
    if (!block) return;
    const current = (await readPlans())[block.id] ?? {};
    await writePlan(block.id, planDate(current, schedule ?? {}, weekDates, slot, date));
  };

  /** Promotes where a workout sits this week into where it always sits. */
  const makeUsual = async (slot: DaySlot, date: string) => {
    if (!block) return;
    await writeSchedule(block.id, setUsualWeekday(schedule ?? {}, slot, weekdayOf(date)));
    // The date entry has done its job; leaving it would pin this one week
    // against a pattern that now agrees with it anyway.
    const current = (await readPlans())[block.id] ?? {};
    const cleaned = { ...current };
    delete cleaned[date];
    await writePlan(block.id, cleaned);
  };

  const violations = week.filter((day) => day.violation);

  const focusOrDefault = focus.length > 0 ? focus : (block?.focusMuscles ?? []);

  const setGolf = async (date: string, status: GolfDay['status'] | undefined) => {
    if (status === undefined) await db.golfDay.delete(date);
    else {
      const existing = await db.golfDay.get(date);
      await db.golfDay.put({ date, status, holes: existing?.holes ?? 18 });
    }
  };

  /* The week the settings above describe: which slots exist, on which day, at
     what effort. Exercises are nobody's business here. */
  const templateDays = useMemo(
    () =>
      templateWeek({
        sessionsPerWeek: Number(sessionsPerWeek),
        shape,
        thirdDay: thirdDay as never,
        heavyWeekdays: heavyWeekdays ?? undefined,
        golfWeekdays: training.golfWeekdays as never,
        minutesPerSession: Number(sessionMinutes),
      }),
    [sessionsPerWeek, shape, thirdDay, heavyWeekdays, training.golfWeekdays, sessionMinutes],
  );

  /**
   * The constraints one slot should be generated under. The schedule wins over
   * the template wherever they disagree, because a day dragged to Thursday has
   * Thursday's grip clearance whatever the template originally intended.
   */
  const templateFor = (slot: DaySlot): TemplateDay | undefined => {
    const fromWeek = templateDays.find((day) => day.slot === slot);
    const scheduled = schedule?.[slot];
    const weekday = scheduled?.weekday ?? fromWeek?.weekday;
    if (weekday === undefined) return undefined;
    const intensity = scheduled?.intensity ?? fromWeek?.intensity ?? 'heavy';

    // Position among the days of the same effort picks the pattern set, so a
    // second heavy day complements the first rather than repeating it.
    const peers = orderedSlots(schedule ?? {}).filter(
      (entry) => (schedule?.[entry.slot]?.intensity ?? 'heavy') === intensity,
    );
    const fromSchedule = peers.findIndex((entry) => entry.slot === slot);
    const index =
      fromSchedule >= 0
        ? fromSchedule
        : templateDays.filter((day) => day.intensity === intensity).findIndex((day) => day.slot === slot);

    return templateDayFor({
      slot,
      weekday,
      intensity,
      index: Math.max(0, index),
      shape,
      minutesPerSession: Number(sessionMinutes),
      golfWeekdays: training.golfWeekdays as never,
    });
  };

  /** Lays out the week without filling anything in: slots, days, effort. */
  const setUpWeek = async () => {
    if (!block) return;
    const next: BlockSchedule = { ...(schedule ?? {}) };
    for (const day of templateDays) {
      next[day.slot] = {
        // Spread first: laying the week out again must not forget that a day
        // was generated, or its Shuffle button vanishes.
        ...(next[day.slot] ?? {}),
        weekday: day.weekday,
        intensity: day.intensity,
        effortCue: day.effortCue,
      };
    }
    await writeSchedule(block.id, next);
    await db.block.put({ ...block, focusMuscles: focusOrDefault });
  };

  /** Builds one day in memory. Writes nothing — see writeDay. */
  const buildSlot = (slot: DaySlot, variant: number, exclude: string[]) => {
    if (!block) return undefined;
    const template = templateFor(slot);
    if (!template) return undefined;
    return generateDay({
      blockId: block.id,
      exercises,
      focusMuscles: focusOrDefault,
      template,
      exclude,
      variant,
      hasHistory: hasHistory ?? false,
    });
  };

  /** Replaces one slot's exercises and its place in the week. Nothing else. */
  const writeDay = async (day: DayPlan) => {
    if (!block) return;
    await db.transaction('rw', [db.block, db.blockExercise], async () => {
      const stale = (await db.blockExercise.where('blockId').equals(block.id).toArray()).filter(
        (entry) => entry.daySlot === day.slot,
      );
      await db.blockExercise.bulkDelete(
        stale.map(
          (entry) => [entry.blockId, entry.exerciseId, entry.daySlot] as [string, string, string],
        ),
      );
      await db.blockExercise.bulkPut(day.exercises);
      await db.block.put({ ...block, focusMuscles: focusOrDefault });
    });
    // Read fresh: this runs in a loop, and the live query lags behind it.
    const stored = (await readSchedules())[block.id] ?? {};
    await writeSchedule(block.id, {
      ...stored,
      [day.slot]: {
        weekday: day.weekday,
        intensity: day.intensity,
        effortCue: day.effortCue,
        generated: true,
        // Named from what was just built. A name the user typed is left alone:
        // renaming a day should survive re-rolling it.
        name:
          stored[day.slot]?.name ??
          describeDay(
            day.exercises
              .map((entry) => byId.get(entry.exerciseId))
              .filter((exercise): exercise is Exercise => exercise !== undefined),
            day.intensity,
          ),
      },
    });
  };

  /**
   * Generates ONE day. It replaces that slot and nothing else — the days you
   * built by hand are not inputs to this, they are constraints on it.
   */
  const generateSlot = async (slot: DaySlot, variant: number) => {
    if (!block) return;
    /*
     * What every other day already holds, read fresh rather than taken from the
     * live query. Scoped to what is IN the block, never to what an earlier
     * discarded proposal suggested — that is what stops repeated presses
     * walking downhill.
     */
    const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
    const exclude = current
      .filter((entry) => entry.daySlot !== slot)
      .map((entry) => entry.exerciseId);

    const day = buildSlot(slot, variant, exclude);
    if (!day) return;

    /*
     * Re-spend the week's set budget on this day alone. Without it, shuffling
     * a day that the weekly pass had topped up silently drops the week back
     * under target — the sets come back at the template default and nothing
     * puts them back.
     */
    const template = templateFor(slot);
    const fixedSets = current
      .filter((entry) => entry.daySlot !== slot)
      .reduce((n, entry) => n + entry.targetSets, 0);
    if (template) balanceSets([day], [template], byId, training.weeklySetTarget, fixedSets);

    await writeDay(day);
    setVariantBySlot((prev) => ({ ...prev, [slot]: variant }));
  };

  /** The next unused workout id, or nothing when the pool is full. */
  const freeSlot = (): DaySlot | undefined =>
    DAY_SLOTS.find(
      (slot) => entriesForSlot(slots ?? [], slot).length === 0 && schedule?.[slot] === undefined,
    );

  /**
   * Makes a workout and stops. It is not placed in the week, does not consume
   * a "session per week", and knows nothing about the calendar — which is the
   * whole point: building one and deciding when to do it are separate acts.
   */
  const createWorkout = async (focus: WorkoutFocus, intensity: 'heavy' | 'light') => {
    if (!block) return;
    const slot = freeSlot();
    if (!slot) return;
    const template = workoutTemplate({
      slot,
      focus,
      intensity,
      minutesPerSession: Number(sessionMinutes),
    });
    const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
    const day = generateDay({
      blockId: block.id,
      exercises,
      focusMuscles: focusOrDefault,
      template,
      // Complements what the other workouts hold, without touching them.
      exclude: current.map((entry) => entry.exerciseId),
      variant: 0,
      hasHistory: hasHistory ?? false,
    });

    await db.blockExercise.bulkPut(day.exercises);
    const stored = (await readSchedules())[block.id] ?? {};
    await writeSchedule(block.id, {
      ...stored,
      [slot]: {
        intensity,
        effortCue: template.effortCue,
        generated: true,
        name: describeDay(
          day.exercises
            .map((entry) => byId.get(entry.exerciseId))
            .filter((exercise): exercise is Exercise => exercise !== undefined),
          intensity,
        ),
      },
    });
    setVariantBySlot((prev) => ({ ...prev, [slot]: 0 }));
    setEditingSlot(slot);
  };

  /** An empty workout to fill by hand. */
  const createBlankWorkout = async () => {
    if (!block) return;
    const slot = freeSlot();
    if (!slot) return;
    const stored = (await readSchedules())[block.id] ?? {};
    await writeSchedule(block.id, { ...stored, [slot]: { intensity: 'heavy' } });
    setEditingSlot(slot);
    setAddingTo(slot);
  };

  /**
   * Fills the days that are empty, each seeing the ones before it, then spends
   * the week's set budget across only those days — a day you built by hand
   * counts toward the weekly total but is never edited to hit it.
   */
  const fillEmptyDays = async () => {
    if (!block) return;
    await setUpWeek();
    const existing = await db.blockExercise.where('blockId').equals(block.id).toArray();
    const exclude = existing.map((entry) => entry.exerciseId);

    const built: DayPlan[] = [];
    const used = [...exclude];
    for (const day of templateDays) {
      if (existing.some((entry) => entry.daySlot === day.slot)) continue;
      const generated = buildSlot(day.slot, 0, used);
      if (!generated) continue;
      built.push(generated);
      used.push(...generated.exercises.map((entry) => entry.exerciseId));
    }
    if (built.length === 0) return;

    const fixedSets = existing.reduce((n, entry) => n + entry.targetSets, 0);
    const template = built
      .map((day) => templateFor(day.slot))
      .filter((day): day is TemplateDay => day !== undefined);
    balanceSets(built, template, byId, training.weeklySetTarget, fixedSets);

    for (const day of built) await writeDay(day);
    setVariantBySlot((prev) => ({
      ...prev,
      ...Object.fromEntries(built.map((day) => [day.slot, 0])),
    }));
  };

  /*
   * The rules, run against what is actually in the block rather than against a
   * proposal. The old preview was the only thing that ever validated, so a day
   * built or edited by hand was never checked at all — the rules now apply to
   * every day however it got there.
   *
   * The template handed to the validator is built from where the days ACTUALLY
   * are, so dragging a session to another weekday is a decision to respect, not
   * a violation to report. Its grip and spinal rules re-derive from that day.
   */
  const blockViolations = useMemo(() => {
    const scheduled = orderedSlots(schedule ?? {});
    if (scheduled.length === 0 || (slots ?? []).length === 0) return [];
    const template = scheduled
      .map((entry) => templateFor(entry.slot))
      .filter((day): day is TemplateDay => day !== undefined);
    const context: ValidationContext = {
      exercisesById: byId,
      golfWeekdays: training.golfWeekdays as never,
      weeklySetTarget: training.weeklySetTarget,
      sessionBudgetMinutes: Number(sessionMinutes),
      hasHistory: hasHistory ?? false,
      laddersFor: (exercise) => ladderFor(exercise, inventory),
      template,
      nameFor: labelFor,
    };
    return validateBlock(
      {
        days: template.map((day) => ({
          slot: day.slot,
          weekday: day.weekday,
          exercises: entriesForSlot(slots ?? [], day.slot),
        })),
      },
      context,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, slots, byId, training, sessionMinutes, hasHistory, inventory, shape]);

  const problems = blockViolations.filter((violation) => severityOf(violation.code) === 'problem');
  const suggestions = blockViolations.filter(
    (violation) => severityOf(violation.code) === 'suggestion',
  );

  return (
    <Screen title="Program">
      <Card
        title="Week"
        trailing={
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => setAnchor(shiftIso(anchor, -7))}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
              aria-label="Previous week"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setAnchor(todayIso())}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchor(shiftIso(anchor, 7))}
              className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
              aria-label="Next week"
            >
              ›
            </button>
          </span>
        }
      >
        <WeekStrip
          week={week}
          labelFor={labelFor}
          onPickDay={setEditingDate}
          onMoveSlot={(slot, date) => void movePlanned(slot, date)}
        />
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Tap a day to set gym, golf or rest. Drag a session to move it — this week only. Its usual
          day stays put unless you say otherwise.
        </p>

        {violations.length === 0 ? (
          <p className="mt-2 text-[12px] font-medium text-text-dim">
            No rule violations this week.
          </p>
        ) : (
          <div className="mt-3 rounded-xl bg-surface-2 p-3">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-rir-1)' }}>
              {violations.length} golf rule violation{violations.length === 1 ? '' : 's'}
            </p>
            {violations.map((day) => (
              <p key={day.date} className="mt-1 text-[12px] font-medium text-text-dim">
                {WEEKDAY_LABEL[day.weekday]}:{' '}
                {day.highGripExercises.map((id) => byId.get(id)?.name ?? id).join(', ')} —{' '}
                {day.gripConflict?.daysBefore === 0
                  ? 'same day as a round'
                  : `${day.gripConflict?.daysBefore} day${
                      day.gripConflict?.daysBefore === 1 ? '' : 's'
                    } before a round`}
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card title={block ? 'Current block' : 'No block'} className="mt-3">
        {block ? (
          <>
            <p className="text-[13px] font-medium text-text-dim">
              {longDate(block.startDate)} — {longDate(block.endDate)}
            </p>
            <Label className="mt-4 block">Sessions per week</Label>
            <div className="mt-1.5">
              <SegmentedToggle
                options={SESSION_COUNTS}
                value={sessionsPerWeek}
                onChange={setSessionsPerWeek}
              />
            </div>

            <Label className="mt-4 block">Heavy days</Label>
            <div className="mt-1.5 flex gap-1.5">
              {sessionWeekdays.map((weekday) => (
                <Chip
                  key={weekday}
                  active={effectiveHeavy.includes(weekday)}
                  onClick={() =>
                    setHeavyWeekdays((prev) => {
                      // The first tap adopts whatever the app was already doing,
                      // so toggling one day does not silently clear the others.
                      const base = prev ?? sessionWeekdays.slice(0, 2);
                      return base.includes(weekday)
                        ? base.filter((day) => day !== weekday)
                        : [...base, weekday].sort((a, b) => a - b);
                    })
                  }
                  tone="volume"
                >
                  {WEEKDAY_LABEL[weekday]}
                </Chip>
              ))}
            </div>
            <Label className="mt-1.5 block">
              {heavyWeekdays === null
                ? 'Balanced for you — the first two are heavy, the rest light.'
                : heavyWeekdays.length === 0
                  ? 'Every session light. A deload week — no day is compulsorily heavy.'
                  : `${heavyLabel} heavy, the rest light.`}
            </Label>

            {Number(sessionsPerWeek) > maxSessionsFor(training.golfWeekdays as never) && (
              <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
                Your golf days leave room for{' '}
                {maxSessionsFor(training.golfWeekdays as never)} sessions a week.
              </p>
            )}

            {/* Focus shapes the heavy days, so with none of them it changes
                nothing and has no business on the screen. */}
            {heavyCount > 0 && (
              <>
                <Label className="mt-4 block">Focus</Label>
                <div className="mt-1.5">
                  <SegmentedToggle
                    options={SESSION_SHAPES}
                    value={shape}
                    onChange={(next) => {
                      setShape(next);
                      const prefs = { ...training, shape: next };
                      setTraining(prefs);
                      void writeTraining(prefs);
                    }}
                    labels={SESSION_SHAPE_LABEL}
                  />
                </div>
                <Label className="mt-1.5 block">{SESSION_SHAPE_HINT[shape]}</Label>
              </>
            )}

            <Label className="mt-4 block">Session length</Label>
            <div className="mt-1.5">
              <SegmentedToggle
                options={SESSION_LENGTHS}
                value={sessionMinutes}
                onChange={(next) => {
                  setSessionMinutes(next);
                  const prefs = { ...training, sessionMinutes: Number(next) };
                  setTraining(prefs);
                  void writeTraining(prefs);
                }}
                labels={{ '30': '30 min', '40': '40 min', '60': '60 min' }}
              />
            </div>

            {/* Everything else is fixed by the template or lives in Settings. */}
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="mt-4 flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-[13px] font-medium text-text-dim">Advanced</span>
              <span className="text-[12px] font-medium text-text-dim">
                {showAdvanced ? 'Hide' : 'Show'}
              </span>
            </button>

            {showAdvanced && (
              <>
                <Label className="mt-3 block">
                  Emphasise these muscles (balanced if none are picked)
                </Label>
                {(['upper', 'lower', 'core'] as const).map((region) => (
                  <div key={region} className="mt-2">
                    <Label className="mb-1.5 block">{REGION_LABEL[region]}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {MUSCLES.filter((muscle) => muscle.region === region).map((muscle) => (
                        <Chip
                          key={muscle.id}
                          active={focusOrDefault.includes(muscle.id)}
                          onClick={() =>
                            setFocus((prev) => {
                              const base = prev.length > 0 ? prev : (block.focusMuscles ?? []);
                              return base.includes(muscle.id)
                                ? base.filter((m) => m !== muscle.id)
                                : [...base, muscle.id];
                            })
                          }
                        >
                          {muscle.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            <p className="mt-4 text-[12px] font-medium text-text-dim">
              {heavyCount === 0
                ? 'Every session is light and about 25 min.'
                : `${heavyLabel} ${heavyCount === 1 ? 'is the heavy session' : 'are the heavy sessions'}; every other one is light and about 25 min.`}{' '}
              {gripDays.length === 0
                ? 'No session is both heavy and clear enough of your rounds to carry grip work.'
                : `Grip work can only go on ${gripLabel}.`}{' '}
              Golf days and the weekly set target live in Settings.
            </p>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void setUpWeek()}
                className="h-11 flex-1 rounded-full bg-surface-2 text-[13px] font-medium text-text-dim"
              >
                Set up the days
              </button>
              <button
                type="button"
                onClick={() => void fillEmptyDays()}
                className="h-11 flex-[2] rounded-full bg-cta font-semibold text-bg"
              >
                Fill the empty days
              </button>
            </div>
            <p className="mt-2 text-[12px] font-medium text-text-dim">
              Filling only touches days that are still empty — anything you built or generated
              already is left exactly as it is. Generate a single day from its own card below.
            </p>
          </>
        ) : (
          <Empty>--</Empty>
        )}
      </Card>

      {/* Two headings, deliberately. Presenting "this session runs 7 minutes
          long" as urgently as "this deadlift is two days before your round"
          teaches you to skim past both. */}
      {problems.length > 0 && (
        <Card title="Worth fixing" className="mt-3">
          {problems.map((violation) => (
            <p
              key={violation.code + (violation.exerciseId ?? '') + (violation.slot ?? '')}
              className="mt-1.5 text-[12px] leading-snug font-medium first:mt-0"
              style={{ color: 'var(--color-warn)' }}
            >
              {violation.message}
            </p>
          ))}
        </Card>
      )}

      {suggestions.length > 0 && (
        <Card title="Suggestions" className="mt-3">
          {suggestions.map((violation) => (
            <p
              key={violation.code + (violation.exerciseId ?? '') + (violation.slot ?? '')}
              className="mt-1.5 text-[12px] leading-snug font-medium text-text-dim first:mt-0"
            >
              {violation.message}
            </p>
          ))}
          <p className="mt-2.5 text-[11px] font-medium text-text-faint">
            Notes, not rules — ignore any of these you disagree with.
          </p>
        </Card>
      )}

      {DAY_SLOTS.map((slot) => {
        const list = entriesForSlot(slots ?? [], slot);
        const isEditing = editingSlot === slot;
        const scheduled = schedule?.[slot];
        if (list.length === 0 && !isEditing && scheduled === undefined) return null;
        const weekday = scheduled?.weekday;
        return (
          <DaySlotCard
            key={slot}
            label={labelFor(slot)}
            customName={scheduled?.name}
            onRename={(name) => void renameSlot(slot, name)}
            weekday={weekday}
            entries={list}
            exercisesById={byId}
            editing={isEditing}
            isToday={weekday !== undefined && weekday === weekdayOf(todayIso())}
            intensity={scheduled?.intensity ?? 'heavy'}
            onToggleEdit={() => setEditingSlot(isEditing ? null : slot)}
            onStart={() => onStartDay(slot)}
            onAdd={() => setAddingTo(slot)}
            onRemove={(exerciseId) => {
              if (block) void removeBlockExercise(block.id, slot, exerciseId);
            }}
            onMove={(exerciseId, direction) => {
              if (block) void moveBlockExercise(block.id, slot, exerciseId, direction);
            }}
            onUpdate={(entry, patch) => void updateBlockExercise(entry, patch)}
            canGenerate={templateFor(slot) !== undefined}
            generated={variantBySlot[slot] !== undefined || scheduled?.generated === true}
            onGenerate={() => {
              // Only ever destructive with a yes: a day built by hand is not
              // something to overwrite because a button was nearby.
              if (
                list.length > 0 &&
                !window.confirm(
                  `Replace the ${list.length} exercises in ${labelFor(slot)} with a generated day?`,
                )
              ) {
                return;
              }
              void generateSlot(slot, 0);
            }}
            onShuffle={() => void generateSlot(slot, (variantBySlot[slot] ?? 0) + 1)}
            onClearDay={() => {
              if (block && window.confirm(`Delete ${labelFor(slot)} and everything in it?`)) {
                void clearDaySlot(block.id, slot);
                setEditingSlot(null);
              }
            }}
          />
        );
      })}

      {/* Making a workout, as its own act. Where it goes in the week is a
          separate decision taken on the calendar above. */}
      {block && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={freeSlot() === undefined}
          className="mt-3 h-11 w-full rounded-full bg-surface-2 text-sm font-medium text-text-dim disabled:text-text-faint"
        >
          {freeSlot() === undefined ? `All ${DAY_SLOTS.length} workouts used` : 'New workout'}
        </button>
      )}

      {creating && (
        <NewWorkoutSheet
          onCreate={(focus, intensity) => {
            setCreating(false);
            void createWorkout(focus, intensity);
          }}
          onBlank={() => {
            setCreating(false);
            void createBlankWorkout();
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {(slots?.length ?? 0) === 0 && Object.keys(schedule ?? {}).length === 0 && (
        <Card title="No days yet" className="mt-3">
          <Empty>--- sets</Empty>
          <p className="mt-2 text-[13px] text-text-dim">
            Set up the days above, then generate them one at a time or all at once. Exercises stay
            fixed for the whole block — that is what makes progressive overload work.
          </p>
        </Card>
      )}

      {addingTo && block && (
        <ExercisePicker
          exercises={exercises}
          selectedIds={entriesForSlot(slots ?? [], addingTo).map((entry) => entry.exerciseId)}
          onPick={(exerciseId) => void addBlockExercise(block.id, addingTo, exerciseId)}
          onClose={() => setAddingTo(null)}
        />
      )}

      {editingDate && (
        <DayEditor
          date={editingDate}
          slots={definedSlots}
          labelFor={labelFor}
          currentSlot={week.find((day) => day.date === editingDate)?.plannedSlot}
          golf={golfDays?.find((day) => day.date === editingDate)}
          onSetSlot={(slot) => {
            void movePlanned(slot, editingDate);
            setEditingDate(null);
          }}
          usualLabel={`Do this every ${WEEKDAY_LABEL[weekdayOf(editingDate)]}`}
          onSetUsual={() => {
            const current = week.find((day) => day.date === editingDate)?.plannedSlot;
            if (current) void makeUsual(current, editingDate);
            setEditingDate(null);
          }}
          onSetGolf={(status) => {
            void setGolf(editingDate, status);
            setEditingDate(null);
          }}
          onClose={() => setEditingDate(null)}
        />
      )}

      {golfDays && golfDays.length > 0 && (
        <Card title="Golf calendar" className="mt-3">
          {golfDays
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8)
            .map((day) => (
              <div key={day.date} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-[14px] font-medium">{friendlyDate(day.date)}</span>
                <Label>{day.status}</Label>
              </div>
            ))}
        </Card>
      )}
    </Screen>
  );
}
