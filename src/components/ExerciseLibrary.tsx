import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { STATION_LABEL, STATION_ORDER } from '../db/seed/exercises';
import { muscleName } from '../db/seed/muscles';
import { readExerciseStandings, type ExerciseStanding } from '../lib/exerciseStandings';
import { friendlyDate } from '../lib/format';
import { Card, Chip } from './Layout';
import { Sheet } from './Sheet';
import { ExerciseDetail } from './ExerciseDetail';

/* -------------------------------------------------------------------------- */
/*  The whole exercise table, as a thing to manage rather than to pick from.   */
/*                                                                            */
/*  Every other list in the app is a picker: tapping a row adds it or charts   */
/*  it. This one answers "what is on my shelf and what is it doing" — in a     */
/*  workout, never logged, retired, deleted — and a tap opens the sheet where  */
/*  each of those can be changed.                                             */
/* -------------------------------------------------------------------------- */

const FILTERS = ['all', 'never', 'workouts', 'retired', 'deleted'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  never: 'Never used',
  workouts: 'In workouts',
  retired: 'Retired',
  deleted: 'Deleted',
};

function matches(row: ExerciseStanding, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      // Deleted is gone from every list unless asked for by name.
      return !row.deleted;
    case 'never':
      return !row.deleted && row.sets === 0;
    case 'workouts':
      return !row.deleted && row.workouts.length > 0;
    case 'retired':
      return !row.deleted && row.retired;
    case 'deleted':
      return row.deleted;
  }
}

function Tag({ children, color }: { children: string; color: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {children}
    </span>
  );
}

function Row({ row, onOpen }: { row: ExerciseStanding; onOpen: () => void }) {
  const { exercise } = row;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-t border-border py-2.5 pl-4 pr-3 text-left first:border-t-0"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[15px] font-medium">{exercise.name}</span>
          {row.deleted && <Tag color="var(--color-text-dim)">Deleted</Tag>}
          {!row.deleted && row.sets === 0 && <Tag color="var(--color-volume)">Never used</Tag>}
          {!row.deleted && row.retired && <Tag color="var(--color-text-dim)">Retired</Tag>}
          {!row.deleted && row.workouts.length > 0 && (
            <Tag color="var(--color-muscle)">
              {row.workouts.length === 1 ? 'In 1 workout' : `In ${row.workouts.length} workouts`}
            </Tag>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-text-dim">
          {row.sets > 0
            ? `${row.sets} set${row.sets === 1 ? '' : 's'} logged · last ${friendlyDate(
                row.lastDate as string,
              )}`
            : exercise.primaryMuscles.map(muscleName).join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-text-faint" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export function ExerciseLibrary({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const rows = useLiveQuery(() => readExerciseStandings(), []);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f] = (rows ?? []).filter((row) => matches(row, f)).length;
    return out;
  }, [rows]);

  const grouped = useMemo(() => {
    const shown = (rows ?? []).filter((row) => matches(row, filter));
    return STATION_ORDER.map(
      (station) => [station, shown.filter((row) => row.exercise.station === station)] as const,
    ).filter(([, list]) => list.length > 0);
  }, [rows, filter]);

  const open = rows?.find((row) => row.exercise.id === openId);

  return (
    <>
      <Sheet
        title="Exercises"
        onClose={onClose}
        header={
          <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)} tone="plain">
                {`${FILTER_LABEL[f]} ${rows ? counts[f] : ''}`.trim()}
              </Chip>
            ))}
          </div>
        }
      >
        {rows !== undefined && grouped.length === 0 && (
          <p className="py-6 text-text-dim">-- nothing here</p>
        )}
        {grouped.map(([station, list]) => (
          <div key={station} className="mb-5">
            <h3 className="label mb-2">{STATION_LABEL[station]}</h3>
            <div className="overflow-hidden rounded-2xl bg-surface">
              {list.map((row) => (
                <Row key={row.exercise.id} row={row} onOpen={() => setOpenId(row.exercise.id)} />
              ))}
            </div>
          </div>
        ))}
        <p className="text-[12px] font-medium text-text-dim">
          Tap an exercise to see it, retire it or delete it. Never used means no set has ever been
          logged against it.
        </p>
      </Sheet>

      {open && <ExerciseDetail exercise={open.exercise} onClose={() => setOpenId(undefined)} />}
    </>
  );
}

/** The way in from Settings, with the shelf summed up while it is shut. */
export function ExerciseLibraryCard() {
  const [open, setOpen] = useState(false);
  const rows = useLiveQuery(() => readExerciseStandings(), []);
  const live = (rows ?? []).filter((row) => !row.deleted);
  const never = live.filter((row) => row.sets === 0).length;

  return (
    <>
      <Card title="Exercises">
        <p className="text-[13px] font-medium text-text-dim">
          {rows === undefined
            ? '--'
            : `${live.length} exercises · ${never} never used · ${
                live.filter((row) => row.retired).length
              } retired`}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-full bg-surface-2 py-2.5 text-[13px] font-semibold"
        >
          Open the exercise list
        </button>
      </Card>
      {open && <ExerciseLibrary onClose={() => setOpen(false)} />}
    </>
  );
}
