import { useState } from 'react';
import type { BlockExercise, DaySlot, Exercise } from '../db/types';
import { tap } from '../lib/haptics';
import { planWeekVolume } from '../lib/planLevels';
import { VOLUME_HIGH, VOLUME_LOW, volumeRows, type MuscleVolumeRow } from '../lib/volume';
import { HapticTick } from './HapticTick';
import { Label } from './Layout';
import { Silhouette } from './Silhouette';
import { plannedSetsPerMuscle } from '../lib/volume';

/* -------------------------------------------------------------------------- */
/*  Levels for a plan before it runs: a week of the order on the body map,    */
/*  with the muscles that would go over or under. Live as the order is       */
/*  picked, so the week is judged while it is being made and not in week 3.  */
/* -------------------------------------------------------------------------- */

function statusColor(status: MuscleVolumeRow['status']): string | undefined {
  switch (status) {
    case 'low':
      return 'var(--color-warn)';
    case 'high':
      return 'var(--color-rir-1)';
    case 'ok':
      return 'var(--color-muscle)';
    default:
      return undefined;
  }
}

export function PlanLevels({
  order,
  entries,
  exercisesById,
  defaultOpen = false,
  title = 'Week in Levels',
  single = false,
}: {
  /** The workouts a week holds: the order. */
  order: DaySlot[];
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  defaultOpen?: boolean;
  /** 'Week in Levels' for a plan; a workout being built says what it is. */
  title?: string;
  /** One workout rather than a week: the summary names its top muscles instead of the week's range. */
  single?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const volume = planWeekVolume(order, entries, exercisesById);
  const rows = volumeRows(volume).filter((row) => row.sets > 0);
  const over = rows.filter((row) => row.status === 'high');
  const under = rows.filter((row) => row.status === 'low');
  const summary =
    rows.length === 0
      ? single
        ? 'Nothing in it yet'
        : 'Pick workouts to see the week'
      : single
        ? rows.slice(0, 4).map((r) => `${r.name.toLowerCase()} ${r.sets}`).join(' · ')
        : over.length > 0
        ? `${over.map((r) => r.name).join(', ')} over ${VOLUME_HIGH} sets`
        : `${rows.length} muscles · ${under.length} under ${VOLUME_LOW} sets · none over ${VOLUME_HIGH}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          tap();
          setOpen(!open);
        }}
        aria-expanded={open}
        className="relative flex w-full items-center justify-between gap-3 py-1 text-left"
      >
        <HapticTick radius={8} />
        <span className="min-w-0 flex-1">
          <span className="card-title">{title}</span>
          <span className="mt-0.5 block truncate text-[12px] font-medium text-text-dim">{summary}</span>
        </span>
        {single && rows.length > 0 && (
          <MiniMap entries={entries.filter((row) => order.includes(row.daySlot))} exercisesById={exercisesById} />
        )}
        <span className="text-text-dim" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && rows.length > 0 && (
        <div className="mt-2">
          <Silhouette volume={volume} />
          <ul className="mt-2 grid grid-cols-2 gap-x-4" aria-label="Sets per muscle in a week of the plan">
            {rows.map((row) => (
              <li
                key={row.muscleId}
                className="flex items-baseline justify-between gap-2 border-t border-border py-1 text-[12.5px]"
              >
                <span className="truncate font-medium">{row.name}</span>
                <span
                  className="shrink-0 font-semibold tabular-nums"
                  /* The under/over colours are weekly thresholds; one workout is not a week. */
                  style={{ color: single ? undefined : statusColor(row.status) }}
                >
                  {row.sets}
                </span>
              </li>
            ))}
          </ul>
          <Label className="mt-2 block">
            {single
              ? 'Sets in this workout, primary muscles counted in full and secondary in part.'
              : `Sets a week, primary muscles counted in full and secondary in part. Blue is in range, amber under ${VOLUME_LOW}, red over ${VOLUME_HIGH}.`}
          </Label>
        </div>
      )}
    </div>
  );
}


/** One workout on the body map, thumbnail-sized, for a list row. */
export function MiniMap({
  entries,
  exercisesById,
}: {
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
}) {
  if (entries.length === 0) return null;
  return (
    <span className="w-16 shrink-0" aria-hidden="true">
      <Silhouette volume={plannedSetsPerMuscle(entries, exercisesById)} compact />
    </span>
  );
}
