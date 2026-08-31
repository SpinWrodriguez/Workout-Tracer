import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { DaySlot, Exercise, GolfDay, MuscleId } from '../db/types';
import { MUSCLES } from '../db/seed/muscles';
import { friendlyDate, longDate, todayIso } from '../lib/format';
import { GRIP_BUFFER_DAYS, buildWeek, golfWeekdaysFrom, WEEKDAY_LABEL } from '../lib/golf';
import { generateBlock, type GeneratedBlock } from '../lib/blockBuilder';
import { Card, Chip, Empty, Label, Screen, SegmentedToggle } from '../components/Layout';
import { WeekStrip } from '../components/WeekStrip';
import { shiftIso, weekStart } from '../lib/format';

const DAY_SLOTS: DaySlot[] = ['A', 'B', 'C', 'X', 'Y'];
const SESSION_COUNTS = ['1', '2', '3'] as const;

/** rest → planned → played → rest. */
function nextGolfStatus(current: GolfDay | undefined): GolfDay['status'] | undefined {
  if (!current) return 'planned';
  if (current.status === 'planned') return 'played';
  return undefined;
}

export function ProgramScreen({ exercises }: { exercises: Exercise[] }) {
  const [anchor, setAnchor] = useState(() => todayIso());
  const [sessionsPerWeek, setSessionsPerWeek] = useState<(typeof SESSION_COUNTS)[number]>('2');
  const [focus, setFocus] = useState<MuscleId[]>([]);
  const [preview, setPreview] = useState<GeneratedBlock | null>(null);

  const block = useLiveQuery(() => db.block.orderBy('startDate').reverse().first(), [], undefined);
  const golfDays = useLiveQuery(() => db.golfDay.toArray(), [], undefined);
  const slots = useLiveQuery(
    async () => (block ? db.blockExercise.where('blockId').equals(block.id).toArray() : []),
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

  const week = useMemo(
    () =>
      buildWeek({
        anchorDate: anchor,
        golfDays: golfDays ?? [],
        sessions: sessionRows ?? [],
        exercisesById: byId,
      }),
    [anchor, golfDays, sessionRows, byId],
  );

  const golfWeekdays = useMemo(() => golfWeekdaysFrom(golfDays ?? []), [golfDays]);
  const violations = week.filter((day) => day.violation);

  const focusOrDefault = focus.length > 0 ? focus : (block?.focusMuscles ?? []);

  const toggleGolf = async (date: string) => {
    const existing = await db.golfDay.get(date);
    const next = nextGolfStatus(existing);
    if (next === undefined) await db.golfDay.delete(date);
    else await db.golfDay.put({ date, status: next, holes: existing?.holes ?? 18 });
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
        <WeekStrip week={week} onToggleGolf={(date) => void toggleGolf(date)} />
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Tap a day to mark a round: planned, then played, then clear.
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
            <Label className="mt-4 block">Focus muscles</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MUSCLES.map((muscle) => (
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

            <Label className="mt-4 block">Sessions per week</Label>
            <div className="mt-1.5">
              <SegmentedToggle
                options={SESSION_COUNTS}
                value={sessionsPerWeek}
                onChange={setSessionsPerWeek}
              />
            </div>

            <p className="mt-4 text-[12px] font-medium text-text-dim">
              Golf on{' '}
              {golfWeekdays.length === 0
                ? 'no day yet — mark a round above'
                : golfWeekdays.map((d) => WEEKDAY_LABEL[d]).join(' and ')}
              . High-grip work is kept at least {GRIP_BUFFER_DAYS} days clear.
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
                    {day.weekdayLabel}
                  </span>
                </span>
                <Label className={day.gripSafe ? '' : 'text-text-faint!'}>
                  {day.gripSafe ? 'grip ok' : 'no grip'} · ~{day.estimatedMinutes} min
                </Label>
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
                      {exercise?.gripLoad === 'high' && (
                        <span className="ml-1.5 text-[10px] font-bold" style={{ color: 'var(--color-volume)' }}>
                          GRIP
                        </span>
                      )}
                      {exercise?.isHinge && (
                        <span className="ml-1.5 text-[10px] font-bold text-text-dim">HINGE</span>
                      )}
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
        const list = (slots ?? [])
          .filter((s) => s.daySlot === slot)
          .sort((a, b) => a.order - b.order);
        if (list.length === 0) return null;
        return (
          <Card key={slot} title={`Day ${slot}`} className="mt-3">
            {list.map((entry) => (
              <div
                key={entry.exerciseId}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="truncate text-[15px] font-medium">
                  {byId.get(entry.exerciseId)?.name ?? entry.exerciseId}
                </span>
                <Label>
                  {entry.targetSets} × {entry.repRangeLow}-{entry.repRangeHigh}
                </Label>
              </div>
            ))}
          </Card>
        );
      })}

      {(slots?.length ?? 0) === 0 && !preview && (
        <Card title="No day slots yet" className="mt-3">
          <Empty>--- sets</Empty>
          <p className="mt-2 text-[13px] text-text-dim">
            Generate a week above. Exercises stay fixed for the whole block — that is what makes
            progressive overload work.
          </p>
        </Card>
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
