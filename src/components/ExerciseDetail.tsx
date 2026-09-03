import { useEffect, useState } from 'react';
import type { Exercise } from '../db/types';
import { STATION_LABEL } from '../db/seed/exercises';
import { muscleName } from '../db/seed/muscles';
import { cueFor, stepsFor } from '../db/seed/cues';
import { photosFor } from '../db/seed/photos';
import { getRecord, loadImageBlob, type FreeDbRecord } from '../lib/freeDb';
import { hasLoadTranslation } from '../lib/load';
import { Chip, Label } from './Layout';
import { Sheet } from './Sheet';

/* -------------------------------------------------------------------------- */
/*  Exercise detail — spec §9 step 2, the enrichment readout.                  */
/*                                                                            */
/*  The garage cue comes first and always shows; the upstream photo and        */
/*  instructions are a bonus that may be missing, stale or absent entirely.    */
/*  Nothing here needs the network once an image has been viewed.              */
/* -------------------------------------------------------------------------- */

function Photo({ freeDbId, path }: { freeDbId: string; path: string }) {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadImageBlob(freeDbId, path).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [freeDbId, path]);

  return (
    <div className="aspect-4/3 flex-1 overflow-hidden rounded-xl bg-surface-2">
      {url && <img src={url} alt="" className="size-full object-cover" />}
    </div>
  );
}

export function ExerciseDetail({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
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
  const steps = stepsFor(exercise.id);
  const illustrations = photosFor(exercise.id);

  return (
    <Sheet title={exercise.name} onClose={onClose}>
      {cue && (
        <div className="rounded-2xl bg-surface p-4">
          <Label>In this gym</Label>
          <p className="mt-1.5 text-[15px] leading-snug">{cue}</p>
        </div>
      )}

      <div className="mt-3 rounded-2xl bg-surface p-4">
        <Label>Setup</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone="plain">{STATION_LABEL[exercise.station]}</Chip>
          {exercise.barWeight !== undefined && <Chip tone="plain">bar {exercise.barWeight} kg</Chip>}
          {hasLoadTranslation(exercise) && (
            <Chip tone="plain">×{exercise.loadMultiplier.toFixed(2)} effective</Chip>
          )}
          {exercise.attachment && <Chip tone="plain">{exercise.attachment.replace(/_/g, ' ')}</Chip>}
          {/* Skip the load-mode chip when the station already says it — a
              bodyweight exercise showed "Bodyweight" twice. */}
          {exercise.loadMode !== 'weight' && exercise.loadMode !== exercise.station && (
            <Chip tone="plain">{exercise.loadMode.replace('_', ' ')}</Chip>
          )}
          {exercise.gripLoad !== 'none' && (
            <Chip tone="volume" active>
              {exercise.gripLoad} grip load
            </Chip>
          )}
          {exercise.isHinge && (
            <Chip tone="volume" active>
              hinge
            </Chip>
          )}
        </div>

        <Label className="mt-4 block">Primary</Label>
        <p className="mt-1 text-[14px] font-medium">
          {exercise.primaryMuscles.map(muscleName).join(' · ')}
        </p>
        {exercise.secondaryMuscles.length > 0 && (
          <>
            <Label className="mt-3 block">Secondary</Label>
            <p className="mt-1 text-[14px] font-medium text-text-dim">
              {exercise.secondaryMuscles.map(muscleName).join(' · ')}
            </p>
          </>
        )}
      </div>

      {record && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Reference</Label>
            <Label>{record.name}</Label>
          </div>

          {record.images.length > 0 && exercise.freeDbId && (
            <div className="mt-3 flex gap-2">
              {record.images.slice(0, 2).map((path) => (
                <Photo key={path} freeDbId={exercise.freeDbId as string} path={path} />
              ))}
            </div>
          )}

          {record.instructions.length > 0 && (
            <ol className="mt-3">
              {record.instructions.map((step, i) => (
                <li key={step} className="flex gap-2.5 py-1">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-text-dim">
                    {i + 1}
                  </span>
                  <span className="text-[14px] leading-snug text-text-dim">{step}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-3 text-[11px] font-medium text-text-faint">
            Description and photos from free-exercise-db (public domain). They describe the
            movement, not this rack — where the two disagree, the cue above wins.
          </p>
        </div>
      )}

      {/* Written out here because nothing upstream describes this movement.
          Seven exercises are in that position and a photo of a near-enough
          one would teach the wrong thing, so they carry their own steps. */}
      {steps && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <Label>How it is performed</Label>

          {/* Ours, for the movements nothing upstream illustrates. Two
              frames, start and finish, on the white they were drawn on so
              the cut-out figure does not float on a dark card. */}
          {illustrations.length > 0 && (
            <div className="mt-2 flex gap-2">
              {illustrations.map((src, index) => (
                <div
                  key={src}
                  className="aspect-4/3 flex-1 overflow-hidden rounded-xl"
                  style={{ background: '#ffffff' }}
                >
                  <img
                    src={src}
                    alt={`${exercise.name}, ${index === 0 ? 'start' : 'finish'}`}
                    loading="lazy"
                    className="size-full object-contain"
                  />
                </div>
              ))}
            </div>
          )}
          <ol className="mt-2">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2.5 py-1">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-bold text-text-dim">
                  {i + 1}
                </span>
                <span className="text-[14px] leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {record === null && !steps && (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <Label>Reference</Label>
          <p className="mt-1.5 text-[13px] text-text-dim">
            {exercise.freeDbId
              ? 'Not downloaded yet — fetch descriptions and photos in Settings.'
              : 'Nothing upstream matches this movement, so there is no photo. The cue above is it.'}
          </p>
        </div>
      )}
    </Sheet>
  );
}
