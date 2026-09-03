import type { Exercise } from '../db/types';
import { STATION_LABEL } from '../db/seed/exercises';
import { ExerciseThumb } from './ExerciseThumb';
import { regionColor } from '../lib/region';

/* -------------------------------------------------------------------------- */
/*  Horizontal exercise strip — spec §4: thumbnails at the top of the session  */
/*  screen, tap to switch, never a dropdown.                                   */
/*                                                                            */
/*  The thumbnail is the exercise's own photo — our illustration for the       */
/*  eleven movements nothing upstream has, the cached reference photo for the  */
/*  rest. Initials over a station glyph are the fallback, which is what this   */
/*  showed for every exercise before there were any photos at all: a strip of  */
/*  LS / CH / LL tells you nothing you cannot read in the label underneath.    */
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
            className={`relative w-[76px] shrink-0 rounded-2xl p-2 text-left transition-transform active:scale-[0.97] ${
              active ? 'bg-surface-2' : 'bg-surface'
            }`}
          >
            <span
              className="flex h-14 items-center justify-center overflow-hidden rounded-xl"
              /* Tinted by what it trains, so the strip has some colour in it
                 and the tint means something: upper, lower or core. */
              style={{
                background: active ? regionColor(exercise) : 'var(--color-surface-2)',
                boxShadow: active ? `0 0 0 2px ${regionColor(exercise)}` : undefined,
              }}
            >
              <ExerciseThumb
                exercise={exercise}
                fallback={
                  <span
                    className={`text-base font-bold ${active ? 'text-bg' : 'text-text-dim'}`}
                  >
                    {initials(exercise.name)}
                  </span>
                }
              />
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
