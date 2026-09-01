import { BACKUP_VERSION, db } from '../db/db';
import { LAST_SYNC_KEY } from '../db/settings';
import type {
  Activity,
  Block,
  BlockExercise,
  BodyWeight,
  Exercise,
  GolfDay,
  Goals,
  NutritionDay,
  SavedMeal,
  Session,
  SetLog,
  SettingRow,
} from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Backup envelope + migration — spec §10.                                   */
/*                                                                            */
/*  Import is written before export on purpose: loading the real 77-day        */
/*  nutrition dataset on day one means every chart built later has real data   */
/*  in it from the start.                                                     */
/*                                                                            */
/*  Import is idempotent and ADDITIVE. Every table is keyed on its natural     */
/*  key and written with bulkPut, so re-importing the same file updates rows   */
/*  in place instead of duplicating them. Nothing is ever deleted on import.   */
/* -------------------------------------------------------------------------- */

export interface BackupV3 {
  _version: number;
  _exportedAt: string;
  shared: {
    bodyWeight: BodyWeight[];
    activity: Activity[];
    goals: Record<string, Omit<Goals, 'date'>>;
  };
  workout: {
    exercise: Exercise[];
    block: Block[];
    blockExercise: BlockExercise[];
    session: Session[];
    setLog: SetLog[];
    /* Added after the §10 envelope was written. The version stays at 3: the
       sections are additive, older files import fine because every section is
       optional, and older readers ignore what they do not know. A bump is for
       a change that breaks a reader. */
    settings: SettingRow[];
    golfDay: GolfDay[];
  };
}

export interface ImportReport {
  sourceVersion: number;
  counts: Record<string, number>;
  warnings: string[];
}

