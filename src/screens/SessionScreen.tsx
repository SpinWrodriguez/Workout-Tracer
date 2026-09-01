import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import type { BlockExercise, DaySlot, Exercise, SetLog } from '../db/types';
import { CABLE_STACK_KG, STATION_LABEL } from '../db/seed/exercises';
import { DEFAULT_BLOCK_ID } from '../db/seed';
import {
  draftFromPlan,
  emptyDraft,
  entriesForSlot,
  readBlockPlan,
  slotForDate,
  type BlockPlan,
} from '../lib/program';
import { readInventory } from '../db/settings';
import { hasLoadTranslation } from '../lib/load';
import { DEFAULT_INVENTORY, ladderFor, type Inventory } from '../lib/loadable';
import { sessionWarnings, type RuleWarning } from '../lib/golf';
import {
  DEFAULT_REP_RANGE,
  OUTCOME_LABEL,
  suggestProgression,
  type HistorySet,
  type Progression,
} from '../lib/progression';
import { friendlyDate, kg, todayIso } from '../lib/format';
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
import { Card, Label, Screen } from '../components/Layout';
import { ExercisePicker } from '../components/ExercisePicker';
import { ExerciseDetail } from '../components/ExerciseDetail';
import { ExerciseStrip } from '../components/ExerciseStrip';
import { EffortPicker } from '../components/EffortPicker';
import { NumberPad, type PadTarget } from '../components/NumberPad';
import { RestTimerBar } from '../components/RestTimer';
import { useRestTimer } from '../lib/restTimer';
import { SetRow, type CellField } from '../components/SetRow';
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
  /* What the draft looked like when it was loaded or last saved. Save is only
     offered when it differs — a button that is always there is not a prompt,
     it is furniture. */
  const [baseline, setBaseline] = useState<string | undefined>(undefined);
  const [effortCell, setEffortCell] = useState<ActiveCell | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [history, setHistory] = useState<Record<string, SetLog[]>>({});
  const [allHistory, setAllHistory] = useState<Record<string, HistorySet[]>>({});
  const [inventory, setInventory] = useState<Inventory>(DEFAULT_INVENTORY);
  const [plan, setPlan] = useState<BlockPlan | undefined>(undefined);
  const [golfDates, setGolfDates] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, BlockExercise>>({});
  const [saving, setSaving] = useState(false);
  const timer = useRestTimer();

  /* --- load or create the draft ----------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    void readInventory().then((next) => {
      if (!cancelled) setInventory(next);
    });
    void db.golfDay.toArray().then((rows) => {
      if (!cancelled) setGolfDates(rows.map((row) => row.date));
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
          setBaseline(JSON.stringify(existing));
          setActiveId(existing.exercises[0]?.exerciseId);
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
      const slot = freestyle
        ? undefined
        : (daySlot ?? (blockPlan ? slotForDate(blockPlan.schedule, date, blockPlan.dates) : undefined));
      const programmed =
        blockPlan && slot ? entriesForSlot(blockPlan.entries, slot).length > 0 : false;

      if (blockPlan && slot && programmed) {
        const next = draftFromPlan({ plan: blockPlan, slot, exercisesById, date });
        setDraft(next);
        setBaseline(JSON.stringify(next));
        setActiveId(next.exercises[0]?.exerciseId);
        return;
      }

      const blank = emptyDraft(blockPlan?.block.id ?? DEFAULT_BLOCK_ID, slot ?? 'A', date);
      setBaseline(JSON.stringify(blank));
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

  const removeExercise = (exerciseId: string) => {
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

  const toggleDone = (exerciseId: string, setIndex: number, set: DraftSet) => {
    const nextDone = !set.done;
    patchSet(exerciseId, setIndex, { done: nextDone });
    if (nextDone && isLoggable(set)) timer.start();
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
        field: exercise && exercise.loadMode === 'weight' ? 'weight' : 'reps',
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
  const dirty = draft !== undefined && baseline !== undefined && JSON.stringify(draft) !== baseline;

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
          // Stamped at save time: the slot gets reused every block, so looking
          // this up later would caption an old session with today's workout.
          daySlotName: labelFor(draft.daySlot as DaySlot),
        },
        exercisesById,
      );
      setBaseline(JSON.stringify(draft));
      onExit();
    } finally {
      setSaving(false);
    }
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

  const loggedCounts = Object.fromEntries(
    draft.exercises.map((e) => [e.exerciseId, e.sets.filter(isLoggable).length]),
  );

  /* The golf rule and the hinge-fatigue note, spec Phase 3. Computed over the
     whole draft in performance order, not just the active exercise. */
  const warnings: RuleWarning[] = draft
    ? sessionWarnings(
        {
          date: draft.date,
          exercises: draft.exercises.map((e) => ({
            exerciseId: e.exerciseId,
            loggedSets: e.sets.filter(isLoggable).length,
          })),
        },
        exercisesById,
        golfDates,
      ).filter((w) => !dismissed.includes(`${w.exerciseId}:${w.title}`))
    : [];

  /* A light day carries its own instruction, set by the template. */
  const effortCue = draft ? plan?.schedule[draft.daySlot as DaySlot]?.effortCue : undefined;

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
        })
      : undefined;

  return (
    <>
      <Screen
        title="Workout"
        pad={cell ? 'keypad' : 'none'}
        trailing={
          <span className="flex items-center gap-2 pb-1">
            <span className="text-[13px] font-medium text-text-dim">
              {friendlyDate(draft.date)}
            </span>
            <button
              type="button"
              onClick={() => {
                if (
                  dirty &&
                  loggedSets > 0 &&
                  !window.confirm('Leave without saving? The sets you logged will be lost.')
                ) {
                  return;
                }
                onExit();
              }}
              className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-dim"
            >
              Close
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
            <RestTimerBar timer={timer} onPresetChange={timer.setDuration} />
            <ExerciseStrip
              exercises={stripExercises}
              activeId={activeId}
              loggedCounts={loggedCounts}
              onSelect={setActiveId}
              onAdd={() => setPicking(true)}
            />
          </>
        }
      >
        {warnings.map((warning) => (
          <button
            key={`${warning.exerciseId}:${warning.title}`}
            type="button"
            onClick={() =>
              setDismissed((prev) => [...prev, `${warning.exerciseId}:${warning.title}`])
            }
            className="mb-3 w-full rounded-2xl px-4 py-3 text-left"
            style={
              // The danger pair is themed: a dark red fill with white text in
              // dark, a tinted fill with dark red text in light. --text would
              // be black on dark red in one of them.
              warning.level === 'warn'
                ? { background: 'var(--color-danger)', color: 'var(--color-danger-text)' }
                : { background: 'var(--color-surface)' }
            }
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="card-title">{warning.title}</span>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  warning.level === 'warn' ? 'opacity-70' : 'text-text-dim'
                }`}
              >
                dismiss
              </span>
            </span>
            <span
              className={`mt-1 block text-[12px] leading-snug font-medium ${
                warning.level === 'warn' ? 'opacity-90' : 'text-text-dim'
              }`}
            >
              {warning.detail}
            </span>
          </button>
        ))}

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
          <Card
            title={activeExercise.name}
            trailing={
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDetailId(activeExercise.id)}
                  aria-label={`About ${activeExercise.name}`}
                  className="text-text-dim"
                >
                  <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                    <path
                      d="M12 11v5.5M12 7.6v.8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
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
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label>{STATION_LABEL[activeExercise.station]}</Label>
              {hasLoadTranslation(activeExercise) && (
                <Label className="text-strength!">
                  ×{activeExercise.loadMultiplier.toFixed(2)} · {CABLE_STACK_KG} kg stack
                </Label>
              )}
              {activeExercise.barWeight !== undefined && (
                <Label>bar {activeExercise.barWeight} kg</Label>
              )}
              {activeExercise.loadMode === 'rpe_only' && <Label>band — log RPE and reps only</Label>}
              {activeExercise.isHinge && <Label>hinge — do this fresh</Label>}
            </div>

            {suggestion && (
              <button
                type="button"
                onClick={() => applySuggestion(activeExercise.id, suggestion)}
                className="mb-3 w-full rounded-xl bg-surface-2 px-3 py-2.5 text-left"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline gap-2">
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase text-bg"
                      style={{ background: outcomeColor(suggestion.outcome) }}
                    >
                      {OUTCOME_LABEL[suggestion.outcome]}
                    </span>
                    <span className="text-[17px] font-semibold">
                      {suggestion.suggestedKg === undefined
                        ? `${repHigh} reps`
                        : `${kg(suggestion.suggestedKg)} kg`}
                    </span>
                    <span className="label">
                      × {repLow}-{repHigh}
                    </span>
                  </span>
                  {suggestion.suggestedKg !== undefined && (
                    <span className="label whitespace-nowrap">tap to fill</span>
                  )}
                </span>
                <span className="mt-1 block text-[11px] leading-snug font-medium text-text-dim">
                  {suggestion.reason}
                </span>
                {suggestion.microplateNote && (
                  <span
                    className="mt-1 block text-[11px] leading-snug font-medium"
                    style={{ color: 'var(--color-warn)' }}
                  >
                    {suggestion.microplateNote}
                  </span>
                )}
              </button>
            )}

            <div className="flex items-center gap-2 pb-1">
              <span className="w-7 shrink-0" />
              <span className="label w-14 shrink-0">{target ? 'target' : 'last time'}</span>
              <span className="label flex-1 text-center">
                {activeExercise.station === 'cable' ? 'stack' : 'weight'}
              </span>
              <span className="label flex-1 text-center">reps</span>
              <span className="w-14 shrink-0" />
              <span className="w-8 shrink-0" />
            </div>

            {activeDraftExercise.sets.map((set, index) => {
              const prior = previous?.find((p) => p.setNo === set.setNo);
              const targetText = prior
                ? prior.weightKg === undefined
                  ? `${prior.reps}`
                  : `${kg(prior.weightKg)}×${prior.reps}`
                : target
                  ? rangeLabel(activeExercise, target.repRangeLow, target.repRangeHigh)
                  : undefined;
              return (
                <SetRow
                  key={set.setNo}
                  rowKey={`${activeExercise.id}:${index}`}
                  exercise={activeExercise}
                  set={set}
                  target={targetText}
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
                    toggleDone(activeExercise.id, index, set);
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
              );
            })}

            <button
              type="button"
              onClick={() => addSet(activeExercise.id)}
              className="mt-2 w-full rounded-xl bg-surface-2 py-2.5 text-[13px] font-medium text-text-dim"
            >
              + Add set
            </button>
          </Card>
        )}

        <Card title="Session details" className="mt-3">
          {/* Read-only, and only when there is one. As a control it listed
              all twelve workout ids including the ones that do not exist, to
              change something you already chose when you started. As a line of
              text it answers the one useful question: what is this being
              logged against. A freestyle session is attributed to nothing and
              says nothing. */}
          {programmedName && (
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <Label>Workout</Label>
              <span className="truncate text-[14px] font-medium">{programmedName}</span>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <label className="flex-1">
              <Label>Date</Label>
              <input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium"
              />
            </label>
            <label className="w-28">
              <Label>Minutes</Label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="--"
                value={draft.durationMin ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    durationMin: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
                className="mt-1.5 h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] font-medium placeholder:text-text-faint"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <Label>Notes</Label>
            <textarea
              rows={2}
              value={draft.notes ?? ''}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="--"
              className="mt-1.5 w-full resize-none rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] placeholder:text-text-faint"
            />
          </label>

          {sessionId && (
            <button
              type="button"
              onClick={handleDelete}
              className="mt-4 text-[13px] font-medium"
              style={{ color: 'var(--color-rir-1)' }}
            >
              Delete session
            </button>
          )}
        </Card>

        {/* At the end of the screen rather than pinned over it: a button that
            is always in front of you is furniture, not a prompt. It appears
            when there is something unsaved and goes away once there is not. */}
        {dirty && loggedSets > 0 && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="h-cta mt-3 w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {saving ? 'Saving…' : `Save · ${loggedSets} sets`}
          </button>
        )}
      </Screen>



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

      {effortCell && draft && (
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
          selectedIds={draft.exercises.map((e) => e.exerciseId)}
          onPick={addExercise}
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
