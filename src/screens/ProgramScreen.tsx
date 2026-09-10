import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, MuscleId } from '../db/types';
import { longDate, todayIso } from '../lib/format';
import { WEEKDAY_LABEL, buildWeek, gripBufferNote, weekdayOf, type Weekday } from '../lib/golf';
import { readInventory } from '../db/settings';
import { DEFAULT_INVENTORY, ladderFor, type Inventory } from '../lib/loadable';
import { balanceSets, generateDay, type DayPlan } from '../lib/blockBuilder';
import {
  gripAllowed,
  spineAllowed,
  sessionMinutes as estimateMinutes,
  severityOf,
  validateBlock,
  type Fix,
  type ValidationContext,
} from '../lib/blockValidation';
import { dayLabel, describeDay, shortDayLabels } from '../lib/dayLabel';
import {
  focusForMuscles,
  templateDayFor,
  workoutTemplate,
  type Intensity,
  type WorkoutFocus,
  type TemplateDay,
} from '../lib/weekTemplate';
import { readTraining, DEFAULT_TRAINING, type TrainingPrefs } from '../db/settings';
import {
  addBlockExercise,
  clearDaySlot,
  definedSlotsOf,
  entriesForSlot,
  reorderBlockExercises,
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
import { DayEditor, type DayEditorSlot } from '../components/DayEditor';
import { NewWorkoutSheet } from '../components/NewWorkoutSheet';
import {
  WeekPlanSheet,
  type PlannedWeekDay,
  type WeekPlanDay,
} from '../components/WeekPlanSheet';
import { isModelAvailable } from '../lib/askModel';
import {
  generateAiWorkout,
  libraryForFocuses,
  libraryForMuscles,
  templateForAiWorkout,
  type AiWorkout,
} from '../lib/aiWorkout';
import { generateAiWeek, type WeekSlotRequest } from '../lib/aiWeek';
import { briefPayload, buildBrief, undertrained, type DayConstraints } from '../lib/aiBrief';
import { readAiInstructions, writeLastModelCall } from '../db/settings';
import { DaySlotCard } from '../components/DaySlotCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { WeekStrip, type WeekStripDay } from '../components/WeekStrip';
import { shiftIso, weekStart } from '../lib/format';
import { budgetMinutes, readTimeFactor, realMinutes } from '../lib/timeModel';
import { MUSCLES } from '../db/seed/muscles';
import { Silhouette } from '../components/Silhouette';
import { fairShare, mergeVolume, plannedSetsPerMuscle, setsPerMuscle } from '../lib/volume';

const DAY_SLOTS = SLOTS;

/** The seven dates of the week containing a date, Monday first. */
const weekDatesOf = (iso: string): string[] =>
  Array.from({ length: 7 }, (_, i) => shiftIso(weekStart(iso), i));

export function ProgramScreen({
  exercises,
  onStartDay,
  onWeekChange,
}: {
  exercises: Exercise[];
  onStartDay: (slot: DaySlot) => void;
  /**
   * Which week is on screen, published upward as the arrows move it. The
   * coach button floats above this screen and belongs to the app, not to it,
   * so this is how "the week I have open" reaches the question — planning
   * next week from this one is the normal way to use this screen, and the
   * coach used to answer about the current week regardless.
   */
  onWeekChange?: (anchorDate: string) => void;
}) {
  const [anchor, setAnchor] = useState(() => todayIso());
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | undefined>(undefined);
  const [planningWeek, setPlanningWeek] = useState(false);
  /* One model call per workout, so a week takes real time. Saying which day is
     being built is the difference between slow and broken. */
  const [building, setBuilding] = useState<{ done: number; total: number } | undefined>(undefined);
  const [training, setTraining] = useState<TrainingPrefs>(DEFAULT_TRAINING);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);
  const [addingTo, setAddingTo] = useState<DaySlot | null>(null);
  /* Which exercise is being read about. The sheet already existed on the
     Session and History screens; this is the screen where you are choosing,
     which is when knowing how a movement goes actually changes the choice. */
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);

  useEffect(() => {
    let cancelled = false;
    void readInventory().then((next) => {
      if (!cancelled) setInventory(next);
    });
    void readTraining().then((next) => {
      if (!cancelled) setTraining(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* A first block has no history, which is what bars advanced movements. */
  const hasHistory = useLiveQuery(async () => (await db.setLog.count()) > 0, [], false);

  const block = useLiveQuery(() => db.block.orderBy('startDate').reverse().first(), [], undefined);
  const golfDays = useLiveQuery(() => db.golfDay.toArray(), [], undefined);
  /* Every round, in date order. `gripConflictOn` only looks forward, so a
     round already played constrains nothing. */
  const golfDateList = (golfDays ?? []).map((day) => day.date);
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

  /**
   * What this week actually did, alongside what it plans to.
   *
   * Both halves come from one query because both answer the same question and
   * must not disagree: a workout can be deleted after it has been trained, and
   * the session is what survives that. The name is carried too, so a day whose
   * workout is gone is still called by what was done on it rather than "Log".
   */
  const weekHistory = useLiveQuery(async () => {
    const start = weekStart(anchor);
    const rows = await db.session
      .where('date')
      .between(start, shiftIso(start, 7), true, false)
      .toArray();
    const ids = new Set(rows.map((row) => row.id));
    const logs = (await db.setLog.toArray()).filter((log) => ids.has(log.sessionId));
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        date: s.date,
        slot: s.daySlot as DaySlot,
        name: s.daySlotName,
        exerciseIds: [
          ...new Set(logs.filter((l) => l.sessionId === s.id).map((l) => l.exerciseId)),
        ],
      })),
      logs,
      trainedDates: new Set(rows.map((row) => row.date)),
    };
  }, [anchor]);

  /**
   * How many times each workout has ever been done.
   *
   * Matched on the NAME the session was logged under where it has one, falling
   * back to the slot letter: a letter is reused when a workout is deleted and
   * another built in its place, so counting letters alone would credit a new
   * workout with a previous one's sessions. A rename is the other way round —
   * the sessions keep the old name — and the slot fallback catches those.
   */
  const timesDoneBySlot = useLiveQuery(async () => {
    const sessions = await db.session.toArray();
    return (slot: DaySlot, label: string): number =>
      sessions.filter((row) =>
        row.daySlotName ? row.daySlotName === label : row.daySlot === slot,
      ).length;
  }, []);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /* Session length and split shape are training preferences, edited in
     Settings. They were on this screen as part of the starter week, which put
     two program-wide settings inside a shortcut nobody had to use. */
  /*
   * The budget the generator builds to, in ESTIMATE minutes. Scaled by what
   * sessions actually take: the model over-estimates a lifting day badly
   * enough that a 40-minute budget was buying 28 real minutes. Unscaled until
   * there are a few sessions to measure — see src/lib/timeModel.ts.
   */
  const timeFactor = useLiveQuery(() => readTimeFactor(byId), [byId], undefined);
  const sessionMinutes = budgetMinutes(training.sessionMinutes, timeFactor);
  /* What one muscle can expect from the week that was asked for. The evidence
     floor of 8 is unreachable at this target, so telling the generator every
     muscle is short tells it nothing. */
  const share = fairShare(training.weeklySetTarget, byId);
  const shape = training.shape;

  useEffect(() => {
    onWeekChange?.(anchor);
  }, [anchor, onWeekChange]);

  const week: WeekStripDay[] = useMemo(() => {
    return buildWeek({
      anchorDate: anchor,
      golfDays: golfDays ?? [],
      sessions: weekHistory?.sessions ?? [],
      exercisesById: byId,
    }).map((day) => {
      // Resolved per date, so a session moved in one week shows as moved in
      // that week and nowhere else.
      const plannedSlot = slotForDate(schedule ?? {}, day.date, datePlan ?? {});
      return {
        ...day,
        plannedSlot,
        // What colours the chip, now that "light" is no longer a word on it.
        intensity: plannedSlot ? (schedule?.[plannedSlot]?.intensity ?? 'heavy') : undefined,
      };
    });
  }, [anchor, golfDays, weekHistory, byId, schedule, datePlan]);

  /**
   * Every workout this block defines, placed or not. Read from the schedule as
   * well as the exercise rows, so a workout made and not yet filled in still
   * has a name, an effort, and a place in the day editor's list.
   */
  const definedSlots = useMemo(
    () => definedSlotsOf(schedule ?? {}, slots ?? []),
    [schedule, slots],
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

  const weekDates = useMemo(() => weekDatesOf(anchor), [anchor]);

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

  const setGolf = async (date: string, status: GolfDay['status'] | undefined) => {
    if (status === undefined) await db.golfDay.delete(date);
    else {
      const existing = await db.golfDay.get(date);
      await db.golfDay.put({ date, status, holes: existing?.holes ?? 18 });
    }
  };

  /**
   * Where a workout sits in the week ON SCREEN, if it sits anywhere. This is
   * the only address that matters now: placement is a date, so the answer
   * differs from week to week and that is the point.
   */
  const dateFor = (slot: DaySlot): string | undefined =>
    week.find((day) => day.plannedSlot === slot)?.date;

  /*
   * The day editor's tiles. It used to be handed slot letters and a labelFor,
   * which is a name and nothing else — and a name is not enough to choose
   * between two workouts when the question is really "have I got time for
   * this one". Everything below is already computed for the day cards.
   */
  const editorSlots: DayEditorSlot[] = definedSlots.map((slot) => {
    const list = entriesForSlot(slots ?? [], slot);
    const onDate = dateFor(slot);
    return {
      slot,
      label: labelFor(slot),
      intensity: schedule?.[slot]?.intensity ?? 'heavy',
      exercises: list.length,
      sets: list.reduce((sum, entry) => sum + entry.targetSets, 0),
      minutes:
        list.length > 0 ? realMinutes(estimateMinutes(list, byId), timeFactor) : undefined,
      /* Resolved against the week ON SCREEN, so planning next week tags where
         things sit in THAT week, not where they were this one. */
      onWeekday: onDate !== undefined ? weekdayOf(onDate) : undefined,
    };
  });

  /** The week as the planner sees it: which dates are free, taken, or a round. */
  const weekPlanDays: WeekPlanDay[] = useMemo(
    () =>
      week.map((day) => ({
        date: day.date,
        golf: day.golf !== undefined,
        taken: day.plannedSlot !== undefined ? labelFor(day.plannedSlot) : undefined,
        /* What the rule will do to a workout built for this date, said before
           it happens rather than never. */
        note: gripBufferNote(day.date, golfDateList)?.text,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [week, schedule, slots, golfDays],
  );

  /**
   * What the week on screen intends to train, from the workouts placed on it.
   *
   * Programmed, not logged: the Levels map answers "how did the week go", which
   * is a question for afterwards. This one answers "what does this week miss",
   * which is still yours to fix — which is the whole reason it sits above the
   * workouts rather than on Levels.
   */
  const plannedVolume = useMemo(() => {
    const trained = weekHistory?.trainedDates ?? new Set<string>();
    /* A day is described once: by what it logged if it has been trained, by
       what it plans otherwise. Counting both would double a day that went
       exactly as written, and reading only the plan would empty a day whose
       workout was deleted after it was done. */
    const stillToCome = week
      .filter((day) => !trained.has(day.date))
      .map((day) => day.plannedSlot)
      .filter((slot): slot is DaySlot => slot !== undefined)
      .flatMap((slot) => entriesForSlot(slots ?? [], slot));
    return mergeVolume(
      setsPerMuscle(weekHistory?.logs ?? [], byId),
      plannedSetsPerMuscle(stillToCome, byId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, slots, byId, weekHistory]);

  /** Muscles the week does not touch at all — the gap worth naming. */
  const untouched = MUSCLES.filter((muscle) => (plannedVolume[muscle.id] ?? 0) === 0);

  /** The workouts on the visible week, in the order they are trained. */
  const placedSlots = useMemo(
    () =>
      week
        .map((day) => day.plannedSlot)
        .filter((slot): slot is DaySlot => slot !== undefined),
    [week],
  );

  /**
   * The constraints one workout should be generated and judged under.
   *
   * The weekday comes from the DATE it is planned on in the week being looked
   * at — not from a stored weekday and not from a template's idea of where a
   * third session goes. A workout dragged to Thursday has Thursday's grip
   * clearance, and next week it may be somewhere else entirely.
   */
  const templateFor = (slot: DaySlot): TemplateDay => {
    const scheduled = schedule?.[slot];
    const intensity = scheduled?.intensity ?? 'heavy';
    const date = dateFor(slot);
    const weekday = date !== undefined ? weekdayOf(date) : scheduled?.weekday;

    /*
     * Unplaced. There is no date, so there is nothing for the golf rule to be
     * clear of — and inventing a weekday to satisfy it is exactly how a lat
     * pulldown once passed validation two days before a round. Assigning the
     * workout to a day is what surfaces a conflict, which is where it belongs.
     */
    if (weekday === undefined) {
      return workoutTemplate({
        slot,
        // 'full' for a workout made before focus was stored: it is the only
        // honest default, since the day covers everything and nothing.
        focus: scheduled?.focus ?? 'full',
        intensity,
        minutesPerSession: sessionMinutes,
      });
    }

    // Position among the workouts of the same effort picks the pattern set, so
    // a second heavy day complements the first rather than repeating it.
    const peers = placedSlots.filter(
      (other) => (schedule?.[other]?.intensity ?? 'heavy') === intensity,
    );

    return templateDayFor({
      slot,
      weekday,
      intensity,
      // What the workout was made to be. Absent on ones made before this was
      // stored; templateDayFor falls back to inferring from the weekday there.
      focus: scheduled?.focus,
      index: Math.max(0, peers.indexOf(slot)),
      shape,
      minutesPerSession: sessionMinutes,
      golfWeekdays: training.golfWeekdays as never,
    });
  };

  /** Builds one day in memory. Writes nothing — see writeDay. */
  const buildSlot = (slot: DaySlot, variant: number, exclude: string[]) => {
    if (!block) return undefined;
    const template = templateFor(slot);
    if (!template) return undefined;
    return generateDay({
      blockId: block.id,
      exercises,
      focusMuscles: block.focusMuscles ?? [],
      template,
      exclude,
      variant,
      hasHistory: hasHistory ?? false,
    });
  };

  /**
   * Replaces one workout's exercises. It does NOT place it: writing a weekday
   * here is what put a workout into every week that would ever exist, so
   * generating four days filled the whole calendar instead of one week.
   */
  const writeDay = async (day: DayPlan, variant: number) => {
    if (!block) return;
    await db.transaction('rw', [db.blockExercise], async () => {
      const stale = (await db.blockExercise.where('blockId').equals(block.id).toArray()).filter(
        (entry) => entry.daySlot === day.slot,
      );
      await db.blockExercise.bulkDelete(
        stale.map(
          (entry) => [entry.blockId, entry.exerciseId, entry.daySlot] as [string, string, string],
        ),
      );
      await db.blockExercise.bulkPut(day.exercises);
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
  const createWorkout = async (muscles: MuscleId[], intensity: 'heavy' | 'light') => {
    if (!block) return;
    const slot = freeSlot();
    if (!slot) return;
    /* The muscles decide the movement patterns; the focus is only the label
       everything downstream reads — the day's name, the validator, a brief. */
    const focus = focusForMuscles(muscles);
    const template = workoutTemplate({
      slot,
      focus,
      muscles,
      intensity,
      minutesPerSession: sessionMinutes,
    });
    const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
    const day = generateDay({
      blockId: block.id,
      exercises,
      /* What was pointed at, so the pick inside each pattern goes to the
         chosen muscle: the pattern says "a horizontal pull", this says "and
         make it the one that hits lats". */
      focusMuscles: muscles,
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
   * One workout, asked for and written. The model chooses the exercises;
   * everything about where it goes, what it may exclude and what it costs
   * stays here.
   *
   * Reads the block fresh rather than off the live query, because the week
   * builder calls this in a loop and the live query lags a write by a tick —
   * which would hand every day in the week the same slot.
   */
  const askOneWorkout = async (want: {
    goal: string;
    focus?: WorkoutFocus;
    intensity?: Intensity;
    /** What the body picker was pointing at, when the ask came from there. */
    muscles?: MuscleId[];
  }): Promise<{ ok: true; slot: DaySlot } | { ok: false; reason: string }> => {
    if (!block) return { ok: false, reason: 'No block.' };

    const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
    const stored = (await readSchedules())[block.id] ?? {};
    const slot = DAY_SLOTS.find((candidate) => !definedSlotsOf(stored, current).includes(candidate));
    if (!slot) return { ok: false, reason: 'Every workout slot in this block is taken.' };

    /*
     * Every workout in the block, placed or not. It used to read only the
     * placed ones, which was fine while generating also placed — now that it
     * does not, that filter would have hidden the whole block from the model
     * and had it propose the same session over and over. It is also what gives
     * the week builder variety for free: each day sees the ones before it.
     */
    const existing = definedSlotsOf(stored, current).map((other) => ({
      slot: other,
      name: labelFor(other),
      focus: stored[other]?.focus,
      intensity: (stored[other]?.intensity ?? 'heavy') as Intensity,
      exerciseIds: current.filter((row) => row.daySlot === other).map((row) => row.exerciseId),
    }));

    /*
     * What the app can answer for itself. An empty goal box is the normal
     * case: the shortfall in this week is something the lifter would otherwise
     * have to read off the Levels screen and retype.
     */
    const weekFrom = weekStart(todayIso());
    const weekSessions = await db.session
      .where('date')
      .between(weekFrom, shiftIso(weekFrom, 7), true, false)
      .toArray();
    const sessionIds = new Set(weekSessions.map((session) => session.id));
    const weekLogs = (await db.setLog.toArray()).filter((log) => sessionIds.has(log.sessionId));

    /*
     * A workout made here has no day yet, which is the whole design: placement
     * is a separate act on the calendar and the model never sees a date. The
     * golf rule needs a date to have anything to be clear of, so it applies
     * when the workout is assigned to one, not when it is made.
     *
     * The day editor used to be able to ask for a workout ON a date, and this
     * function grew a `forDate` for it — a placed template, the grip
     * prohibition, and a plan write. That door is closed (the same ask is on
     * the Program screen and in the New-workout sheet), so the branch went
     * with it rather than sitting here untaken and untested.
     */
    const constraints: DayConstraints = { maxRpe: training.maxRpe };
    /* Only when the lifter chose them. Left open, the model decides and the
       validator judges whatever it decided — which is the single-workout case. */
    if (want.focus) constraints.focus = want.focus;
    /* A default, not a requirement — see DayConstraints.effortDefault. The
       goal's own words decide, and what comes back is what gets stored. */
    if (want.intensity) constraints.effortDefault = want.intensity;
    /* Everything selected is not a constraint — it is the absence of one, and
       sending all eighteen ids would narrow nothing while telling the model to
       hit every muscle in one session. */
    if (want.muscles && want.muscles.length > 0 && want.muscles.length < MUSCLES.length) {
      constraints.muscles = want.muscles;
    }

    const instructions = await readAiInstructions();
    const short = undertrained(weekLogs, byId, share);
    const brief = buildBrief({ share, goal: want.goal, instructions, undertrained: short, existing, constraints });

    /*
     * The shape the day was ASKED for, which is what it is judged against. A
     * forced focus is a requirement — pick abs and chest, be handed chin-ups
     * was this line's whole reason — so the model agreeing to it is not
     * something to take on trust.
     *
     * Intensity is NOT forced, and used to be. The button set it, the model
     * was told it was absolute, and then this overwrote whatever came back
     * with the button's value anyway — so "easy session, shoulder is sore"
     * against a button reading Heavy produced a heavy workout labelled Heavy,
     * and the words never had a say. Now the words decide, the button is the
     * default they start from, and the template and the validator are both
     * built from what the model actually returned, so all three agree.
     */
    const requiredShape = (workout: AiWorkout): AiWorkout => ({
      ...workout,
      focus: want.focus ?? workout.focus,
    });

    /*
     * Only what this focus allows. The prompt already forbids the rest, so
     * sending it was four thousand tokens an ask of library the model was told
     * to ignore. With no chosen focus the model decides for itself and needs
     * the whole list.
     */
    const available = libraryForMuscles(
      libraryForFocuses(exercises, want.focus ? [want.focus] : []),
      constraints.muscles ?? [],
    );

    const outcome = await generateAiWorkout({
      blockId: block.id,
      slot,
      user: JSON.stringify(
        briefPayload(brief, { goal: want.goal, instructions, undertrained: short, existing, constraints }),
      ),
      exercises: available,
      validate: (workout: AiWorkout) => {
        const shaped = requiredShape(workout);
        const template = templateForAiWorkout(shaped, slot, sessionMinutes);
        return validateBlock(
          {
            days: [
              {
                slot,
                weekday: template.weekday,
                exercises: workout.exercises,
              },
            ],
          },
          {
            exercisesById: byId,
            /*
             * Empty: there is no date here to be clear of. Assigning the
             * workout to a day is what surfaces a conflict, and the day editor
             * and the week strip both say so when it does.
             */
            golfWeekdays: [],
            weeklySetTarget: training.weeklySetTarget,
            sessionBudgetMinutes: sessionMinutes,
            hasHistory: hasHistory ?? false,
            laddersFor: (exercise) => ladderFor(exercise, inventory),
            template: [template],
            nameFor: () => workout.name ?? `Day ${slot}`,
          },
        );
      },
    });

    /* Recorded whether it worked or not: a failed run costs money too, and a
       three-attempt failure is the most expensive thing this feature does. */
    await writeLastModelCall({
      at: new Date().toISOString(),
      attempts: outcome.attempts,
      ms: outcome.cost.ms,
      inputTokens: outcome.cost.inputTokens,
      outputTokens: outcome.cost.outputTokens,
      cacheReadTokens: outcome.cost.cacheReadTokens,
      cacheWriteTokens: outcome.cost.cacheWriteTokens,
    });

    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    const shaped = requiredShape(outcome.workout);
    const template = templateForAiWorkout(shaped, slot, sessionMinutes);
    await db.blockExercise.bulkPut(shaped.exercises);
    await writeSchedule(block.id, {
      ...stored,
      [slot]: {
        intensity: shaped.intensity,
        focus: shaped.focus,
        variant: 0,
        effortCue: template.effortCue,
        generated: true,
        // The model's name if it gave a usable one, otherwise derived from the
        // contents exactly as a hand-made workout is.
        name:
          shaped.name ??
          describeDay(
            shaped.exercises
              .map((entry) => byId.get(entry.exerciseId))
              .filter((exercise): exercise is Exercise => exercise !== undefined),
            shaped.intensity,
          ),
      },
    });

    return { ok: true, slot };
  };

  /** One workout, from the New-workout sheet. */
  const askForWorkout = async (
    goal: string,
    extra: { muscles?: MuscleId[]; intensity?: Intensity } = {},
  ) => {
    if (!block || asking) return;
    setAsking(true);
    setAskError(undefined);
    try {
      const outcome = await askOneWorkout({ goal, ...extra });
      if (!outcome.ok) {
        setAskError(outcome.reason);
        return;
      }
      setCreating(false);
      setEditingSlot(outcome.slot);
    } catch (cause) {
      setAskError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAsking(false);
    }
  };

  /**
   * A week: one workout per chosen day, each landing on its own date.
   *
   * Built one at a time on purpose. Each call reads the block back, so every
   * day sees what the days before it took and picks around them — that is
   * where the week's variety comes from, and asking for all of them in one
   * reply would hand back five sessions that had never seen each other.
   *
   * A failure stops the run and keeps what already succeeded. Those workouts
   * are each individually useful, and throwing away three good sessions
   * because the fourth failed would be the wrong trade.
   */
  /**
   * A week, in one request.
   *
   * It used to be one call per day, each seeing the ones before it. That cost
   * four prefills of the exercise library and four passes of thinking for a
   * four-day week — about fifty seconds. One call prefills once, thinks once,
   * and sees every day at the same time, which is better for variety than
   * seeing only the earlier ones.
   *
   * The model still never sees a date. It fills the numbered slots below, and
   * the mapping from number back to date never leaves this function.
   */
  const askForWeek = async (days: PlannedWeekDay[], note: string) => {
    if (!block || asking || days.length === 0) return;
    setAsking(true);
    setAskError(undefined);
    setBuilding({ done: 0, total: days.length });
    try {
      const current = await db.blockExercise.where('blockId').equals(block.id).toArray();
      const stored = (await readSchedules())[block.id] ?? {};
      const existing = definedSlotsOf(stored, current).map((other) => ({
        slot: other,
        name: labelFor(other),
        focus: stored[other]?.focus,
        intensity: (stored[other]?.intensity ?? 'heavy') as Intensity,
        exerciseIds: current.filter((row) => row.daySlot === other).map((row) => row.exerciseId),
      }));

      /* Enough ids for every day, taken before any writing so the whole week
         lands on slots that were free when it was asked for. */
      const free = DAY_SLOTS.filter((candidate) => !definedSlotsOf(stored, current).includes(candidate));
      if (free.length < days.length) {
        setAskError(
          `Only ${free.length} workout ${free.length === 1 ? 'slot' : 'slots'} left in this block, and you asked for ${days.length}.`,
        );
        return;
      }

      const golfWeekdays = training.golfWeekdays as never as Weekday[];
      /* Position in the request, 1-based. The only address the model gets. */
      const requests: WeekSlotRequest[] = days.map((day, index) => {
        /* Every slot carries the effort ceiling, because a slot's constraints
           bind only that slot — the prompt says so, so stating it once at the
           top would leave the other days unbound. */
        const constraints: string[] = [
          `Nothing harder than RPE ${training.maxRpe}.`,
        ];
        /*
         * Two reasons for the same two prohibitions, stated once each. The
         * calendar is the one that was missing on the spine: a heavy day the
         * day before a round needs the rule more than a flush session does,
         * and it was the only day that never got it.
         *
         * The light day's own version is said here as well because the light
         * template excludes both and the validator marks against it — leaving
         * either unsaid buys a rejected answer and a retry to communicate a
         * rule we already knew.
         */
        const light = day.intensity === 'light';
        const weekday = weekdayOf(day.date);
        if (light || !gripAllowed(weekday, golfWeekdays)) {
          constraints.push('Do not use any exercise with gripLoad "high".');
        }
        if (light || !spineAllowed(weekday, golfWeekdays)) {
          constraints.push('Do not use any exercise with spinalLoad "high".');
        }
        if (light) {
          constraints.push('This is a light session: two working sets an exercise, higher reps.');
        }
        return { slot: index + 1, focus: day.focus, intensity: day.intensity, constraints };
      });

      const weekFrom = weekStart(days[0]?.date ?? todayIso());
      const weekSessions = await db.session
        .where('date')
        .between(weekFrom, shiftIso(weekFrom, 7), true, false)
        .toArray();
      const sessionIds = new Set(weekSessions.map((session) => session.id));
      const weekLogs = (await db.setLog.toArray()).filter((log) => sessionIds.has(log.sessionId));
      const instructions = await readAiInstructions();
      const short = undertrained(weekLogs, byId, share);
      const constraints: DayConstraints = { maxRpe: training.maxRpe };
      const brief = buildBrief({
        share,
        goal: note,
        instructions,
        undertrained: short,
        existing,
        constraints,
      });

      const outcome = await generateAiWeek({
        slots: requests,
        exercises: libraryForFocuses(exercises, days.map((day) => day.focus)),
        // A week is several workouts in one reply, so the single-workout
        // ceiling would truncate it mid-JSON.
        maxTokens: 16000,
        user: JSON.stringify({
          ...briefPayload(brief, {
            goal: note,
            instructions,
            undertrained: short,
            existing,
            constraints,
          }),
          slots: requests,
        }),
        validate: (workout) => {
          const day = days[workout.slot - 1];
          if (!day) return [];
          const template = templateDayFor({
            slot: free[workout.slot - 1] as DaySlot,
            weekday: weekdayOf(day.date),
            intensity: workout.intensity,
            focus: workout.focus,
            minutesPerSession: sessionMinutes,
            golfWeekdays,
          });
          return validateBlock(
            {
              days: [
                {
                  slot: free[workout.slot - 1] as DaySlot,
                  weekday: weekdayOf(day.date),
                  exercises: workout.exercises.map((entry) => ({
                    ...entry,
                    blockId: block.id,
                    daySlot: free[workout.slot - 1] as DaySlot,
                  })),
                },
              ],
            },
            {
              exercisesById: byId,
              golfWeekdays: training.golfWeekdays as never,
              weeklySetTarget: training.weeklySetTarget,
              sessionBudgetMinutes: sessionMinutes,
              hasHistory: hasHistory ?? false,
              laddersFor: (exercise) => ladderFor(exercise, inventory),
              template: [template],
              nameFor: () => workout.name ?? `Slot ${workout.slot}`,
            },
          ).filter((violation) => severityOf(violation.code) === 'problem');
        },
      });

      await writeLastModelCall({
        at: new Date().toISOString(),
        attempts: outcome.attempts,
        ms: outcome.cost.ms,
        inputTokens: outcome.cost.inputTokens,
        outputTokens: outcome.cost.outputTokens,
        cacheReadTokens: outcome.cost.cacheReadTokens,
        cacheWriteTokens: outcome.cost.cacheWriteTokens,
      });

      if (!outcome.ok) {
        setAskError(outcome.reason);
        return;
      }

      /* Written together: a half-placed week is worse than none, and the whole
         reply is already in hand by the time we get here. */
      const schedule: BlockSchedule = { ...stored };
      const plans = (await readPlans())[block.id] ?? {};
      let plan = plans;
      for (const workout of outcome.workouts) {
        const slot = free[workout.slot - 1] as DaySlot;
        const day = days[workout.slot - 1];
        if (!day) continue;
        const template = templateDayFor({
          slot,
          weekday: weekdayOf(day.date),
          intensity: workout.intensity,
          focus: workout.focus,
          minutesPerSession: sessionMinutes,
          golfWeekdays,
        });
        await db.blockExercise.bulkPut(
          workout.exercises.map((entry) => ({ ...entry, blockId: block.id, daySlot: slot })),
        );
        schedule[slot] = {
          intensity: workout.intensity,
          focus: workout.focus,
          variant: 0,
          effortCue: template.effortCue,
          generated: true,
          name:
            workout.name ??
            describeDay(
              workout.exercises
                .map((entry) => byId.get(entry.exerciseId))
                .filter((exercise): exercise is Exercise => exercise !== undefined),
              workout.intensity,
            ),
        };
        plan = planDate(plan, schedule, weekDatesOf(day.date), slot, day.date);
        setBuilding({ done: workout.slot, total: days.length });
      }
      await writeSchedule(block.id, schedule);
      await writePlan(block.id, plan);

      if (outcome.shortfall.length > 0) {
        /* Some days landed and some did not. Saying so beats closing the sheet
           on a week that is quietly short a session. */
        const which = outcome.shortfall
          .map((slot) => days[slot - 1]?.date)
          .filter((date): date is string => date !== undefined)
          .map((date) => WEEKDAY_LABEL[weekdayOf(date)])
          .join(', ');
        setAskError(
          `Built ${outcome.workouts.length} of ${days.length}. ${which} did not pass the rules: ${outcome.reason ?? ''}`,
        );
        return;
      }

      setPlanningWeek(false);
    } catch (cause) {
      setAskError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAsking(false);
      setBuilding(undefined);
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

  /*
   * The rules, run against what is actually on the calendar rather than against
   * a proposal. The old preview was the only thing that ever validated, so a
   * day built or edited by hand was never checked at all.
   *
   * Judged over the WEEK ON SCREEN, by date. That is what keeps the golf rule
   * honest now that placement is per week: a session sitting on Thursday this
   * week is checked against Thursday, and a workout with no day is not checked
   * for placement at all because it has no placement to be wrong about.
   */
  const blockViolations = useMemo(() => {
    const placed = week
      .filter((day) => day.plannedSlot !== undefined)
      .map((day) => ({ slot: day.plannedSlot as DaySlot, date: day.date }));
    if (placed.length === 0 || (slots ?? []).length === 0) return [];
    const template = placed.map((entry) => templateFor(entry.slot));
    const context: ValidationContext = {
      exercisesById: byId,
      golfWeekdays: training.golfWeekdays as never,
      weeklySetTarget: training.weeklySetTarget,
      sessionBudgetMinutes: sessionMinutes,
      hasHistory: hasHistory ?? false,
      laddersFor: (exercise) => ladderFor(exercise, inventory),
      template,
      nameFor: labelFor,
    };
    return validateBlock(
      {
        days: placed.map((entry) => ({
          slot: entry.slot,
          weekday: weekdayOf(entry.date),
          exercises: entriesForSlot(slots ?? [], entry.slot),
        })),
      },
      context,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, schedule, slots, byId, training, sessionMinutes, hasHistory, inventory, shape]);

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

      <Card title={block ? 'Plan the week' : 'No block'} className="mt-3">
        {block ? (
          <>
            {/* This card was once the block's dates and a shortcut that made
                workouts AND placed them in one press. That shortcut wrote a
                standing weekday, so filling four days filled every week there
                would ever be, and it is long gone. What the card is FOR now is
                the week in front of you: what it trains, and the two ways to
                change that. The block's dates are the footnote they always
                deserved to be. */}
            <Label className="block">
              What this week trains — already logged, or still to come.
            </Label>

            <div className="mt-3">
              <Silhouette volume={plannedVolume} />
              <p className="mt-2 text-center text-[12px] font-medium text-text-dim">
                {untouched.length === MUSCLES.length
                  ? 'Nothing trained or planned on this week yet.'
                  : untouched.length === 0
                    ? 'This week covers every muscle.'
                    : `Not in this week: ${untouched.map((muscle) => muscle.name).join(', ')}.`}
              </p>
            </div>

            {/* Two ways in, and only two: describe a week and let the model
                build it, or make one workout at a time. Both leave the
                calendar to you except where you named the day yourself.
                They sit here, under the gap they are for, rather than under
                the whole list of workouts where you had to scroll to reach
                them. */}
            {isModelAvailable() && (
              <button
                type="button"
                onClick={() => {
                  setAskError(undefined);
                  setPlanningWeek(true);
                }}
                className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
              >
                Build the week with AI
              </button>
            )}

            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={freeSlot() === undefined}
              className="mt-2 h-11 w-full rounded-full bg-surface-2 text-sm font-medium text-text-dim disabled:text-text-faint"
            >
              {freeSlot() === undefined ? `All ${DAY_SLOTS.length} workouts used` : 'New workout'}
            </button>

            <Label className="mt-3 block text-center">
              Block: {longDate(block.startDate)} — {longDate(block.endDate)}
            </Label>
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
        /* Where it sits in the week on screen, not a standing weekday. A card
           claiming "Mon" for a workout that is on Wednesday this week is the
           same confusion the DatePlan layer exists to end. */
        const date = dateFor(slot);
        /* Trained in the week on screen. Matched by slot AND by name, because
           either can identify it: a renamed workout's old sessions keep the
           old name, and a deleted one's letter can belong to something new. */
        const doneThisWeek = (weekHistory?.sessions ?? []).some(
          (session) => session.slot === slot || session.name === labelFor(slot),
        );
        return (
          <DaySlotCard
            key={slot}
            label={labelFor(slot)}
            customName={scheduled?.name}
            onRename={(name) => void renameSlot(slot, name)}
            weekday={date !== undefined ? weekdayOf(date) : undefined}
            entries={list}
            exercisesById={byId}
            /* Why this day has no pulling in it, where the rule acted — or
               just that a round is close, where it only advises. */
            note={date === undefined ? undefined : gripBufferNote(date, golfDateList)?.text}
            noteSevere={
              date !== undefined &&
              gripBufferNote(date, golfDateList)?.severity === 'blocked'
            }
            /* Real minutes, not the model's: the same learned factor that
               sized the budget this day was built to. */
            minutes={list.length > 0 ? realMinutes(estimateMinutes(list, byId), timeFactor) : undefined}
            editing={isEditing}
            isToday={date === todayIso()}
            doneThisWeek={doneThisWeek}
            timesDone={timesDoneBySlot?.(slot, labelFor(slot)) ?? 0}
            intensity={scheduled?.intensity ?? 'heavy'}
            onToggleEdit={() => setEditingSlot(isEditing ? null : slot)}
            onStart={() => onStartDay(slot)}
            onAdd={() => setAddingTo(slot)}
            onRemove={(exerciseId) => {
              if (block) void removeBlockExercise(block.id, slot, exerciseId);
            }}
            onInfo={setDetailId}
            onReorder={(orderedIds) => {
              if (block) void reorderBlockExercises(block.id, slot, orderedIds);
            }}
            onUpdate={(entry, patch) => void updateBlockExercise(entry, patch)}
            /* Only reachable on an empty workout now, so it cannot overwrite
               anything and takes variant 0 — the strongest draw. */
            onGenerate={() => void generateSlot(slot, 0)}
            /*
             * Asked only where there is something to lose. A workout you built
             * five minutes ago and never placed or trained is a mistake to
             * undo, and a confirm box on it is a keystroke tax on tidying up —
             * so the prompt appears when it is on the calendar or has sessions
             * behind it, and says which of the two.
             */
            onClearDay={() => {
              if (!block) return;
              const times = timesDoneBySlot?.(slot, labelFor(slot)) ?? 0;
              const reasons = [
                date !== undefined
                  ? `it is on ${WEEKDAY_LABEL[weekdayOf(date)]} this week`
                  : undefined,
                times > 0
                  ? `you have done it ${times} ${times === 1 ? 'time' : 'times'}`
                  : undefined,
              ].filter((reason): reason is string => reason !== undefined);

              if (reasons.length > 0) {
                const kept =
                  times > 0
                    ? ' The sessions you logged stay in History — this deletes the workout, not what you did.'
                    : '';
                if (
                  !window.confirm(
                    `Delete "${labelFor(slot)}"? ${reasons.join(' and ')}.${kept}`,
                  )
                ) {
                  return;
                }
              }
              void clearDaySlot(block.id, slot);
              setEditingSlot(null);
            }}
          />
        );
      })}


      {planningWeek && (
        <WeekPlanSheet
          days={weekPlanDays}
          asking={asking}
          progress={building ? `${building.done + 1} of ${building.total}` : undefined}
          error={askError}
          onBuild={(chosen: PlannedWeekDay[], note: string) => void askForWeek(chosen, note)}
          onClose={() => {
            setPlanningWeek(false);
            setAskError(undefined);
          }}
        />
      )}

      {creating && (
        <NewWorkoutSheet
          /* The body picker and the effort rows sit above the goal box and
             feed both ways of building. Sending only the typed words was the
             bug: pick abs and chest, type a line, and the model — which had
             never been told about the picker — came back with chin-ups. */
          onAsk={(goal, muscles, intensity) =>
            void askForWorkout(goal, { muscles, intensity })
          }
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
          // Tapping a ticked row takes it back out, which is what the tick
          // looked like it promised.
          onUnpick={(exerciseId) => void removeBlockExercise(block.id, addingTo, exerciseId)}
          onClose={() => setAddingTo(null)}
          onInfo={setDetailId}
        />
      )}

      {detailId && byId.get(detailId) && (
        <ExerciseDetail
          exercise={byId.get(detailId) as Exercise}
          onClose={() => setDetailId(undefined)}
        />
      )}

      {editingDate && (
        <DayEditor
          date={editingDate}
          golfDates={golfDateList}
          slots={editorSlots}
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

    </Screen>
  );
}
