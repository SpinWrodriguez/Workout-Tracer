import { useEffect, useState, type ReactNode } from 'react';
import type { Exercise } from '../db/types';
import { photosFor } from '../db/seed/photos';
import { getRecord, loadImageBlob } from '../lib/freeDb';

/* -------------------------------------------------------------------------- */
/*  One exercise, one picture.                                               */
/*                                                                           */
/*  Three sources, in this order, because they are not equally true:         */
/*   1. Our own illustration, for the eleven movements nothing upstream has.  */
/*      Shipped in public/, so it needs no network and no cache.             */
/*   2. The cached upstream reference photo, if the enrichment has been run   */
/*      and that record carries images.                                      */
/*   3. Nothing — the caller's fallback, which is the initials the strip used */
/*      to show. Offline on a fresh install is a normal state, not a fault.  */
/*                                                                           */
/*  Fetching an image caches it as a blob on first view, which is deliberate  */
/*  (§9): a strip of six exercises pulls six images, not the 2,600 upstream.  */
/* -------------------------------------------------------------------------- */

/*
 * The first frame for an exercise, or nothing.
 *
 * The local illustration is derived during render rather than put in state —
 * it is a pure function of the id — and state holds only what had to be
 * fetched, tagged with the exercise it belongs to. Untagged, switching
 * exercises showed the previous one's photo until the new blob resolved.
 */
function useExercisePhoto(exercise: Exercise): string | undefined {
  const local = photosFor(exercise.id)[0];
  const [fetched, setFetched] = useState<{ id: string; url: string } | undefined>(undefined);
  const { id, freeDbId } = exercise;

  useEffect(() => {
    if (local || !freeDbId) return;

    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      const record = await getRecord(freeDbId);
      const path = record?.images[0];
      if (cancelled || !path) return;
      const blob = await loadImageBlob(freeDbId, path);
      /* jsdom has no object URLs, and a thumbnail is not worth a crash in a
         test that is about something else. */
      if (cancelled || !blob || typeof URL.createObjectURL !== 'function') return;
      objectUrl = URL.createObjectURL(blob);
      setFetched({ id, url: objectUrl });
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, local, freeDbId]);

  return local ?? (fetched?.id === id ? fetched.url : undefined);
}

export function ExerciseThumb({
  exercise,
  fallback,
  className = '',
}: {
  exercise: Exercise;
  /** What to show with no photo — initials, a glyph, whatever fits. */
  fallback: ReactNode;
  className?: string;
}) {
  const url = useExercisePhoto(exercise);
  if (!url) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      /* The subject is a person mid-movement, so the top of the frame is the
         part worth keeping when a square crop has to lose something. */
      className={`size-full object-cover object-top ${className}`}
    />
  );
}
