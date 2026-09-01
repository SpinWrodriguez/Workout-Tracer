import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, Muscle, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { friendlyDate, longDate, todayIso } from '../lib/format';
import { WEEKDAY_LABEL, buildWeek, weekdayOf, type Weekday } from '../lib/golf';
import { readInventory } from '../db/settings';
import { DEFAULT_INVENTORY, ladderFor, type Inventory } from '../lib/loadable';
import { balanceSets, generateDay, type DayPlan } from '../lib/blockBuilder';
import {
  gripAllowed,
  severityOf,
  validateBlock,
  type Fix,
  type ValidationContext,
} from '../lib/blockValidation';
import { dayLabel, describeDay, shortDayLabels } from '../lib/dayLabel';
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
import { isModelAvailable } from '../lib/askModel';
import { generateAiWorkout, templateForAiWorkout, type AiWorkout } from '../lib/aiWorkout';
import { briefPayload, buildBrief, undertrained, type DayConstraints } from '../lib/aiBrief';
import { readAiInstructions } from '../db/settings';
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
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [thirdDay] = useState<number>(DEFAULT_THIRD_DAY);
  /* null means the app balances it; an empty array means every session light. */
  const [heavyWeekdays, setHeavyWeekdays] = useState<Weekday[] | null>(null);
  const [shape, setShape] = useState<SessionShape>('mixed');
  const [showAdvanced, setShowAdvanced] = useState(false);
  /* Collapsed: the starter week is a shortcut, not the way the screen works. */
  const [showStarter, setShowStarter] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | undefined>(undefined);
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

  /* Shortened against the rest of the week: what to drop from a name depends
     on what the other days are called. */
  const shortLabelFor = (() => {
    const inWeek = week
      .map((day) => day.plannedSlot)
      .filter((slot): slot is DaySlot => slot !== undefined);
    const shorts = shortDayLabels(inWeek.map((slot) => labelFor(slot)));
    const map = new Map(inWeek.map((slot, i) => [slot, shorts[i] as string]));
    return (slot: DaySlot) => map.get(slot) ?? labelFor(slot);
  })();

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
      // Ask for what the workout was made to be. Absent on older workouts, and
      // templateDayFor falls back to inferring from the week for those.
      focus: scheduled?.focus,
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
  const writeDay = async (day: DayPlan, variant: number) => {
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
        /*
         * Everything the WORKOUT owns is carried over — its focus above all.
         * Rebuilding this object from the day alone dropped the focus on the
         * first regenerate, which quietly undid the whole point of storing it.
         */
        ...stored[day.slot],
        weekday: day.weekday,
        intensity: day.intensity,
        effortCue: day.effortCue,
        generated: true,
        variant,
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

    await writeDay(day, variant);
  };

  /**
   * The next draw along. Rotation is bounded and repeatable, so asking for the
   * same variant is asking for the same day — which is what made "Regenerate"
   * look broken: it was wired to variant 0, documented as always the strongest
   * draw, so pressing it returned exactly what was already on screen.
   */
  const nextVariant = (slot: DaySlot) => (schedule?.[slot]?.variant ?? 0) + 1;

  /** Carries out the change a problem described. */
  const applyFix = async (fix: Fix) => {
    if (!block) return;
    if (fix.kind === 'remove_exercise') {
      await removeBlockExercise(block.id, fix.slot, fix.exerciseId);
      return;
    }
    if (fix.kind === 'move_to_weekday') {
      await writeSchedule(block.id, setUsualWeekday(schedule ?? {}, fix.slot, fix.weekday));
      // A date entry pinning it to the old day would immediately undo this.
      const current = (await readPlans())[block.id] ?? {};
      await writePlan(
        block.id,
        Object.fromEntries(Object.entries(current).filter(([, value]) => value !== fix.slot)),
      );
      return;
    }
    const entry = (await db.blockExercise.where('blockId').equals(block.id).toArray()).find(
      (row) => row.daySlot === fix.slot && row.exerciseId === fix.exerciseId,
    );
    if (entry) await db.blockExercise.put({ ...entry, startWeightKg: fix.kg });
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
        focus,
        variant: 0,
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
    setEditingSlot(slot);
  };

  /**
   * A workout described in words. The model chooses the exercises; everything
   * about where it goes, what it may exclude and what it costs stays here.
   *
   * The proposal is validated on its own, against a template derived from the
   * focus and intensity the model asked for — not against the stored week,
   * because this workout has no day yet and a rule about placement cannot
   * apply to something unplaced.
   */
  const askForWorkout = async (goal: string, forDate?: string) => {
    if (!block || asking) return;
    const slot = freeSlot();
    if (!slot) {
      setAskError('Every workout slot in this block is taken.');
      return;
    }
    setAsking(true);
    setAskError(undefined);
    try {
      const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
      const stored = (await readSchedules())[block.id] ?? {};
      const existing = orderedSlots(stored).map((entry) => ({
        slot: entry.slot,
        name: labelFor(entry.slot),
        focus: stored[entry.slot]?.focus,
        intensity: (stored[entry.slot]?.intensity ?? 'heavy') as 'heavy' | 'light',
        exerciseIds: current
          .filter((row) => row.daySlot === entry.slot)
          .map((row) => row.exerciseId),
      }));

      /*
       * What the app can answer for itself. An empty goal box is the normal
       * case: the shortfall in this week is something the lifter would
       * otherwise have to read off the Levels screen and retype.
       */
      const weekFrom = weekStart(forDate ?? todayIso());
      const weekSessions = await db.session
        .where('date')
        .between(weekFrom, shiftIso(weekFrom, 7), true, false)
        .toArray();
      const sessionIds = new Set(weekSessions.map((session) => session.id));
      const weekLogs = (await db.setLog.toArray()).filter((log) => sessionIds.has(log.sessionId));

      /*
       * Limits the chosen day imposes. Passed on as prohibitions with no reason
       * attached — a model told WHY starts reasoning about the calendar, and it
       * has already been caught getting that wrong.
       */
      const placed = forDate
        ? {
            weekday: weekdayOf(forDate),
            golfWeekdays: training.golfWeekdays as never as Weekday[],
          }
        : undefined;

      const constraints: DayConstraints = {};
      if (placed && !gripAllowed(placed.weekday, placed.golfWeekdays)) {
        constraints.noHighGrip = true;
      }

      const brief = buildBrief({
        goal,
        instructions: await readAiInstructions(),
        undertrained: undertrained(weekLogs, byId),
        existing,
        constraints,
      });

      const outcome = await generateAiWorkout({
        blockId: block.id,
        slot,
        user: JSON.stringify(
          briefPayload(brief, {
            goal,
            instructions: await readAiInstructions(),
            undertrained: undertrained(weekLogs, byId),
            existing,
            constraints,
          }),
        ),
        exercises,
        validate: (workout: AiWorkout) => {
          const template = templateForAiWorkout(
            workout,
            slot,
            Number(sessionMinutes),
            placed,
          );
          return validateBlock(
            {
              days: [
                {
                  slot,
                  // The real day when there is one. The placeholder inside an
                  // unplaced template is Monday, and validating a Thursday
                  // against Monday is how a lat pulldown got two days from a
                  // round.
                  weekday: placed?.weekday ?? template.weekday,
                  exercises: workout.exercises,
                },
              ],
            },
            {
              exercisesById: byId,
              /*
               * A workout asked for on a specific date is checked against the
               * real calendar, which is stricter than the unplaced case: the
               * golf rule applies because there IS a date to be clear of.
               * Without one there is nothing to be clear of, and assigning it
               * to a day later is what surfaces the conflict.
               */
              golfWeekdays: forDate ? (training.golfWeekdays as never) : [],
              weeklySetTarget: training.weeklySetTarget,
              sessionBudgetMinutes: Number(sessionMinutes),
              hasHistory: hasHistory ?? false,
              laddersFor: (exercise) => ladderFor(exercise, inventory),
              template: [template],
              nameFor: () => workout.name ?? `Day ${slot}`,
            },
          );
        },
      });

      if (!outcome.ok) {
        setAskError(outcome.reason);
        return;
      }

      const template = templateForAiWorkout(
        outcome.workout,
        slot,
        Number(sessionMinutes),
        placed,
      );
      await db.blockExercise.bulkPut(outcome.workout.exercises);
      await writeSchedule(block.id, {
        ...stored,
        [slot]: {
          intensity: outcome.workout.intensity,
          focus: outcome.workout.focus,
          variant: 0,
          effortCue: template.effortCue,
          generated: true,
          // The model's name if it gave a usable one, otherwise derived from the
          // contents exactly as a hand-made workout is.
          name:
            outcome.workout.name ??
            describeDay(
              outcome.workout.exercises
                .map((entry) => byId.get(entry.exerciseId))
                .filter((exercise): exercise is Exercise => exercise !== undefined),
              outcome.workout.intensity,
            ),
        },
      });
      /*
       * Asked for on a date, so it goes there — the user picked the day, which
       * is not the same as the generator picking one. The model still never
       * saw it.
       */
      if (forDate) {
        const plans = (await readPlans())[block.id] ?? {};
        await writePlan(block.id, { ...plans, [forDate]: slot });
      }

      setCreating(false);
      setEditingDate(null);
      setEditingSlot(slot);
    } catch (cause) {
      setAskError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAsking(false);
    }
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

    for (const day of built) await writeDay(day, 0);
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

  const problems = blockViolations.filter(
    (violation) => severityOf(violation.code) === 'problem' && violation.fix !== undefined,
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
          shortLabelFor={shortLabelFor}
          onPickDay={setEditingDate}
          onMoveSlot={(slot, date) => void movePlanned(slot, date)}
        />
        {violations.length === 0 ? null : (
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

            {/* A shortcut, and labelled as one. It creates workouts AND places
                them in the week in a single action, which is the one thing on
                this screen that still conflates the two. Collapsed by default
                so the screen reads as workouts and a calendar; kept because it
                is the fastest path from an empty block to a full week, which is
                what a first run needs. */}
            <button
              type="button"
              onClick={() => setShowStarter((prev) => !prev)}
              className="mt-4 flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-[13px] font-medium text-text-dim">
                Build a starter week
              </span>
              <span className="text-[12px] font-medium text-text-dim">
                {showStarter ? 'Hide' : 'Show'}
              </span>
            </button>

            {showStarter && (
              <>
                <Label className="mt-2 block">
                  Fills the week in one go — it makes the workouts and puts them on
                  days. Everything below can be changed afterwards, and a workout
                  you make yourself is never placed for you.
                </Label>
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
              {heavyWeekdays?.length === 0
                ? 'All light — a deload week.'
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
              </>
            )}

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
                <Label className="mt-3 block">Emphasise</Label>
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



          </>
        ) : (
          <Empty>--</Empty>
        )}
      </Card>

      {/* Only problems, and only ones that carry their own fix. Advice about
          volume and time was noise: true, unactionable, and endless. */}
      {problems.length > 0 && (
        <Card title="Worth fixing" className="mt-3">
          {problems.map((violation) => (
            <div
              key={violation.code + (violation.exerciseId ?? '') + (violation.slot ?? '')}
              className="border-t border-border pt-2.5 first:border-t-0 first:pt-0 [&+&]:mt-2.5"
            >
              <p
                className="text-[12px] leading-snug font-medium"
                style={{ color: 'var(--color-warn)' }}
              >
                {violation.message}
              </p>
              {violation.fix && (
                <button
                  type="button"
                  onClick={() => void applyFix(violation.fix as Fix)}
                  className="mt-2 rounded-full bg-surface-2 px-4 py-1.5 text-[12px] font-semibold"
                >
                  {violation.fix.label}
                </button>
              )}
            </div>
          ))}
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
            generated={scheduled?.generated === true}
            onGenerate={() => {
              // Only ever destructive with a yes: a workout built by hand is
              // not something to overwrite because a button was nearby.
              if (
                list.length > 0 &&
                !window.confirm(
                  `Replace the ${list.length} exercises in ${labelFor(slot)} with a new draw?`,
                )
              ) {
                return;
              }
              // An empty workout has nothing to differ from, so it takes the
              // strongest draw; a day with contents is being asked to change.
              void generateSlot(slot, list.length === 0 ? 0 : nextVariant(slot));
            }}
            onShuffle={() => void generateSlot(slot, nextVariant(slot))}
            onClearDay={() => {
              if (
                block &&
                window.confirm(
                  `Delete the workout "${labelFor(slot)}"? Its exercises go with it, and it comes off the calendar.`,
                )
              ) {
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
          onAsk={(goal) => void askForWorkout(goal)}
          modelAvailable={isModelAvailable()}
          asking={asking}
          askError={askError}
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
        <Card title="No workouts yet" className="mt-3">
          <Empty>--- sets</Empty>
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
          onAsk={(goal) => void askForWorkout(goal, editingDate)}
          modelAvailable={isModelAvailable()}
          asking={asking}
          askError={askError}
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
