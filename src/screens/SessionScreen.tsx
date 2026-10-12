import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import type { BlockExercise, DaySlot, Exercise, SetLog } from '../db/types';
import { CABLE_STACK_KG, STATION_LABEL } from '../db/seed/exercises';
import { DEFAULT_BLOCK_ID } from '../db/seed';
import { tap } from '../lib/haptics';
import { HapticTick } from '../components/HapticTick';
import {
  draftFromPlan,
  emptyDraft,
  entriesForSlot,
  readBlockPlan,
  slotForDate,
  type BlockPlan,
} from '../lib/program';
import {
  clearActiveSession,
  readActiveSession,
  readExerciseNotes,
  readInventory,
  writeActiveSession,
} from '../db/settings';
import { hasLoadTranslation } from '../lib/load';
import { DEFAULT_INVENTORY, barWeightFor, ladderFor, type Inventory } from '../lib/loadable';
import { sessionWarnings, type RuleWarning } from '../lib/golf';
import { offerFor, readForecastInput } from '../lib/rotation';
import {
  DEFAULT_REP_RANGE,
  OUTCOME_LABEL,
  suggestProgression,
  type HistorySet,
  type Progression,
} from '../lib/progression';
import { clock, kg, todayIso } from '../lib/format';
import {
  countLoggedSets,
  deleteSession,
  emptySet,
  isLoggable,
  loadDraft,
  saveSession,
  type DraftSet,
  type SessionDraft,
} from '../lib/sessions';
import { Card, Screen } from '../components/Layout';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { ExerciseStrip } from '../components/ExerciseStrip';
import { EffortPicker } from '../components/EffortPicker';
import { NumberPad, type PadTarget } from '../components/NumberPad';
import { RestBar, RestChips } from '../components/RestTimer';
import { restChoices, useRestTimer } from '../lib/restTimer';
import { SetRow, type CellField, type Ghost } from '../components/SetRow';
import { MiniMap } from '../components/PlanLevels';
import { FinishSheet } from '../components/FinishSheet';
import { dayLabel } from '../lib/dayLabel';
import { isTimed, rangeLabel, repUnitWord, stepFor } from '../lib/repUnit';


function outcomeColor(outcome: Progression['outcome']): string {
  switch (outcome) {
    case 'increase':
      return 'var(--color-strength)';
    case 'hold_review':
      return 'var(--color-warn)';
    case 'ceiling':
      return 'var(--color-volume)';
    default:
      return 'var(--color-text-dim)';
  }
}

/**
 * Fallback nudge for exercises with no ladder. With an inventory loaded the
 * keypad steps rung to rung instead and never uses this.
 */
const FALLBACK_STEP = 1;

interface ActiveCell {
  exerciseId: string;
  setIndex: number;
  field: CellField;
}