/* --- shape helpers -------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Deterministic fallback key, so a row with no id still round-trips once. */
function stableKey(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `k${(h >>> 0).toString(36)}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The nutrition app's own export shapes are not fully pinned down, so every
 * reader here accepts both an array of rows and a date-keyed map. Guessing
 * wrong on a real 77-day file is not worth the tidier code.
 */
function rows<T>(
  value: unknown,
  fromEntry: (key: string, entry: unknown) => T | T[] | undefined,
  fromRow: (row: Record<string, unknown>) => T | undefined,
): T[] {
  const out: T[] = [];
  const push = (v: T | T[] | undefined) => {
    if (v === undefined) return;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  };
  if (Array.isArray(value)) {
    for (const row of value) if (isRecord(row)) push(fromRow(row));
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) push(fromEntry(key, entry));
  }
  return out;
}

/* --- normalisers ---------------------------------------------------------- */

export function normaliseBodyWeight(value: unknown): BodyWeight[] {
  const seen = new Map<string, BodyWeight>();
  const add = (date: string | undefined, kg: number | undefined) => {
    if (!date || !ISO_DATE.test(date) || kg === undefined) return;
    // Later entries for the same date win, matching upsert-on-date.
    seen.set(date.slice(0, 10), { date: date.slice(0, 10), kg });
  };

  rows<BodyWeight>(
    value,
    (key, entry) => {
      if (isRecord(entry)) add(str(entry.date) ?? key, num(entry.kg) ?? num(entry.weight));
      else add(key, num(entry));
      return undefined;
    },
    (row) => {
      add(str(row.date), num(row.kg) ?? num(row.weight));
      return undefined;
    },
  );
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function normaliseActivity(value: unknown, source: Activity['source']): Activity[] {
  const seen = new Map<string, Activity>();
  const add = (date: string | undefined, raw: unknown) => {
    if (!isRecord(raw)) return;
    const d = str(raw.date) ?? date;
    if (!d || !ISO_DATE.test(d)) return;
    const name = str(raw.name) ?? str(raw.label) ?? 'Activity';
    const kcal = num(raw.kcal) ?? num(raw.calories) ?? num(raw.burn) ?? 0;
    const src = (str(raw.source) as Activity['source']) ?? source;
    const row: Activity = { date: d.slice(0, 10), name, kcal, source: src };
    seen.set(`${row.date}|${row.name}|${row.source}`, row);
  };

  rows<Activity>(
    value,
    (key, entry) => {
      if (Array.isArray(entry)) for (const e of entry) add(key, e);
      else add(key, entry);
      return undefined;
    },
    (row) => {
      add(undefined, row);
      return undefined;
    },
  );
  return [...seen.values()];
}

export function normaliseGoals(value: unknown): Goals[] {
  const out: Goals[] = [];
  const add = (date: string | undefined, raw: unknown) => {
    if (!isRecord(raw)) return;
    const d = str(raw.date) ?? date;
    if (!d || !ISO_DATE.test(d)) return;
    out.push({
      date: d.slice(0, 10),
      kcal: num(raw.kcal),
      protein: num(raw.protein),
      carbs: num(raw.carbs),
      fat: num(raw.fat),
      focus: str(raw.focus),
      maintenance: num(raw.maintenance),
    });
  };

  if (Array.isArray(value)) {
    for (const row of value) add(undefined, row);
  } else if (isRecord(value)) {
    if (str(value.date)) {
      // A single "current goals" object rather than a history.
      add(undefined, value);
    } else {
      for (const [date, entry] of Object.entries(value)) add(date, entry);
    }
  }
  return out;
}

export function normaliseNutritionDays(value: unknown): NutritionDay[] {
  const out: NutritionDay[] = [];
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!isRecord(row)) continue;
      const date = str(row.date);
      if (date) out.push({ date: date.slice(0, 10), meals: row.meals ?? row });
    }
  } else if (isRecord(value)) {
    for (const [date, meals] of Object.entries(value)) {
      if (ISO_DATE.test(date)) out.push({ date: date.slice(0, 10), meals });
    }
  }
  return out;
}

export function normaliseSavedMeals(value: unknown): SavedMeal[] {
  const out: SavedMeal[] = [];
  const add = (raw: unknown, fallbackId?: string) => {
    if (!isRecord(raw)) return;
    const id = str(raw.id) ?? (str(raw.name) ? slug(str(raw.name) as string) : undefined) ?? fallbackId ?? stableKey(raw);
    out.push({ ...raw, id });
  };
  if (Array.isArray(value)) for (const row of value) add(row);
  else if (isRecord(value)) for (const [key, row] of Object.entries(value)) add(row, key);
  return out;
}

/* --- import --------------------------------------------------------------- */

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Reads a v2 nutrition backup or a v3 combined backup and merges it into the
 * shared `fitness` database. Additive and idempotent — safe to run twice.
 */
export async function importBackup(raw: unknown): Promise<ImportReport> {
  if (!isRecord(raw)) throw new Error('That file is not a backup — expected a JSON object.');

  const version = num(raw._version) ?? 0;
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  let bodyWeight: BodyWeight[];
  let activity: Activity[];
  let goals: Goals[];
  let selections: NutritionDay[];
  let checked: NutritionDay[];
  let savedMeals: SavedMeal[];
  let workout: Partial<BackupV3['workout']> = {};

  if (version >= 3) {
    const shared = isRecord(raw.shared) ? raw.shared : {};
    const nutrition = isRecord(raw.nutrition) ? raw.nutrition : {};
    const w = isRecord(raw.workout) ? raw.workout : {};

    bodyWeight = normaliseBodyWeight(shared.bodyWeight);
    activity = normaliseActivity(shared.activity, 'manual');
    goals = normaliseGoals(shared.goals);
    selections = normaliseNutritionDays(nutrition.selections);
    checked = normaliseNutritionDays(nutrition.checked);
    savedMeals = normaliseSavedMeals(nutrition.savedMeals);
    workout = {
      exercise: asArray<Exercise>(w.exercise),
      block: asArray<Block>(w.block),
      blockExercise: asArray<BlockExercise>(w.blockExercise),
      session: asArray<Session>(w.session),
      setLog: asArray<SetLog>(w.setLog),
      settings: asArray<SettingRow>(w.settings),
      golfDay: asArray<GolfDay>(w.golfDay),
    };
    if (version > BACKUP_VERSION) {
      warnings.push(
        `File is version ${version}; this build understands ${BACKUP_VERSION}. Unknown sections were ignored.`,
      );
    }
  } else if (version === 2 || raw.selections !== undefined || raw.weights !== undefined) {
    // v2 → v3 migration table, spec §10.
    bodyWeight = normaliseBodyWeight(raw.weights);
    activity = normaliseActivity(raw.exercise, 'manual');
    goals = normaliseGoals(raw.goals);
    selections = normaliseNutritionDays(raw.selections);
    checked = normaliseNutritionDays(raw.checked);
    savedMeals = normaliseSavedMeals(raw.savedMeals);
    if (version !== 2) {
      warnings.push('No _version field found; read as a version 2 nutrition backup.');
    }
  } else {
    throw new Error(
      `Unrecognised backup: _version ${version || 'missing'} and no v2 nutrition keys.`,
    );
  }

  await db.transaction(
    'rw',
    [
      db.sharedBodyWeight,
      db.sharedActivity,
      db.sharedGoals,
      db.nutritionSelections,
      db.nutritionChecked,
      db.nutritionSavedMeals,
      db.exercise,
      db.block,
      db.blockExercise,
      db.session,
      db.setLog,
      db.settings,
      db.golfDay,
    ],
    async () => {
      if (bodyWeight.length) await db.sharedBodyWeight.bulkPut(bodyWeight);
      if (activity.length) await db.sharedActivity.bulkPut(activity);
      if (goals.length) await db.sharedGoals.bulkPut(goals);
      if (selections.length) await db.nutritionSelections.bulkPut(selections);
      if (checked.length) await db.nutritionChecked.bulkPut(checked);
      if (savedMeals.length) await db.nutritionSavedMeals.bulkPut(savedMeals);
      if (workout.exercise?.length) await db.exercise.bulkPut(workout.exercise);
      if (workout.block?.length) await db.block.bulkPut(workout.block);
      if (workout.blockExercise?.length) await db.blockExercise.bulkPut(workout.blockExercise);
      if (workout.session?.length) await db.session.bulkPut(workout.session);
      if (workout.setLog?.length) await db.setLog.bulkPut(workout.setLog);
      if (workout.settings?.length) await db.settings.bulkPut(workout.settings);
      if (workout.golfDay?.length) await db.golfDay.bulkPut(workout.golfDay);
    },
  );

  counts.bodyWeight = bodyWeight.length;
  counts.activity = activity.length;
  counts.goals = goals.length;
  counts.selections = selections.length;
  counts.checked = checked.length;
  counts.savedMeals = savedMeals.length;
  counts.exercise = workout.exercise?.length ?? 0;
  counts.block = workout.block?.length ?? 0;
  counts.blockExercise = workout.blockExercise?.length ?? 0;
  counts.session = workout.session?.length ?? 0;
  counts.setLog = workout.setLog?.length ?? 0;
  counts.settings = workout.settings?.length ?? 0;
  counts.golfDay = workout.golfDay?.length ?? 0;

  return { sourceVersion: version, counts, warnings };
}

/* --- export --------------------------------------------------------------- */

/** Local time with offset, matching the `_exportedAt` example in §10. */
function exportedAt(d = new Date()): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offMin / 60)}:${pad(offMin % 60)}`
  );
}

