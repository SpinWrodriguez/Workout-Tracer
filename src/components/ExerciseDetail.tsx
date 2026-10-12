import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Exercise } from '../db/types';
import {
  readInventory,
  readDeletedExercises,
  readRetiredExercises,
  setExerciseDeleted,
  setExerciseRetired,
} from '../db/settings';
import { DEFAULT_INVENTORY, barWeightFor } from '../lib/loadable';
import { db } from '../db/db';
import { readBlockPlan } from '../lib/program';
import { slotFallback } from '../lib/dayLabel';
import { CABLE_STACK_KG, STATION_LABEL } from '../db/seed/exercises';
import { muscleName } from '../db/seed/muscles';
import { cueFor, scalingFor, stepsFor } from '../db/seed/cues';
import { photosFor } from '../db/seed/photos';
import { getRecord, loadImageBlob, type FreeDbRecord } from '../lib/freeDb';
import { hasLoadTranslation } from '../lib/load';
import { clock, daysBetween, friendlyDate, kg } from '../lib/format';
import { estimate1RM } from '../lib/stats';
import { isTimed } from '../lib/repUnit';
import { MiniMap } from './PlanLevels';
import { Sheet } from './Sheet';

/* -------------------------------------------------------------------------- */
/*  Exercise detail.                                                          */
/*                                                                            */
/*  What it looks like, what it works, what you lift on it, how to do it:     */
/*  in that order, with no headings. The photos and the body map come first   */
/*  because they are what the eye went looking for; the garage cue always     */
/*  shows; the upstream steps are a bonus that may be missing. Retire and     */
/*  delete are two words at the foot.                                         */
/* -------------------------------------------------------------------------- */

function Photo({ freeDbId, path }: { freeDbId: string; path: string }) {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadImageBlob(freeDbId, path).then((blob) => {
      if (cancelled || !blob || typeof URL.createObjectURL !== 'function') return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [freeDbId, path]);

  return (
    <div className="aspect-square min-w-0 flex-1 overflow-hidden rounded-2xl bg-surface-2">
      {url && <img src={url} alt="" className="size-full object-cover object-top" />}
    </div>
  );
}

/** One session's best estimated one-rep max, for the line. */
interface SessionPoint {
  date: string;
  oneRm: number;
}

/** Trailing weeks the trend chip compares against. */
const TREND_DAYS = 28;

function Sparkline({ points }: { points: SessionPoint[] }) {
  const W = 320;
  const H = 48;
  const values = points.map((p) => p.oneRm);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const xs = points.map((_, i) => 4 + (i * (W - 8)) / Math.max(1, points.length - 1));
  const ys = values.map((v) => 6 + (1 - (v - lo) / span) * (H - 12));
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(ys[i] as number).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-12 w-full"
      aria-label={`Estimated one-rep max over ${points.length} sessions, ${kg(values[0] as number)} to ${kg(values[last] as number)} kg`}
    >
      <path d={`${line} L${(xs[last] as number).toFixed(1)} ${H} L4 ${H} Z`} fill="var(--color-strength)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--color-strength)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xs[last]} cy={ys[last]} r="4" fill="var(--color-strength)" />
    </svg>
  );
}

