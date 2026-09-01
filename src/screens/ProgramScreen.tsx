import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, Muscle, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { friendlyDate, longDate, todayIso } from '../lib/format';
import { WEEKDAY_LABEL, buildWeek, gripSafeWeekdays, weekdayOf, type Weekday } from '../lib/golf';
import { readInventory } from '../db/settings';
import { DEFAULT_INVENTORY, ladderFor, type Inventory } from '../lib/loadable';
import { generateBlock, type GeneratedBlock } from '../lib/blockBuilder';
import {
  DEFAULT_THIRD_DAY,
  maxSessionsFor,
  templateWeekdays,
  SESSION_SHAPES,
  SESSION_SHAPE_HINT,
  SESSION_SHAPE_LABEL,
  type SessionShape,
} from '../lib/weekTemplate';
import { readTraining, DEFAULT_TRAINING, type TrainingPrefs } from '../db/settings';
import {
  addBlockExercise,
  assignSlot,
  clearDaySlot,
  entriesForSlot,
  moveBlockExercise,
  readSchedules,
  removeBlockExercise,
  slotsByWeekday,
  updateBlockExercise,
  writeSchedule,
  type BlockSchedule,
} from '../lib/program';
import { DayEditor } from '../components/DayEditor';
import { DaySlotCard } from '../components/DaySlotCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { Card, Chip, Empty, Label, Screen, SegmentedToggle } from '../components/Layout';
import { WeekStrip, type WeekStripDay } from '../components/WeekStrip';
import { shiftIso, weekStart } from '../lib/format';