function byDate<T extends { date: string }>(list: T[]): Record<string, Omit<T, 'date'>> {
  const out: Record<string, Omit<T, 'date'>> = {};
  for (const { date, ...rest } of list) out[date] = rest as Omit<T, 'date'>;
  return out;
}

/** One JSON file covering both apps, so a single export is a full backup. */
export async function buildBackup(): Promise<BackupV3> {
  const [
    bodyWeight,
    activity,
    goals,
    exercise,
    block,
    blockExercise,
    session,
    setLog,
    settings,
    golfDay,
  ] = await Promise.all([
    db.sharedBodyWeight.toArray(),
    db.sharedActivity.toArray(),
    db.sharedGoals.toArray(),
    db.exercise.toArray(),
    db.block.toArray(),
    db.blockExercise.toArray(),
    db.session.toArray(),
    db.setLog.toArray(),
    db.settings.toArray(),
    db.golfDay.toArray(),
  ]);

  return {
    _version: BACKUP_VERSION,
    _exportedAt: exportedAt(),
    shared: {
      bodyWeight: bodyWeight.sort((a, b) => a.date.localeCompare(b.date)),
      activity,
      goals: byDate(goals),
    },
    workout: {
      exercise,
      block,
      blockExercise,
      session: session.sort((a, b) => a.date.localeCompare(b.date)),
      setLog,
      // The remote config holds an API key; a backup file is not the place
      // for a credential, and it is device-local anyway.
      // A device fact, not a training fact.
      settings: settings.filter((row) => row.key !== LAST_SYNC_KEY),
      golfDay: golfDay.sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

export function backupFilename(d = new Date()): string {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return `fitness-backup-${iso}.json`;
}

export async function downloadBackup(): Promise<void> {
  const payload = await buildBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.append(a);
  a.click();
  a.remove();
  // Give Safari a moment to start the download before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
