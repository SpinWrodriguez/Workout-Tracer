import { useState } from 'react';
import type { BlockExercise, DaySlot, Exercise } from '../db/types';
import { tap } from '../lib/haptics';
import { planWeekVolume } from '../lib/planLevels';
import { VOLUME_HIGH, VOLUME_LOW, volumeRows, type MuscleVolumeRow } from '../lib/volume';
import { HapticTick } from './HapticTick';
import { Label } from './Layout';
import { Silhouette } from './Silhouette';

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
}: {
  /** The workouts a week holds: the order, less the optional ones on short weeks. */
  order: DaySlot[];
  entries: BlockExercise[];
  exercisesById: Map<string, Exercise>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const volume = planWeekVolume(order, entries, exercisesById);
  const rows = volumeRows(volume).filter((row) => row.sets > 0);
  const over = rows.filter((row) => row.status === 'high');
  const under = rows.filter((row) => row.status === 'low');
  const summary =
    order.length === 0
      ? 'Pick workouts to see the week'
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
          <span className="card-title">Week in Levels</span>
          <span className="mt-0.5 block truncate text-[12px] font-medium text-text-dim">{summary}</span>
        </span>
        <span className="text-text-dim" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && order.length > 0 && (
        <div className="mt-2">
          <Silhouette volume={volume} />
          <ul className="mt-2 grid grid-cols-2 gap-x-4" aria-label="Sets per muscle in a week of the plan">
            {rows.map((row) => (
              <li
                key={row.muscleId}
                className="flex items-baseline justify-between gap-2 border-t border-border py-1 text-[12.5px]"
              >
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 font-semibold tabular-nums" style={{ color: statusColor(row.status) }}>
                  {row.sets}
                </span>
              </li>
            ))}
          </ul>
          <Label className="mt-2 block">
            Sets a week, primary muscles counted in full and secondary in part. Blue is in range,
            amber under {VOLUME_LOW}, red over {VOLUME_HIGH}.
          </Label>
        </div>
      )}
    </div>
  );
}

