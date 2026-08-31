import { useMemo, useState } from 'react';
import type { Exercise, MuscleId, Station } from '../db/types';
import { STATION_LABEL, STATION_ORDER } from '../db/seed/exercises';
import { MUSCLES, muscleName } from '../db/seed/muscles';
import { Chip } from './Layout';
import { Sheet } from './Sheet';

/**
 * The equipment list is fixed and small (spec §7), so this is a filtered list
 * of the curated table — not a search against an external catalogue.
 */
export function ExercisePicker({
  exercises,
  selectedIds,
  onPick,
  onClose,
}: {
  exercises: Exercise[];
  selectedIds: string[];
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  const [station, setStation] = useState<Station | 'all'>('all');
  const [muscle, setMuscle] = useState<MuscleId | 'all'>('all');

  const filtered = useMemo(() => {
    const list = exercises.filter((e) => {
      if (station !== 'all' && e.station !== station) return false;
      if (
        muscle !== 'all' &&
        !e.primaryMuscles.includes(muscle) &&
        !e.secondaryMuscles.includes(muscle)
      ) {
        return false;
      }
      return true;
    });
    return list.sort(
      (a, b) =>
        STATION_ORDER.indexOf(a.station) - STATION_ORDER.indexOf(b.station) ||
        a.name.localeCompare(b.name),
    );
  }, [exercises, station, muscle]);

  const grouped = useMemo(() => {
    const map = new Map<Station, Exercise[]>();
    for (const e of filtered) {
      const list = map.get(e.station) ?? [];
      list.push(e);
      map.set(e.station, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const usedMuscles = useMemo(() => {
    const ids = new Set<string>();
    for (const e of exercises) {
      for (const m of e.primaryMuscles) ids.add(m);
      for (const m of e.secondaryMuscles) ids.add(m);
    }
    return MUSCLES.filter((m) => ids.has(m.id));
  }, [exercises]);

  return (
    <Sheet
      title="Add exercise"
      onClose={onClose}
      header={
        <>
          <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
            <Chip active={station === 'all'} onClick={() => setStation('all')} tone="plain">
              All kit
            </Chip>
            {STATION_ORDER.map((s) => (
              <Chip key={s} active={station === s} onClick={() => setStation(s)} tone="plain">
                {STATION_LABEL[s]}
              </Chip>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4">
            <Chip active={muscle === 'all'} onClick={() => setMuscle('all')}>
              All muscles
            </Chip>
            {usedMuscles.map((m) => (
              <Chip key={m.id} active={muscle === m.id} onClick={() => setMuscle(m.id)}>
                {m.name}
              </Chip>
            ))}
          </div>
        </>
      }
    >
      {grouped.length === 0 && <p className="py-6 text-text-dim">-- no matching exercises</p>}
      {grouped.map(([s, list]) => (
        <div key={s} className="mb-5">
          <h3 className="label mb-2">{STATION_LABEL[s]}</h3>
          <div className="overflow-hidden rounded-2xl bg-surface">
            {list.map((exercise, i) => {
              const already = selectedIds.includes(exercise.id);
              return (
                <button
                  key={exercise.id}
                  type="button"
                  onClick={() => onPick(exercise.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                    i > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[15px] font-medium ${
                        already ? 'text-text-faint' : 'text-text'
                      }`}
                    >
                      {exercise.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-text-dim">
                      {exercise.primaryMuscles.map(muscleName).join(' · ')}
                      {exercise.loadMultiplier !== 1 &&
                        ` · ×${exercise.loadMultiplier.toFixed(2)}`}
                      {exercise.loadMode === 'rpe_only' && ' · RPE only'}
                    </span>
                  </span>
                  {exercise.gripLoad === 'high' && (
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-bg"
                      style={{ background: 'var(--color-volume)' }}
                      title="High grip load — the Phase 3 golf rule watches this"
                    >
                      GRIP
                    </span>
                  )}
                  {exercise.isHinge && (
                    <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-dim">
                      HINGE
                    </span>
                  )}
                  <span className="shrink-0 text-text-dim">{already ? '✓' : '+'}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
