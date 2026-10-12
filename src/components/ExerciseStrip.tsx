import type { Exercise } from '../db/types';
import { ExerciseThumb } from './ExerciseThumb';
import { tap } from '../lib/haptics';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  Horizontal exercise strip — the whole workout in one row, tap to jump.    */
/*                                                                            */
/*  Small on purpose: at 76 px with a station glyph under each, four fit and  */
/*  the rest of the workout was off the edge. At 62 px the whole thing is in  */
/*  view, so a superset is two taps back and forth and "what is left" is a    */
/*  glance. Each tile carries its number; a finished one goes grey with a     */
/*  tick, the one in hand gets the orange ring.                               */
/* -------------------------------------------------------------------------- */

export interface ExerciseProgress {
  logged: number;
  total: number;
}

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
  progress,
  onSelect,
  onAdd,
}: {
  exercises: Exercise[];
  activeId: string | undefined;
  progress: Record<string, ExerciseProgress>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pt-1 pb-1" role="tablist" aria-label="Exercises">
      {exercises.map((exercise, index) => {
        const active = exercise.id === activeId;
        const { logged = 0, total = 0 } = progress[exercise.id] ?? {};
        const done = total > 0 && logged >= total;
        const started = logged > 0 && !done;
        return (
          <button
            key={exercise.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              tap();
              onSelect(exercise.id);
            }}
            className="relative w-[62px] shrink-0 text-left transition-transform active:scale-[0.97]"
            aria-label={`${index + 1}. ${exercise.name}${done ? ', done' : started ? `, ${logged} of ${total} sets` : ''}`}
          >
            <HapticTick radius={14} />
            <span
              className="relative flex size-[62px] items-center justify-center overflow-hidden rounded-2xl bg-surface-2"
              style={{
                outline: active ? '2.5px solid var(--color-volume)' : undefined,
                outlineOffset: 1.5,
                filter: done ? 'grayscale(1) opacity(0.6)' : undefined,
              }}
            >
              <ExerciseThumb
                exercise={exercise}
                fallback={<span className="text-[15px] font-bold text-text-dim">{initials(exercise.name)}</span>}
              />
              {/* The number, or the tick once every set is in. Orange while
                  it is half done, so the strip also says where you got to. */}
              <span
                className="absolute bottom-1 left-1 flex size-[18px] items-center justify-center rounded-full text-[10.5px] font-extrabold"
                style={{
                  background: done
                    ? 'var(--color-cta)'
                    : started
                      ? 'var(--color-volume)'
                      : 'var(--color-surface)',
                  color: done || started ? 'var(--color-bg)' : 'var(--color-text)',
                }}
                aria-hidden="true"
              >
                {done ? '✓' : index + 1}
              </span>
            </span>
            <span
              className={`mt-1 block truncate text-[10.5px] leading-tight ${
                active ? 'font-bold text-text' : done ? 'font-medium text-text-faint' : 'font-semibold text-text-dim'
              }`}
              title={exercise.name}
            >
              {exercise.name}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="w-[62px] shrink-0 text-left"
        aria-label="Add an exercise"
      >
        <span className="flex size-[62px] items-center justify-center rounded-2xl bg-surface text-2xl leading-none text-text-dim">
          +
        </span>
        <span className="mt-1 block text-[10.5px] font-semibold text-text-dim">Add</span>
      </button>
    </div>
  );
}