const DAY_SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];
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
  const [preview, setPreview] = useState<GeneratedBlock | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [thirdDay] = useState<number>(DEFAULT_THIRD_DAY);
  /* null means the app balances it; an empty array means every session light. */
  const [heavyWeekdays, setHeavyWeekdays] = useState<Weekday[] | null>(null);
  const [shape, setShape] = useState<SessionShape>('mixed');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [training, setTraining] = useState<TrainingPrefs>(DEFAULT_TRAINING);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);
  const [addingTo, setAddingTo] = useState<DaySlot | null>(null);
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
    const planned = slotsByWeekday(schedule ?? {});
    return buildWeek({
      anchorDate: anchor,
      golfDays: golfDays ?? [],
      sessions: sessionRows ?? [],
      exercisesById: byId,
    }).map((day) => ({ ...day, plannedSlot: planned[day.weekday] }));
  }, [anchor, golfDays, sessionRows, byId, schedule]);

  /** Slots the block actually defines, for the day editor's gym options. */
  const definedSlots = useMemo(
    () => [...new Set((slots ?? []).map((entry) => entry.daySlot))].sort(),
    [slots],
  );

  const saveSchedule = async (next: BlockSchedule) => {
    if (block) await writeSchedule(block.id, next);
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

  const generate = () => {
    if (!block) return;
    setPreview(
      generateBlock({
        blockId: block.id,
        exercises,
        focusMuscles: focusOrDefault,
        sessionsPerWeek: Number(sessionsPerWeek),
        golfWeekdays: training.golfWeekdays as never,
        shape,
        thirdDay: thirdDay as never,
        heavyWeekdays: heavyWeekdays ?? undefined,
        minutesPerSession: Number(sessionMinutes),
        weeklySetTarget: training.weeklySetTarget,
        hasHistory: hasHistory ?? false,
        laddersFor: (exercise) => ladderFor(exercise, inventory),
      }),
    );
  };

  const applyPreview = async () => {
    if (!block || !preview) return;
    await db.transaction('rw', [db.block, db.blockExercise], async () => {
      await db.blockExercise.where('blockId').equals(block.id).delete();
      await db.blockExercise.bulkPut(preview.days.flatMap((day) => day.exercises));
      await db.block.put({ ...block, focusMuscles: focusOrDefault });
    });
    // The builder decided which weekday each slot lands on, and that is half
    // the golf rule. BlockExercise has nowhere to put it, so it is stored
    // beside the block — without it nothing can answer "what am I doing today".
    await writeSchedule(
      block.id,
      Object.fromEntries(
        preview.days.map((day) => [
          day.slot,
          { weekday: day.weekday, intensity: day.intensity, effortCue: day.effortCue },
        ]),
      ),
    );
    setPreview(null);
  };

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
          onPickDay={setEditingDate}
          onMoveSlot={(slot, weekday) => void saveSchedule(assignSlot(schedule ?? {}, slot, weekday))}
        />
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Tap a day to set gym, golf or rest. Drag a session pill to move it — anything already on
          that day swaps places with it.
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
                    onChange={setShape}
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
                onChange={setSessionMinutes}
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

            <button
              type="button"
              onClick={generate}
              className="mt-3 h-11 w-full rounded-full bg-cta font-semibold text-bg"
            >
              Generate week
            </button>
          </>
        ) : (
          <Empty>--</Empty>
        )}
      </Card>

      {preview && (
        <Card title="Proposed block" className="mt-3">
          <p className="text-[13px] leading-snug text-text-dim">{preview.rationale}</p>
          {preview.violations.length > 0 && (
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-rir-1)' }}>
                {preview.violations.length} rule
                {preview.violations.length === 1 ? '' : 's'} still broken
              </p>
              {preview.violations.map((violation) => (
                <p
                  key={violation.code + (violation.exerciseId ?? '') + (violation.slot ?? '')}
                  className="mt-1 text-[12px] leading-snug font-medium text-text-dim"
                >
                  {violation.message}
                </p>
              ))}
            </div>
          )}

          {preview.warnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 text-[12px] font-medium"
              style={{ color: 'var(--color-warn)' }}
            >
              {warning}
            </p>
          ))}

          {preview.days.map((day) => (
            <div key={day.slot} className="mt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="card-title">
                  Day {day.slot}
                  <span className="ml-2 text-[12px] font-medium text-text-dim">
                    {day.weekdayLabel} · {day.intensity}
                  </span>
                </span>
                <Label>~{day.estimatedMinutes} min</Label>
              </div>
              {day.exercises.map((entry) => {
                const exercise = byId.get(entry.exerciseId);
                return (
                  <div
                    key={entry.exerciseId}
                    className="flex items-baseline justify-between gap-3 py-1"
                  >
                    <span className="truncate text-[14px] font-medium">
                      {exercise?.name ?? entry.exerciseId}

                    </span>
                    <Label>
                      {entry.targetSets} × {entry.repRangeLow}-{entry.repRangeHigh}
                    </Label>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="h-11 flex-1 rounded-full bg-surface-2 font-medium text-text-dim"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void applyPreview()}
              className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg"
            >
              Use this block
            </button>
          </div>
        </Card>
      )}

      {DAY_SLOTS.map((slot) => {
        const list = entriesForSlot(slots ?? [], slot);
        const isEditing = editingSlot === slot;
        if (list.length === 0 && !isEditing) return null;
        const scheduled = schedule?.[slot];
        const weekday = scheduled?.weekday;
        return (
          <DaySlotCard
            key={slot}
            slot={slot}
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
            onClearDay={() => {
              if (block && window.confirm(`Delete day ${slot} and everything in it?`)) {
                void clearDaySlot(block.id, slot);
                setEditingSlot(null);
              }
            }}
          />
        );
      })}

      {/* Building a block by hand starts here: claim the next free slot. */}
      {block && (
        <button
          type="button"
          onClick={() => {
            const next = DAY_SLOTS.find(
              (slot) => entriesForSlot(slots ?? [], slot).length === 0,
            );
            if (next) {
              setEditingSlot(next);
              setAddingTo(next);
            }
          }}
          className="mt-3 h-11 w-full rounded-full bg-surface-2 text-sm font-medium text-text-dim"
        >
          Add a day
        </button>
      )}

      {(slots?.length ?? 0) === 0 && !preview && (
        <Card title="No day slots yet" className="mt-3">
          <Empty>--- sets</Empty>
          <p className="mt-2 text-[13px] text-text-dim">
            Generate a week above. Exercises stay fixed for the whole block — that is what makes
            progressive overload work.
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
          currentSlot={week.find((day) => day.date === editingDate)?.plannedSlot}
          golf={golfDays?.find((day) => day.date === editingDate)}
          onSetSlot={(slot) => {
            const weekday = weekdayOf(editingDate);
            if (slot === undefined) {
              const current = week.find((day) => day.date === editingDate)?.plannedSlot;
              if (current) void saveSchedule(assignSlot(schedule ?? {}, current, undefined));
            } else {
              void saveSchedule(assignSlot(schedule ?? {}, slot, weekday));
            }
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
