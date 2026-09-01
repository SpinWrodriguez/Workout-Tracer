import type { Exercise } from '../db/types';
import { STATION_LABEL } from '../db/seed/exercises';

/* -------------------------------------------------------------------------- */
/*  Horizontal exercise strip — spec §4: thumbnails at the top of the session  */
/*  screen, tap to switch, never a dropdown.                                   */
/*                                                                            */
/*  Phase 1 has no photos (free-exercise-db enrichment is §9, a later phase),  */
/*  so the thumbnail is a station glyph over the exercise's initials.          */
/* -------------------------------------------------------------------------- */

const STATION_GLYPH: Record<Exercise['station'], string> = {
  free_bar: 'BAR',
  smith: 'SM',
  cable: 'CBL',
  kettlebell: 'KB',
  bodyweight: 'BW',
  band: 'BND',
  landmine: 'LM',
};

function initials(name: string): string {
  return name
    .replace(/[()]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function ExerciseStrip({
  exercises,
  activeId,
  loggedCounts,
  onSelect,
  onAdd,
}: {
  exercises: Exercise[];
  activeId: string | undefined;
  loggedCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
      {exercises.map((exercise) => {
        const active = exercise.id === activeId;
        const logged = loggedCounts[exercise.id] ?? 0;
        return (
          <button
            key={exercise.id}
            type="button"
            onClick={() => onSelect(exercise.id)}
            className={`relative w-[76px] shrink-0 rounded-2xl p-2 text-left ${
              active ? 'bg-surface-2' : 'bg-surface'
            }`}
          >
            <span
              className={`flex h-11 items-center justify-center rounded-xl text-base font-bold ${
                active ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
              }`}
            >
              {initials(exercise.name)}
            </span>
            <span
              className={`mt-1.5 block truncate text-[10px] leading-tight font-medium ${
                active ? 'text-text' : 'text-text-dim'
              }`}
              title={exercise.name}
            >
              {exercise.name}
            </span>
            <span className="mt-0.5 block text-[9px] font-medium text-text-faint">
              {STATION_GLYPH[exercise.station]}
            </span>
            {logged > 0 && (
              <span
                className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-bg"
                style={{ background: 'var(--color-volume)' }}
              >
                {logged}
              </span>
            )}
            <span className="sr-only">{STATION_LABEL[exercise.station]}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex w-[76px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl bg-surface"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-lg leading-none text-text-dim">
          +
        </span>
        <span className="text-[10px] font-medium text-text-dim">Add</span>
      </button>
    </div>
  );
}