export function ExerciseDetail({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
  /* Read here rather than passed in: this sheet opens from four screens and
     the bar in the garage is the same bar on all of them. */
  const inventory = useLiveQuery(() => readInventory(), [], DEFAULT_INVENTORY);
  const bar = barWeightFor(exercise, inventory);
  const retired = useLiveQuery(
    async () => (await readRetiredExercises()).includes(exercise.id),
    [exercise.id],
  );
  /* What deleting would touch: the current block's workouts that still hold
     it (which block the delete — a finished block's never will) and the sets
     logged against it (which it keeps). */
  const standing = useLiveQuery(async () => {
    const [deletedIds, plan, logged] = await Promise.all([
      readDeletedExercises(),
      readBlockPlan(),
      db.setLog.where('exerciseId').equals(exercise.id).count(),
    ]);
    const workouts = [
      ...new Set(
        (plan?.entries ?? [])
          .filter((entry) => entry.exerciseId === exercise.id)
          .map((entry) => plan?.schedule[entry.daySlot]?.name ?? slotFallback(entry.daySlot)),
      ),
    ];
    return { deleted: deletedIds.includes(exercise.id), workouts, logged };
  }, [exercise.id]);

  /*
   * Your numbers: one point per session, its best set's estimated one-rep
   * max, and the last session's sets as a line. Computed from the log every
   * time, like every other figure in the app.
   */
  const numbers = useLiveQuery(async () => {
    const logs = await db.setLog.where('exerciseId').equals(exercise.id).toArray();
    if (logs.length === 0) return null;
    const sessions = await db.session.bulkGet([...new Set(logs.map((l) => l.sessionId))]);
    const dateOf = new Map(sessions.filter((s) => s !== undefined).map((s) => [s.id, s.date]));
    const bySession = new Map<string, typeof logs>();
    for (const log of logs) {
      const date = dateOf.get(log.sessionId);
      if (!date) continue;
      bySession.set(log.sessionId, [...(bySession.get(log.sessionId) ?? []), log]);
    }
    const points: SessionPoint[] = [...bySession.entries()]
      .map(([id, sets]) => ({
        date: dateOf.get(id) as string,
        oneRm: Math.max(0, ...sets.map((s) => estimate1RM(s.effectiveKg ?? s.weightKg ?? 0, s.reps))),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1);
    const lastSets = latest
      ? [...(bySession.get([...bySession.keys()].find((id) => dateOf.get(id) === latest.date) as string) ?? [])].sort(
          (a, b) => a.setNo - b.setNo,
        )
      : [];
    /* Against the newest session at least four weeks older; the first one
       when the history is shorter than that. */
    const base = latest
      ? [...points].reverse().find((p) => daysBetween(p.date, latest.date) >= TREND_DAYS) ?? points[0]
      : undefined;
    return {
      points: points.filter((p) => p.oneRm > 0),
      latest,
      delta: latest && base && base !== latest ? latest.oneRm - base.oneRm : undefined,
      lastSets,
    };
  }, [exercise.id]);

  // `undefined` while loading, `null` once we know there is nothing to show.
  // An unmapped exercise is known to be empty without a lookup.
  const [record, setRecord] = useState<FreeDbRecord | null | undefined>(
    exercise.freeDbId ? undefined : null,
  );

  useEffect(() => {
    const freeDbId = exercise.freeDbId;
    if (!freeDbId) return;
    let cancelled = false;
    void getRecord(freeDbId).then((found) => {
      if (!cancelled) setRecord(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [exercise.freeDbId]);

  const cue = cueFor(exercise.id);
  const ownSteps = stepsFor(exercise.id);
  const scaling = scalingFor(exercise.id);
  const illustrations = photosFor(exercise.id);
  const steps = ownSteps ?? record?.instructions ?? [];
  const timed = isTimed(exercise);

  const lastLine = (() => {
    if (!numbers?.latest || numbers.lastSets.length === 0) return undefined;
    const sets = numbers.lastSets;
    const unit = timed ? ' s' : '';
    const weights = new Set(sets.map((s) => s.weightKg));
    const reps = sets.map((s) => `${s.reps}${unit}`).join(', ');
    const rir = sets.at(-1)?.rir;
    const body =
      weights.size === 1 && sets[0]?.weightKg !== undefined
        ? `${kg(sets[0].weightKg)} kg × ${reps}`
        : weights.size === 1
          ? reps
          : sets.map((s) => `${s.weightKg === undefined ? '' : `${kg(s.weightKg)}×`}${s.reps}${unit}`).join(', ');
    return `${friendlyDate(numbers.latest.date)} · ${body}${rir === undefined ? '' : ` · RIR ${rir}`}`;
  })();

  const flags = [
    exercise.gripLoad === 'high' ? 'high grip load' : undefined,
    exercise.spinalLoad === 'high' ? 'high spine load' : undefined,
    exercise.isHinge ? 'hinge' : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  const exercisesById = new Map([[exercise.id, exercise]]);

  return (
    <Sheet title={exercise.name} onClose={onClose}>
      {/* The hero: two frames and the body. Ours on the white they were
          drawn on; the upstream photos as they are. */}
      <div className="flex items-stretch gap-2">
        {illustrations.length > 0
          ? illustrations.slice(0, 2).map((src, index) => (
              <div key={src} className="aspect-square min-w-0 flex-1 overflow-hidden rounded-2xl" style={{ background: '#ffffff' }}>
                <img
                  src={src}
                  alt={`${exercise.name}, ${illustrations.length === 1 ? 'muscles worked' : index === 0 ? 'start' : 'finish'}`}
                  loading="lazy"
                  className="size-full object-contain"
                />
              </div>
            ))
          : record && exercise.freeDbId
            ? record.images.slice(0, 2).map((path) => <Photo key={path} freeDbId={exercise.freeDbId as string} path={path} />)
            : null}
        <div className="flex w-16 shrink-0 items-center justify-center rounded-2xl bg-surface p-1.5">
          <MiniMap entries={[{ exerciseId: exercise.id, targetSets: 1 }]} exercisesById={exercisesById} />
        </div>
      </div>

      <p className="mt-3 text-[13.5px] font-medium text-text-dim">
        <span className="font-semibold text-text">{exercise.primaryMuscles.map(muscleName).join(' · ')}</span>
        {exercise.secondaryMuscles.length > 0 && (
          <span> &nbsp;+ {exercise.secondaryMuscles.map((m) => muscleName(m).toLowerCase()).join(', ')}</span>
        )}
      </p>
      <p className="mt-1 text-[13px] font-semibold text-text-dim">
        {[
          STATION_LABEL[exercise.station],
          bar !== undefined ? `bar ${bar} kg` : undefined,
          hasLoadTranslation(exercise) ? `×${exercise.loadMultiplier.toFixed(2)} of ${CABLE_STACK_KG} kg stack` : undefined,
          exercise.loadMode === 'band' ? 'kg is the band rating' : undefined,
          exercise.restSeconds ? `rest ${clock(exercise.restSeconds)}` : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
        {flags.length > 0 && (
          <>
            {' · '}
            <span className="text-volume">{flags.join(' · ')}</span>
          </>
        )}
      </p>

      {/* Your numbers: the estimate, the line, last time. Nothing logged,
          nothing shown. */}
      {numbers && (numbers.points.length > 0 || lastLine) && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          {numbers.latest && numbers.latest.oneRm > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-baseline gap-1.5">
                <span className="font-display text-[24px] leading-none font-extrabold tracking-tight tabular-nums">
                  {kg(numbers.latest.oneRm)} kg
                </span>
                <span className="text-[12px] font-semibold text-text-dim">est. 1-RM</span>
              </span>
              {numbers.delta !== undefined && Math.abs(numbers.delta) >= 0.5 && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold tabular-nums"
                  style={{
                    color: numbers.delta > 0 ? 'var(--color-strength)' : 'var(--color-warn)',
                    background: `color-mix(in oklab, ${numbers.delta > 0 ? 'var(--color-strength)' : 'var(--color-warn)'} 14%, transparent)`,
                  }}
                >
                  {numbers.delta > 0 ? '▲' : '▼'} {kg(Math.abs(numbers.delta))} kg · {Math.round(TREND_DAYS / 7)} wk
                </span>
              )}
            </div>
          )}
          {numbers.points.length > 1 && <Sparkline points={numbers.points.slice(-12)} />}
          {lastLine && <p className="mt-2 text-[12.5px] font-medium text-text-dim tabular-nums">{lastLine}</p>}
        </div>
      )}

      {cue && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <p className="text-[15px] leading-snug font-semibold">{cue}</p>
        </div>
      )}

      {(steps.length > 0 || scaling) && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <p className="text-[14px] font-semibold">How it is performed</p>
          {steps.length > 0 && (
            <ol className="mt-2 flex flex-col gap-1.5">
              {steps.map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-text-dim">
                    {i + 1}
                  </span>
                  <span className="text-[14px] leading-snug text-text-dim">{step}</span>
                </li>
              ))}
            </ol>
          )}
          {/* Only where the movement has no plate to take off. A Copenhagen
              plank is a lever: "do less" has to be spelled out or it becomes
              "do it badly". */}
          {scaling && (
            <div className="mt-3 border-t border-border pt-2">
              {(
                [
                  ['Easier', scaling.easier],
                  ['Harder', scaling.harder],
                ] as const
              ).map(([label, text]) => (
                <p key={label} className="py-1 text-[13px] leading-snug text-text-dim">
                  <span className="font-semibold text-text">{label}. </span>
                  {text}
                </p>
              ))}
            </div>
          )}
          {!ownSteps && record && (
            <p className="mt-3 text-[11px] font-medium text-text-faint">
              {record.name} · free-exercise-db, public domain. Where it disagrees with the cue, the cue wins.
            </p>
          )}
        </div>
      )}

      {record === null && steps.length === 0 && exercise.freeDbId && (
        <p className="mt-3 px-1 text-[12.5px] font-medium text-text-faint">
          Photos and steps not downloaded yet. Fetch them in Settings.
        </p>
      )}

      {/* Retire and delete: two words. Each still says what it would do
          underneath, and only when that is worth knowing. */}
      {standing && (
        <div className="mt-5 flex flex-col items-center gap-2 pb-2">
          <div className="flex items-center gap-6">
            {standing.deleted ? (
              <button
                type="button"
                onClick={() => void setExerciseDeleted(exercise.id, false)}
                aria-label="Restore it"
                className="text-[13px] font-semibold"
              >
                Restore
              </button>
            ) : (
              <>
                {retired !== undefined && (
                  <button
                    type="button"
                    onClick={() => void setExerciseRetired(exercise.id, !retired)}
                    aria-label={retired ? 'Bring it back' : 'Retire this exercise'}
                    className="text-[13px] font-semibold text-text-dim"
                  >
                    {retired ? 'Bring back' : 'Retire'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={standing.workouts.length > 0}
                  onClick={() => {
                    if (!window.confirm(`Delete ${exercise.name}? It can be restored from Settings → Exercises.`)) {
                      return;
                    }
                    void setExerciseDeleted(exercise.id, true);
                  }}
                  aria-label="Delete this exercise"
                  className="text-[13px] font-semibold disabled:opacity-40"
                  style={{ color: 'var(--color-rir-1)' }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
          <p className="text-center text-[11.5px] font-medium text-text-faint">
            {standing.deleted
              ? 'Deleted. Gone from every list; its sets stay in History.'
              : standing.workouts.length > 0
                ? `In ${standing.workouts.join(', ')}. Take it out of ${
                    standing.workouts.length === 1 ? 'that workout' : 'those workouts'
                  } first.`
                : retired
                  ? 'Retired: never offered to new workouts or the coach. Its history stays.'
                  : standing.logged > 0
                    ? `Deleting keeps the history. Its ${standing.logged} logged set${
                        standing.logged === 1 ? '' : 's'
                      } stay in History.`
                    : ''}
          </p>
        </div>
      )}
    </Sheet>
  );
}
