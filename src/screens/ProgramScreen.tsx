import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, Muscle, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { friendlyDate, longDate, todayIso } from '../lib/format';
import {
  GRIP_BUFFER_DAYS,
  WEEKDAY_LABEL,
  buildWeek,
  golfWeekdaysFrom,
  weekdayOf,
} from '../lib/golf';
import {
  DAY_TYPES,
  DAY_TYPE_LABEL,
  SPLIT_LABEL,
  generateBlock,
  splitFits,
  type DayType,
  type GeneratedBlock,
  type SplitId,
} from '../lib/blockBuilder';
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
const SESSION_COUNTS = ['1', '2', '3'] as const;
const SPLITS: SplitId[] = ['full_body', 'upper_lower', 'push_pull_legs', 'custom'];
const FOCUS_MODES = ['upper', 'lower', 'custom'] as const;
type FocusMode = (typeof FOCUS_MODES)[number];

const FOCUS_LABEL: Record<FocusMode, string> = {
  upper: 'Upper body',
  lower: 'Lower body',
  custom: 'Custom',
};

const REGION_LABEL: Record<Muscle['region'], string> = {
  upper: 'Upper',
  lower: 'Lower',
  core: 'Core',
};

/* Presets fold the trunk in with the half it actually works alongside, so
   picking "Lower body" does not silently drop the core. */
const PRESET: Record<'upper' | 'lower', MuscleId[]> = {
  upper: MUSCLES.filter((m) => m.region === 'upper').map((m) => m.id),
  lower: MUSCLES.filter((m) => m.region !== 'upper').map((m) => m.id),
};

function sameSet(a: MuscleId[], b: MuscleId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function ProgramScreen({
  exercises,
  onStartDay,
}: {
  exercises: Exercise[];
  onStartDay: (slot: DaySlot) => void;
}) {
  const [anchor, setAnchor] = useState(() => todayIso());
  const [sessionsPerWeek, setSessionsPerWeek] = useState<(typeof SESSION_COUNTS)[number]>('2');
  const [focus, setFocus] = useState<MuscleId[]>([]);
  const [focusMode, setFocusMode] = useState<FocusMode | null>(null);
  /* The per-muscle grid stays folded away until asked for — eighteen chips is
     the mess this replaced. */
  const [editingMuscles, setEditingMuscles] = useState(false);
  const [preview, setPreview] = useState<GeneratedBlock | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [split, setSplit] = useState<SplitId>('full_body');
  const [customDayTypes, setCustomDayTypes] = useState<DayType[]>(['upper', 'lower', 'full']);
  const [editingSlot, setEditingSlot] = useState<DaySlot | null>(null);
  const [addingTo, setAddingTo] = useState<DaySlot | null>(null);

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

  const golfWeekdays = useMemo(() => golfWeekdaysFrom(golfDays ?? []), [golfDays]);
  const violations = week.filter((day) => day.violation);

  const focusOrDefault = focus.length > 0 ? focus : (block?.focusMuscles ?? []);

  /* The mode is derived from the selection, so hand-picking the whole upper
     body still reads as "Upper body" rather than stale Custom. */
  const resolvedFocusMode: FocusMode =
    focusMode === 'custom'
      ? 'custom'
      : sameSet(focusOrDefault, PRESET.upper)
        ? 'upper'
        : sameSet(focusOrDefault, PRESET.lower)
          ? 'lower'
          : (focusMode ?? 'custom');

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
        golfWeekdays,
        split,
        customDayTypes,
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
      Object.fromEntries(preview.days.map((day) => [day.slot, day.weekday])),
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
            <Label className="mt-4 block">Focus</Label>
            <div className="mt-1.5">
              <SegmentedToggle
                options={FOCUS_MODES}
                value={resolvedFocusMode}
                onChange={(mode) => {
                  setFocusMode(mode);
                  setEditingMuscles(mode === 'custom');
                  if (mode !== 'custom') setFocus(PRESET[mode]);
                }}
                labels={FOCUS_LABEL}
              />
            </div>

            {resolvedFocusMode === 'custom' && !editingMuscles && (
              <button
                type="button"
                onClick={() => setEditingMuscles(true)}
                className="mt-2 flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0 text-[13px] font-medium text-text-dim">
                  {focusOrDefault.length === 0
                    ? 'No muscles picked — the builder will favour compounds'
                    : `${focusOrDefault.length} muscles picked`}
                </span>
                <span className="shrink-0 text-[12px] font-medium text-text-dim">Choose</span>
              </button>
            )}

            {resolvedFocusMode === 'custom' && editingMuscles ? (
              (['upper', 'lower', 'core'] as const).map((region) => (
                <div key={region} className="mt-3">
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
              ))
            ) : resolvedFocusMode !== 'custom' ? (
              <p className="mt-2 text-[12px] font-medium text-text-dim">
                {focusOrDefault.length} muscles — switch to Custom to pick them individually.
              </p>
            ) : null}

            <Label className="mt-4 block">Split</Label>
            <div className="no-scrollbar -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1">
              {SPLITS.map((option) => (
                <Chip
                  key={option}
                  active={split === option}
                  onClick={() => setSplit(option)}
                  tone="plain"
                >
                  {SPLIT_LABEL[option]}
                </Chip>
              ))}
            </div>
            {!splitFits(split, Number(sessionsPerWeek)) && (
              <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--color-warn)' }}>
                {SPLIT_LABEL[split]} wants more sessions than you have — part of it will not be
                trained.
              </p>
            )}

            {split === 'custom' && (
              <div className="mt-3">
                {Array.from({ length: Number(sessionsPerWeek) }, (_, i) => (
                  <div key={i} className="mt-2 first:mt-0">
                    <Label className="mb-1 block">Day {DAY_SLOTS[i]}</Label>
                    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
                      {DAY_TYPES.map((type) => (
                        <Chip
                          key={type}
                          active={(customDayTypes[i] ?? 'full') === type}
                          onClick={() =>
                            setCustomDayTypes((prev) => {
                              const next = [...prev];
                              next[i] = type;
                              return next;
                            })
                          }
                        >
                          {DAY_TYPE_LABEL[type]}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Label className="mt-4 block">Sessions per week</Label>
            <div className="mt-1.5">
              <SegmentedToggle
                options={SESSION_COUNTS}
                value={sessionsPerWeek}
                onChange={setSessionsPerWeek}
              />
            </div>

            <p className="mt-4 text-[12px] font-medium text-text-dim">
              {golfWeekdays.length === 0
                ? 'No round marked yet — tap a day above to add one.'
                : `Golf on ${golfWeekdays
                    .map((d) => WEEKDAY_LABEL[d])
                    .join(' and ')}. Grip work is kept at least ${GRIP_BUFFER_DAYS} days clear.`}
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
                    {day.weekdayLabel} · {DAY_TYPE_LABEL[day.type].toLowerCase()}
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
        const weekday = schedule?.[slot];
        return (
          <DaySlotCard
            key={slot}
            slot={slot}
            weekday={weekday}
            entries={list}
            exercisesById={byId}
            editing={isEditing}
            isToday={weekday !== undefined && weekday === weekdayOf(todayIso())}
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
