import { db } from '../db/db';
import { EXERCISES } from '../db/seed/exercises';

/* -------------------------------------------------------------------------- */
/*  free-exercise-db enrichment — spec §9, step 2.                            */
/*                                                                            */
/*  Public domain (Unlicense), no key, no rate limit. It supplies descriptions */
/*  and photos for exercises WE already chose; it is never the source of the   */
/*  selection, and its `equipment` field is never used to filter — the         */
/*  curated `station` field is the authority.                                  */
/*                                                                            */
/*  Fetched once and stored in Dexie. It is not a runtime dependency: the      */
/*  garage has patchy wifi and every screen has to work with an empty cache.   */
/* -------------------------------------------------------------------------- */

export const FREE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

export const FREE_DB_IMAGE_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

/**
 * Only the fields worth keeping. `force`, `mechanic` and `equipment` are
 * incomplete upstream, so they are nullable here and no logic branches on them.
 */
export interface FreeDbRecord {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string | null;
  images: string[];
}

export function imageUrl(path: string): string {
  return `${FREE_DB_IMAGE_BASE}${path}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function normaliseRecord(raw: unknown): FreeDbRecord | undefined {
  if (!isRecord(raw)) return undefined;
  const id = strOrNull(raw.id);
  if (!id) return undefined;
  return {
    id,
    name: strOrNull(raw.name) ?? id.replace(/_/g, ' '),
    force: strOrNull(raw.force),
    level: strOrNull(raw.level),
    mechanic: strOrNull(raw.mechanic),
    equipment: strOrNull(raw.equipment),
    primaryMuscles: strArray(raw.primaryMuscles),
    secondaryMuscles: strArray(raw.secondaryMuscles),
    instructions: strArray(raw.instructions),
    category: strOrNull(raw.category),
    images: strArray(raw.images),
  };
}

/** The freeDbId values the curated table actually asks for. */
export function mappedIds(): string[] {
  return [...new Set(EXERCISES.map((e) => e.freeDbId).filter((id): id is string => Boolean(id)))];
}

export interface EnrichReport {
  /** Records upstream, before filtering. */
  scanned: number;
  /** Curated exercises with a freeDbId. */
  requested: number;
  stored: number;
  /** Hand-mapped ids that upstream does not have — a mapping bug, not a miss. */
  unknownIds: string[];
  /** Curated exercises deliberately left unmapped; they fall back to a cue. */
  unmappedExercises: number;
}

/**
 * Selects only the ~45 records the curated table points at. Storing all 876
 * would be a megabyte of JSON to carry around for no benefit (§9: "you only
 * need ~50"), and filtering here is what surfaces a bad hand-mapped id.
 */
export function selectRecords(raw: unknown): { records: FreeDbRecord[]; unknownIds: string[] } {
  const wanted = new Set(mappedIds());
  const list = Array.isArray(raw) ? raw : [];
  const records: FreeDbRecord[] = [];
  const found = new Set<string>();

  for (const entry of list) {
    const record = normaliseRecord(entry);
    if (!record || !wanted.has(record.id)) continue;
    records.push(record);
    found.add(record.id);
  }

  return {
    records,
    unknownIds: [...wanted].filter((id) => !found.has(id)).sort(),
  };
}

export async function fetchAndStoreFreeDb(
  fetchImpl: typeof fetch = fetch,
): Promise<EnrichReport> {
  const response = await fetchImpl(FREE_DB_URL, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`free-exercise-db returned ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as unknown;
  const scanned = Array.isArray(raw) ? raw.length : 0;
  const { records, unknownIds } = selectRecords(raw);

  // Merge rather than replace: cached image blobs must survive a refetch.
  await db.transaction('rw', db.freeDbCache, async () => {
    const existing = await db.freeDbCache.bulkGet(records.map((r) => r.id));
    const blobsById = new Map(
      existing
        .filter((row) => row !== undefined)
        .map((row) => [row.id, row.imageBlobs]),
    );
    await db.freeDbCache.bulkPut(
      records.map((record) => ({
        id: record.id,
        json: record,
        imageBlobs: blobsById.get(record.id),
      })),
    );
  });

  return {
    scanned,
    requested: mappedIds().length,
    stored: records.length,
    unknownIds,
    unmappedExercises: EXERCISES.filter((e) => !e.freeDbId).length,
  };
}

export async function getRecord(freeDbId: string): Promise<FreeDbRecord | undefined> {
  const row = await db.freeDbCache.get(freeDbId);
  return row ? (row.json as FreeDbRecord) : undefined;
}

export async function cachedCount(): Promise<number> {
  return db.freeDbCache.count();
}

/* --- images ---------------------------------------------------------------- */

/**
 * Cached as blobs on first view, not on import — §9 is explicit that pulling
 * all 2,600 upstream images is unnecessary when you only ever look at ~50.
 */
export async function loadImageBlob(
  freeDbId: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob | undefined> {
  const row = await db.freeDbCache.get(freeDbId);
  const cached = row?.imageBlobs?.[path];
  if (cached) return cached;
  if (!row) return undefined;

  try {
    const response = await fetchImpl(imageUrl(path));
    if (!response.ok) return undefined;
    const blob = await response.blob();
    await db.freeDbCache.update(freeDbId, {
      imageBlobs: { ...(row.imageBlobs ?? {}), [path]: blob },
    });
    return blob;
  } catch {
    // Offline with nothing cached is a normal state, not an error worth showing.
    return undefined;
  }
}

export async function clearFreeDb(): Promise<void> {
  await db.freeDbCache.clear();
}