export function SessionScreen({
  sessionId,
  daySlot,
  freestyle = false,
  exercises,
  onExit,
}: {
  sessionId?: string;
  /** Start this day of the block. Omitted means "work out today's slot". */
  daySlot?: DaySlot;
  /** Skip the programmed day entirely and open the picker. */
  freestyle?: boolean;
  exercises: Exercise[];
  onExit: () => void;
}) {
  const exercisesById = useMemo(
    () => new Map(exercises.map((e) => [e.id, e])),
    [exercises],
  );

  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [detailId, setDetailId] = useState<string | undefined>(undefined);
  const [cell, setCell] = useState<ActiveCell | null>(null);
  /*
   * What is actually IN the database for this session, or undefined when
   * nothing is. Save is offered when the draft differs from it — a button
   * that is always there is not a prompt, it is furniture.
   *
   * Undefined for a session that has never been saved, which includes a
   * resumed one. Setting it from the resumed draft made a workout with four
   * logged sets look already-saved, so Save stayed hidden until something was
   * edited: the sets were on disk but there was no way to file them.
   */
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [effortCell, setEffortCell] = useState<ActiveCell | null>(null);
  /* Set from the stored session when one is resumed, so a workout that began
     forty minutes ago is not recorded as five minutes long. */
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [history, setHistory] = useState<Record<string, SetLog[]>>({});
  const [allHistory, setAllHistory] = useState<Record<string, HistorySet[]>>({});
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);
  const [exerciseNotes, setExerciseNotes] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<BlockPlan | undefined>(undefined);
  const [golfDates, setGolfDates] = useState<{ date: string }[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** The exercise whose rule notes are open; a dot stands in for them otherwise. */
  const [notesFor, setNotesFor] = useState<string | undefined>(undefined);
  const [targets, setTargets] = useState<Record<string, BlockExercise>>({});
  const [saving, setSaving] = useState(false);
  /** The rest chips, open from the "rest 3:00" on the exercise. */
  const [restOpen, setRestOpen] = useState(false);
  /** Date, minutes, notes and the destructive buttons, behind Finish. */
  const [finishOpen, setFinishOpen] = useState(false);
  /* The clock in the corner, for a live session: how long you have been at it. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sessionId) return;
    const handle = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(handle);
  }, [sessionId]);
  /* The rest comes from the exercise being logged: 30 seconds for a band walk,
     180 for a heavy deadlift. The timer counted 120 for all of it. */
  const timer = useRestTimer(
    activeId ? exercisesById.get(activeId)?.restSeconds : undefined,
  );

  /* --- load or create the draft ----------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    void readInventory().then((next) => {
      if (!cancelled) setInventory(next);
    });
    /* The lifter's own per-exercise cues, shown beside the seeded labels. */
    void readExerciseNotes().then((next) => {
      if (!cancelled) setExerciseNotes(next);
    });
    void db.golfDay.toArray().then((rows) => {
      if (!cancelled) setGolfDates(rows.map((row) => ({ date: row.date })));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sessionId) {
        const existing = await loadDraft(sessionId);
        if (cancelled) return;
        if (existing) {
          setDraft(existing);
          // This one IS in the database, so it starts clean.
          setSaved(JSON.stringify(existing));
          setActiveId(existing.exercises[0]?.exerciseId);
          return;
        }
      }
      /*
       * An unfinished workout wins over everything. Leaving this screen used to
       * throw the session away, so the only safe moves were finish it or lose
       * it; a stored draft is what makes stepping out to check the Levels
       * screen mid-set a normal thing to do.
       */
      if (!sessionId && !freestyle) {
        const active = await readActiveSession();
        if (cancelled) return;
        const resumed = active?.draft as SessionDraft | undefined;
        if (resumed?.id && Array.isArray(resumed.exercises)) {
          setPlan(await readBlockPlan());
          if (cancelled) return;
          setStartedAt(active?.startedAt ?? Date.now());
          setDraft(resumed);
          setActiveId(resumed.exercises[0]?.exerciseId);
          return;
        }
      }

      /*
       * A new session starts from the block, not from an empty picker. The
       * requested slot wins; otherwise it is whichever slot the builder put on
       * today's weekday. Only when there is nothing programmed to run does the
       * picker open, which is the freeform path Phase 1 shipped with.
       */
      const date = todayIso();
      const blockPlan = await readBlockPlan();
      if (cancelled) return;

      setPlan(blockPlan);

      // Freestyle is a decision, not an absence: it must not quietly load
      // today's programmed session just because one exists.
      /* Under a plan today's workout is the next in order (golf eve aside);
         without one it is whatever the weekday pattern says. */
      const forecast = blockPlan && !daySlot && !freestyle ? await readForecastInput(blockPlan.block.id, exercisesById) : undefined;
      if (cancelled) return;
      const slot = freestyle
        ? undefined
        : (daySlot ??
          (forecast
            ? offerFor(date, forecast).first
            : blockPlan
              ? slotForDate(blockPlan.schedule, date, blockPlan.dates, blockPlan.block)
              : undefined));
      const programmed =
        blockPlan && slot ? entriesForSlot(blockPlan.entries, slot).length > 0 : false;

      if (blockPlan && slot && programmed) {
        const next = draftFromPlan({ plan: blockPlan, slot, exercisesById, date });
        setDraft(next);
        setActiveId(next.exercises[0]?.exerciseId);
        return;
      }

      const blank = emptyDraft(blockPlan?.block.id ?? DEFAULT_BLOCK_ID, slot ?? 'A', date);
      setDraft(blank);
      setPicking(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, daySlot, freestyle, exercisesById]);

  /* --- previous-session reference for the target column ------------------ */
  /* Keyed on primitives only: this must not re-query on every keystroke. */
  const draftId = draft?.id;
  const draftBlockId = draft?.blockId;
  const exerciseIdsInDraft = draft?.exercises.map((e) => e.exerciseId).join(',') ?? '';
  useEffect(() => {
    if (!draftId || !draftBlockId) return;
    let cancelled = false;
    (async () => {
      const ids = exerciseIdsInDraft ? exerciseIdsInDraft.split(',') : [];
      const nextHistory: Record<string, SetLog[]> = {};
      const nextAll: Record<string, HistorySet[]> = {};
      for (const id of ids) {
        const logs = await db.setLog.where('exerciseId').equals(id).toArray();
        const others = logs.filter((l) => l.sessionId !== draftId);
        if (others.length === 0) continue;
        // Most recent prior session for this exercise, by session date.
        const sessions = await db.session.bulkGet([...new Set(others.map((l) => l.sessionId))]);
        const dateById = new Map(
          sessions.filter((s) => s !== undefined).map((s) => [s.id, s.date]),
        );
        // Cross-block history, which is exactly what SetLog.exerciseId buys us.
        nextAll[id] = others.map((l) => ({
          sessionId: l.sessionId,
          date: dateById.get(l.sessionId) ?? '',
          weightKg: l.weightKg,
          reps: l.reps,
          rir: l.rir,
          rpe: l.rpe,
        }));
        const latest = others
          .slice()
          .sort((a, b) =>
            (dateById.get(b.sessionId) ?? '').localeCompare(dateById.get(a.sessionId) ?? ''),
          )[0];
        if (!latest) continue;
        nextHistory[id] = others
          .filter((l) => l.sessionId === latest.sessionId)
          .sort((a, b) => a.setNo - b.setNo);
      }

      const blockTargets = await db.blockExercise.where('blockId').equals(draftBlockId).toArray();
      if (cancelled) return;
      setHistory(nextHistory);
      setAllHistory(nextAll);
      setTargets(Object.fromEntries(blockTargets.map((t) => [t.exerciseId, t])));
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, draftBlockId, exerciseIdsInDraft]);

  /* Keep the row being edited above the keypad, which covers the lower half. */
  useEffect(() => {
    if (!cell) return;
    document
      .querySelector(`[data-set-row="${cell.exerciseId}:${cell.setIndex}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cell?.exerciseId, cell?.setIndex, cell]);

  const activeExercise = activeId ? exercisesById.get(activeId) : undefined;
  const activeDraftExercise = draft?.exercises.find((e) => e.exerciseId === activeId);

  const patchSet = useCallback(
    (exerciseId: string, setIndex: number, patch: Partial<DraftSet>) => {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              exercises: prev.exercises.map((e) =>
                e.exerciseId === exerciseId
                  ? {
                      ...e,
                      sets: e.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s)),
                    }
                  : e,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const addExercise = (exerciseId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.exercises.some((e) => e.exerciseId === exerciseId)) return prev;
      const target = targets[exerciseId];
      const setCount = target?.targetSets ?? 3;
      return {
        ...prev,
        exercises: [
          ...prev.exercises,
          {
            exerciseId,
            sets: Array.from({ length: setCount }, (_, i) => emptySet(i + 1)),
          },
        ],
      };
    });
    setActiveId(exerciseId);
    setPicking(false);
  };


  /**
   * Takes an exercise out of the session — from the Remove button, or by
   * tapping it again in the picker.
   *
   * Guarded, because a picked exercise here is not just an intention: it may
   * already hold sets you have done, and until now both routes binned them
   * without a word.
   */
  const removeExercise = (exerciseId: string) => {
    const logged =
      draft?.exercises
        .find((entry) => entry.exerciseId === exerciseId)
        ?.sets.filter((set) => set.done).length ?? 0;
    if (logged > 0) {
      const name = exercisesById.get(exerciseId)?.name ?? exerciseId;
      const sets = logged === 1 ? `1 logged set` : `${logged} logged sets`;
      if (!window.confirm(`Remove ${name}? It has ${sets}, and they go with it.`)) return;
    }
    setDraft((prev) =>
      prev ? { ...prev, exercises: prev.exercises.filter((e) => e.exerciseId !== exerciseId) } : prev,
    );
    setActiveId((prev) => {
      if (prev !== exerciseId) return prev;
      return draft?.exercises.find((e) => e.exerciseId !== exerciseId)?.exerciseId;
    });
    setCell(null);
  };

  const addSet = (exerciseId: string) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((e) => {
              if (e.exerciseId !== exerciseId) return e;
              const last = e.sets.at(-1);
              return {
                ...e,
                sets: [
                  ...e.sets,
                  // Carry the last set's load forward; that is what actually happens.
                  {
                    ...emptySet(e.sets.length + 1),
                    weightKg: last?.weightKg,
                  },
                ],
              };
            }),
          }
        : prev,
    );
  };

  const removeSet = (exerciseId: string, setIndex: number) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((e) =>
              e.exerciseId === exerciseId
                ? {
                    ...e,
                    sets: e.sets
                      .filter((_, i) => i !== setIndex)
                      .map((s, i) => ({ ...s, setNo: i + 1 })),
                  }
                : e,
            ),
          }
        : prev,
    );
    setCell(null);
  };

  /** Fills every not-yet-logged set with the suggested load. */
  const applySuggestion = (exerciseId: string, next: Progression) => {
    if (next.suggestedKg === undefined) return;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((e) =>
              e.exerciseId === exerciseId
                ? {
                    ...e,
                    sets: e.sets.map((set) =>
                      isLoggable(set) ? set : { ...set, weightKg: next.suggestedKg },
                    ),
                  }
                : e,
            ),
          }
        : prev,
    );
  };

  /** Replaces the draft's exercises with the programmed ones for a slot. */
  const loadSlot = (slot: DaySlot) => {
    if (!plan || !draft) return;
    const next = draftFromPlan({ plan, slot, exercisesById, date: draft.date });
    setDraft({ ...draft, daySlot: slot, exercises: next.exercises });
    setActiveId(next.exercises[0]?.exerciseId);
    setPicking(false);
  };

  const programmedForSlot = plan
    ? entriesForSlot(plan.entries, (draft?.daySlot as DaySlot) ?? 'A')
    : [];

  /**
   * The tick. A set with nothing typed in it logs what the row was showing
   * in faint type — last time plus the step — so a set that went to plan is
   * one tap. Only a set with reps against it starts the rest.
   */
  const toggleDone = (exerciseId: string, setIndex: number, set: DraftSet, ghost?: Ghost) => {
    const nextDone = !set.done;
    const fill: Partial<DraftSet> = {};
    if (nextDone && set.reps === undefined && ghost?.reps !== undefined) fill.reps = ghost.reps;
    if (nextDone && set.weightKg === undefined && ghost?.weightKg !== undefined) {
      fill.weightKg = ghost.weightKg;
    }
    patchSet(exerciseId, setIndex, { ...fill, done: nextDone });
    if (nextDone && isLoggable({ ...set, ...fill })) timer.start();
  };

  /* --- keypad plumbing --------------------------------------------------- */

  const padTarget: PadTarget | undefined = useMemo(() => {
    if (!cell || !draft) return undefined;
    const exercise = exercisesById.get(cell.exerciseId);
    const set = draft.exercises.find((e) => e.exerciseId === cell.exerciseId)?.sets[cell.setIndex];
    if (!exercise || !set) return undefined;
    return {
      label: `${exercise.name} · set ${set.setNo} · ${cell.field === 'weight' ? 'weight' : repUnitWord(exercise)}`,
      kind: cell.field,
      unit: cell.field === 'weight' ? 'kg' : isTimed(exercise) ? 's' : 'reps',
      value: cell.field === 'weight' ? set.weightKg : set.reps,
      step: cell.field === 'weight' ? FALLBACK_STEP : stepFor(exercise),
      ladder: cell.field === 'weight' ? ladderFor(exercise, inventory) : undefined,
    };
  }, [cell, draft, exercisesById, inventory]);

  const padHint = useMemo(() => {
    if (!cell || cell.field !== 'weight' || !draft) return undefined;
    const exercise = exercisesById.get(cell.exerciseId);
    if (!exercise || !hasLoadTranslation(exercise)) return undefined;
    const set = draft.exercises.find((e) => e.exerciseId === cell.exerciseId)?.sets[cell.setIndex];
    const stack = set?.weightKg;
    const eff = stack === undefined ? undefined : Math.round(stack * exercise.loadMultiplier * 100) / 100;
    return `Stack selection. ×${exercise.loadMultiplier.toFixed(2)}${
      eff === undefined ? '' : ` = ${kg(eff)} kg effective`
    }`;
  }, [cell, draft, exercisesById]);

  const advanceCell = () => {
    if (!cell || !draft) return;
    const de = draft.exercises.find((e) => e.exerciseId === cell.exerciseId);
    if (!de) return;
    if (cell.field === 'weight') {
      setCell({ ...cell, field: 'reps' });
      return;
    }
    const next = cell.setIndex + 1;
    if (next < de.sets.length) {
      const exercise = exercisesById.get(cell.exerciseId);
      setCell({
        ...cell,
        setIndex: next,
        field:
          exercise && (exercise.loadMode === 'weight' || exercise.loadMode === 'band')
            ? 'weight'
            : 'reps',
      });
    } else {
      setCell(null);
    }
  };

  /* --- save -------------------------------------------------------------- */

  /** What a slot is called, from the block the session belongs to. */
  const labelFor = useCallback(
    (slot: DaySlot): string =>
      dayLabel({
        slot,
        name: plan?.schedule[slot]?.name,
        exercises: plan
          ? entriesForSlot(plan.entries, slot)
              .map((entry) => exercisesById.get(entry.exerciseId))
              .filter((exercise): exercise is Exercise => exercise !== undefined)
          : undefined,
        intensity: plan?.schedule[slot]?.intensity,
      }),
    [plan, exercisesById],
  );

  /* The workout this session belongs to, if it belongs to one at all. */
  const programmedName = useMemo(() => {
    const slot = draft?.daySlot as DaySlot | undefined;
    if (!slot || !plan) return undefined;
    const exists =
      plan.schedule[slot] !== undefined || entriesForSlot(plan.entries, slot).length > 0;
    return exists ? labelFor(slot) : undefined;
  }, [draft?.daySlot, plan, labelFor]);

  const loggedSets = draft ? countLoggedSets(draft) : 0;
  /* Unsaved work is a comparison, not a hunch. */
  const dirty = draft !== null && JSON.stringify(draft) !== saved;

  /*
   * The draft, on disk, a beat after every change.
   *
   * Debounced because the keypad writes through on every keystroke and a Dexie
   * put per digit is a lot of writes for no benefit. A second is short enough
   * that nothing real is lost to a crash, and long enough that typing 12.5 is
   * one write rather than four.
   *
   * Live sessions only: one opened from History is already saved, and treating
   * it as in progress would offer to resume a workout from March.
   */
  const draftJson = draft ? JSON.stringify(draft) : undefined;
  useEffect(() => {
    if (sessionId || !draftJson) return;
    const handle = setTimeout(() => {
      void writeActiveSession({
        draft: JSON.parse(draftJson) as SessionDraft,
        startedAt,
        label: programmedName,
      });
    }, 1000);
    return () => clearTimeout(handle);
  }, [draftJson, sessionId, startedAt, programmedName]);

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const elapsedMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      await saveSession(
        {
          ...draft,
          // Keep an edited session's recorded duration; time a live one.
          durationMin: draft.durationMin ?? (sessionId ? undefined : elapsedMin),
          /* Stamped ONCE, at the save that ends a live session, then kept:
             the slot gets reused every block, so stamping again on a later
             edit would caption an old session with today's workout — the
             exact drift the stamp exists to prevent. */
          daySlotName: draft.daySlotName ?? (sessionId ? undefined : labelFor(draft.daySlot as DaySlot)),
        },
        exercisesById,
      );
      setSaved(JSON.stringify(draft));
      // Saved, so it is no longer in progress. Leaving this behind would offer
      // to resume a workout that is already in History.
      await clearActiveSession();
      onExit();
    } finally {
      setSaving(false);
    }
  };

  /**
   * Throws the session away. The only thing that does — Close now leaves it
   * running, which is the whole point of persisting it.
   */
  const handleDiscard = async () => {
    if (loggedSets > 0 && !window.confirm('Throw this workout away? The sets you logged go too.')) {
      return;
    }
    await clearActiveSession();
    onExit();
  };

  const handleDelete = async () => {
    if (!draft) return;
    if (!window.confirm('Delete this session and all of its sets?')) return;
    await deleteSession(draft.id);
    onExit();
  };

  if (!draft) {
    return (
      <Screen title="Workout">
        <p className="text-text-dim">--</p>
      </Screen>
    );
  }

  const stripExercises = draft.exercises
    .map((e) => exercisesById.get(e.exerciseId))
    .filter((e): e is Exercise => Boolean(e));

  const progress = Object.fromEntries(
    draft.exercises.map((e) => [
      e.exerciseId,
      { logged: e.sets.filter((set) => set.done && isLoggable(set)).length, total: e.sets.length },
    ]),
  );

  /* The golf rule and the hinge-fatigue note, spec Phase 3. Computed over the
     whole draft in performance order, not just the active exercise. */
  const warnings: RuleWarning[] = sessionWarnings(
    {
      date: draft.date,
      exercises: draft.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        loggedSets: e.sets.filter(isLoggable).length,
      })),
    },
    exercisesById,
    golfDates,
  ).filter((w) => !dismissed.includes(`${w.exerciseId}:${w.title}`));

  /* Only the exercise in hand. The rest are true but not yet useful, and the
     one you are on is the one you can act on. */
  const activeWarnings = warnings.filter((warning) => warning.exerciseId === activeId);

  /* A light day carries its own instruction, set by the template. */
  const effortCue = plan?.schedule[draft.daySlot as DaySlot]?.effortCue;

  const previous = activeId ? history[activeId] : undefined;
  const target = activeId ? targets[activeId] : undefined;
  const repLow = target?.repRangeLow ?? DEFAULT_REP_RANGE.low;
  const repHigh = target?.repRangeHigh ?? DEFAULT_REP_RANGE.high;
  const suggestion: Progression | undefined =
    activeExercise && (allHistory[activeExercise.id]?.length ?? 0) > 0
      ? suggestProgression({
          ladder: ladderFor(activeExercise, inventory),
          history: allHistory[activeExercise.id] ?? [],
          repRangeLow: repLow,
          repRangeHigh: repHigh,
          // So a plank's advice talks about seconds, not reps it does not have.
          timed: isTimed(activeExercise),
          // And a band's advice names the next band, never microplates.
          band: activeExercise.loadMode === 'band',
        })
      : undefined;

  /*
   * What a bare tick logs for each set: the suggested weight if there is
   * one, else last time's for that set, else the set above; last time's reps
   * for that set, else the top of the range. Shown faint in the row.
   */
  const ghostFor = (setIndex: number): Ghost | undefined => {
    if (!activeExercise || !activeDraftExercise) return undefined;
    const weightless = activeExercise.loadMode === 'bodyweight' || activeExercise.loadMode === 'rpe_only';
    const prior = previous?.find((p) => p.setNo === setIndex + 1);
    const above = activeDraftExercise.sets
      .slice(0, setIndex)
      .reverse()
      .find((set) => set.weightKg !== undefined);
    const weightKg = weightless
      ? undefined
      : (suggestion?.suggestedKg ?? above?.weightKg ?? prior?.weightKg);
    const reps = prior?.reps ?? (target ? repHigh : undefined);
    return weightKg === undefined && reps === undefined ? undefined : { weightKg, reps };
  };

  /* "Last time 50 kg × 10, 10, 9": the whole previous session in a line. */
  const lastTime = (() => {
    if (!activeExercise || !previous || previous.length === 0) return undefined;
    const unit = isTimed(activeExercise) ? 's' : '';
    const weights = new Set(previous.map((p) => p.weightKg));
    const reps = previous.map((p) => `${p.reps ?? '--'}${unit}`).join(', ');
    if (weights.size === 1 && previous[0]?.weightKg !== undefined) {
      return `Last time ${kg(previous[0].weightKg)} kg × ${reps}`;
    }
    if (weights.size === 1) return `Last time ${reps}`;
    return `Last time ${previous.map((p) => `${p.weightKg === undefined ? '' : `${kg(p.weightKg)}×`}${p.reps ?? '--'}`).join(', ')}`;
  })();

  const activeIndex = draft.exercises.findIndex((e) => e.exerciseId === activeId);
  const nextExercise =
    activeIndex >= 0 ? exercisesById.get(draft.exercises[activeIndex + 1]?.exerciseId ?? '') : undefined;
  const activeDone =
    activeDraftExercise !== undefined &&
    activeDraftExercise.sets.length > 0 &&
    activeDraftExercise.sets.every((set) => set.done);
  const currentSetIndex = activeDraftExercise?.sets.findIndex((set) => !set.done) ?? -1;
  const elapsedMin = Math.max(0, Math.floor((now - startedAt) / 60000));
  const restCaption = activeExercise
    ? currentSetIndex >= 0
      ? `rest · set ${currentSetIndex + 1} next`
      : nextExercise
        ? `rest · ${nextExercise.name} next`
        : 'rest'
    : 'rest';

  return (
    <>
      <Screen
        title={programmedName ?? 'Workout'}
        compactTitle
        pad={cell ? 'keypad' : timer.running ? 'cta' : 'none'}
        trailing={
          <span className="flex items-center gap-2 pb-1">
            {!sessionId && (
              <span className="text-[13px] font-semibold whitespace-nowrap text-text-dim tabular-nums">
                {elapsedMin} min
              </span>
            )}
            {(sessionId || loggedSets > 0) && (
              <button
                type="button"
                onClick={() => {
                  tap();
                  setFinishOpen(true);
                }}
                className="relative rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-bold"
              >
                {sessionId ? 'Details' : 'Finish'}
                <HapticTick />
              </button>
            )}
            {/* No warning any more: the draft is on disk, so leaving costs
                nothing and asking would be theatre. Discard is the button that
                destroys work, and it lives behind Finish. */}
            <button
              type="button"
              onClick={onExit}
              className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-dim"
            >
              {sessionId ? 'Close' : 'Later'}
            </button>
          </span>
        }
        header={
          <>
            {effortCue && (
              <div className="mt-3 rounded-2xl bg-surface px-4 py-2.5">
                <span className="label">This session</span>
                <p className="mt-0.5 text-[14px] font-medium">{effortCue}</p>
              </div>
            )}
            <ExerciseStrip
              exercises={stripExercises}
              activeId={activeId}
              progress={progress}
              onSelect={(id) => {
                setActiveId(id);
                setRestOpen(false);
              }}
              onAdd={() => setPicking(true)}
            />
          </>
        }
      >
        {!activeExercise || !activeDraftExercise ? (
          <Card title="No exercises yet">
            <p className="text-text-dim">--- sets</p>
            {programmedForSlot.length > 0 && (
              <button
                type="button"
                onClick={() => loadSlot(draft.daySlot as DaySlot)}
                className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg"
              >
                Load {labelFor(draft.daySlot as DaySlot)} · {programmedForSlot.length} exercises
              </button>
            )}
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="mt-3 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium"
            >
              Add an exercise
            </button>
          </Card>
        ) : (
          <Card>
            {/* The head: name, prescription, last time, and the body. */}
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-[24px] leading-[1.05] font-extrabold tracking-tight">
                    {activeExercise.name}
                  </h2>
                  <span className="flex shrink-0 items-center gap-2.5 pt-1">
                    {activeWarnings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          tap();
                          setNotesFor((prev) => (prev === activeExercise.id ? undefined : activeExercise.id));
                        }}
                        aria-label={`${activeWarnings.length} note${
                          activeWarnings.length === 1 ? '' : 's'
                        } about ${activeExercise.name}`}
                        aria-expanded={notesFor === activeExercise.id}
                        className="relative flex size-6 items-center justify-center"
                      >
                        <HapticTick radius={12} />
                        <span
                          className="size-2.5 rounded-full"
                          style={{
                            background: activeWarnings.some((w) => w.level === 'warn')
                              ? 'var(--color-danger)'
                              : 'var(--color-warn)',
                          }}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailId(activeExercise.id)}
                      aria-label={`About ${activeExercise.name}`}
                      className="text-text-dim"
                    >
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M12 11v5.5M12 7.6v.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExercise(activeExercise.id)}
                      className="text-[12px] font-medium text-text-dim"
                    >
                      Remove
                    </button>
                  </span>
                </div>
                {/* The prescription, in one line: sets × reps, the station,
                    the bar, and the rest, which opens the chips. */}
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13.5px] font-semibold text-text-dim">
                  <span className="text-text">
                    {target
                      ? `${activeDraftExercise.sets.length} × ${rangeLabel(activeExercise, target.repRangeLow, target.repRangeHigh)}`
                      : `${activeDraftExercise.sets.length} set${activeDraftExercise.sets.length === 1 ? '' : 's'}`}
                  </span>
                  <span>· {STATION_LABEL[activeExercise.station].toLowerCase()}</span>
                  {barWeightFor(activeExercise, inventory) !== undefined && (
                    <span>· bar {barWeightFor(activeExercise, inventory)} kg</span>
                  )}
                  {hasLoadTranslation(activeExercise) && (
                    <span className="text-strength">· ×{activeExercise.loadMultiplier.toFixed(2)} of {CABLE_STACK_KG} kg stack</span>
                  )}
                  {activeExercise.loadMode === 'band' && <span>· kg is the band's rating</span>}
                  {activeExercise.isHinge && <span>· hinge, do it fresh</span>}
                  <button
                    type="button"
                    onClick={() => {
                      tap();
                      setRestOpen((open) => !open);
                    }}
                    aria-expanded={restOpen}
                    aria-label={`Rest ${clock(timer.durationSec)}, tap to change`}
                    className="relative whitespace-nowrap"
                  >
                    · rest <span className="tabular-nums">{clock(timer.durationSec)}</span>
                    <HapticTick radius={8} />
                  </button>
                </p>
                {lastTime && (
                  <p className="mt-0.5 text-[12.5px] font-medium text-text-dim tabular-nums">{lastTime}</p>
                )}
              </div>
              <MiniMap
                entries={[{ exerciseId: activeExercise.id, targetSets: activeDraftExercise.sets.length }]}
                exercisesById={exercisesById}
              />
            </div>

            {restOpen && (
              <div className="mt-3">
                <RestChips
                  timer={timer}
                  /* The exercise's own rest, first among the chips: the timer
                     counted 120 for everything, so a band walk and a heavy
                     triple got the same two minutes. */
                  presets={restChoices(activeExercise.restSeconds)}
                  onPresetChange={timer.setDuration}
                />
              </div>
            )}

            {/* Behind a dot by the name: the sentence shows on a tap, so the
                screen stays the work and the note stays one tap away. */}
            {notesFor === activeId && activeWarnings.map((warning) => (
              <button
                key={`${warning.exerciseId}:${warning.title}`}
                type="button"
                onClick={() =>
                  setDismissed((prev) => [...prev, `${warning.exerciseId}:${warning.title}`])
                }
                className="mt-3 w-full rounded-xl px-3.5 py-2.5 text-left"
                style={
                  // The danger pair is themed: a dark red fill with white text
                  // in dark, a tinted fill with dark red text in light. --text
                  // would be black on dark red in one of them.
                  warning.level === 'warn'
                    ? { background: 'var(--color-danger)', color: 'var(--color-danger-text)' }
                    : { background: 'var(--color-surface-2)' }
                }
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] leading-snug font-semibold">{warning.title}</span>
                  <span
                    className={`text-[11px] font-medium whitespace-nowrap ${
                      warning.level === 'warn' ? 'opacity-70' : 'text-text-dim'
                    }`}
                  >
                    dismiss
                  </span>
                </span>
                <span
                  className={`mt-0.5 block text-[12px] leading-snug font-medium ${
                    warning.level === 'warn' ? 'opacity-90' : 'text-text-dim'
                  }`}
                >
                  {warning.detail}
                </span>
              </button>
            ))}

            {/* The lifter's own cue, in their own words, where it is needed:
                mid-set. One line; edited from the exercise detail sheet. */}
            {exerciseNotes[activeExercise.id] && (
              <p className="mt-3 text-[13px] italic text-text-dim">
                &ldquo;{exerciseNotes[activeExercise.id]}&rdquo;
              </p>
            )}

            {/* The coaching line: a tag and a sentence. Tapping it fills
                every unlogged set with the suggested load. */}
            {suggestion && (
              <button
                type="button"
                onClick={() => applySuggestion(activeExercise.id, suggestion)}
                className="mt-3 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
                style={{ background: `color-mix(in oklab, ${outcomeColor(suggestion.outcome)} 12%, transparent)` }}
              >
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold tracking-wide uppercase text-bg"
                  style={{ background: outcomeColor(suggestion.outcome) }}
                >
                  {OUTCOME_LABEL[suggestion.outcome]}
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium">
                  {suggestion.suggestedKg !== undefined && (
                    <b className="font-semibold">
                      {suggestion.suggestedKg !== undefined && activeExercise.loadMode === 'band'
                        ? `${kg(suggestion.suggestedKg)} band`
                        : `${kg(suggestion.suggestedKg)} kg`}{' '}
                      × {rangeLabel(activeExercise, repLow, repHigh)}.{' '}
                    </b>
                  )}
                  {suggestion.reason}
                  {suggestion.microplateNote && (
                    <span className="block text-[11.5px]" style={{ color: 'var(--color-warn)' }}>
                      {suggestion.microplateNote}
                    </span>
                  )}
                </span>
              </button>
            )}

            <div className="mt-3 flex flex-col gap-1.5">
              {activeDraftExercise.sets.map((set, index) => (
                <SetRow
                  key={set.setNo}
                  rowKey={`${activeExercise.id}:${index}`}
                  exercise={activeExercise}
                  set={set}
                  ghost={set.done ? undefined : ghostFor(index)}
                  current={index === currentSetIndex}
                  activeField={
                    cell?.exerciseId === activeExercise.id && cell.setIndex === index
                      ? cell.field
                      : undefined
                  }
                  onCell={(field) =>
                    setCell({ exerciseId: activeExercise.id, setIndex: index, field })
                  }
                  onToggleDone={() => {
                    setCell(null);
                    toggleDone(activeExercise.id, index, set, ghostFor(index));
                  }}
                  onRir={() => {
                    // Close the pad first: it is the thing that was covering
                    // the badge, and leaving it up over the effort sheet only
                    // makes the next tap ambiguous too.
                    setCell(null);
                    setEffortCell({ exerciseId: activeExercise.id, setIndex: index, field: 'reps' });
                  }}
                  onRemove={
                    activeDraftExercise.sets.length > 1
                      ? () => removeSet(activeExercise.id, index)
                      : undefined
                  }
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => addSet(activeExercise.id)}
              className="mt-1 w-full py-2 text-center text-[13px] font-semibold text-text-dim"
            >
              + add a set
            </button>

            {/* On to the next one; black once this one is in. On the last
                exercise it is Finish, which opens the sheet. */}
            {nextExercise ? (
              <button
                type="button"
                onClick={() => {
                  tap();
                  setActiveId(nextExercise.id);
                  setRestOpen(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`relative mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-bold ${
                  activeDone ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                }`}
              >
                Next · {nextExercise.name}
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                  <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <HapticTick />
              </button>
            ) : loggedSets > 0 ? (
              <button
                type="button"
                onClick={() => {
                  tap();
                  setFinishOpen(true);
                }}
                className={`relative mt-2 flex h-12 w-full items-center justify-center rounded-full text-[14px] font-bold ${
                  activeDone ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                }`}
              >
                Finish workout
                <HapticTick />
              </button>
            ) : null}
          </Card>
        )}

        {/* The one button that destroys an unstarted workout. With sets in it
            the same button lives behind Finish. */}
        {!sessionId && loggedSets === 0 && (
          <button
            type="button"
            onClick={() => void handleDiscard()}
            className="mt-4 w-full py-2 text-center text-[13px] font-medium text-text-faint"
          >
            Discard this workout
          </button>
        )}
      </Screen>

      <RestBar timer={timer} caption={restCaption} />

      {finishOpen && (
        <FinishSheet
          draft={draft}
          workoutName={programmedName}
          loggedSets={loggedSets}
          saving={saving}
          canSave={dirty && loggedSets > 0}
          editing={Boolean(sessionId)}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
          onSave={() => void handleSave()}
          onDiscard={() => void handleDiscard()}
          onDelete={() => void handleDelete()}
          onClose={() => setFinishOpen(false)}
        />
      )}

      {padTarget && cell && (
        <NumberPad
          key={`${cell.exerciseId}:${cell.setIndex}:${cell.field}`}
          target={padTarget}
          hint={padHint}
          onCommit={(value) =>
            patchSet(cell.exerciseId, cell.setIndex, cell.field === 'weight' ? { weightKg: value } : { reps: value })
          }
          onClose={() => setCell(null)}
          onNext={advanceCell}
        />
      )}

      {effortCell && (
        <EffortPicker
          rir={
            draft.exercises.find((e) => e.exerciseId === effortCell.exerciseId)?.sets[
              effortCell.setIndex
            ]?.rir
          }
          rpe={
            draft.exercises.find((e) => e.exerciseId === effortCell.exerciseId)?.sets[
              effortCell.setIndex
            ]?.rpe
          }
          onChange={(next) => patchSet(effortCell.exerciseId, effortCell.setIndex, next)}
          onClose={() => setEffortCell(null)}
        />
      )}

      {picking && (
        <ExercisePicker
          exercises={exercises}
          foldRetired
          selectedIds={draft.exercises.map((e) => e.exerciseId)}
          onPick={addExercise}
          onUnpick={removeExercise}
          onClose={() => setPicking(false)}
          onInfo={setDetailId}
        />
      )}

      {detailId && exercisesById.get(detailId) && (
        <ExerciseDetail
          exercise={exercisesById.get(detailId) as Exercise}
          onClose={() => setDetailId(undefined)}
        />
      )}
    </>
  );
}
