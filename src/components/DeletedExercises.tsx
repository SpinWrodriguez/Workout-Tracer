import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { readDeletedExercises, setExerciseDeleted } from '../db/settings';
import { Card, Label } from './Layout';

/*
 * The only way back for a deleted exercise. Every list that offers exercises
 * leaves deleted ones out, its own sheet included, so without this a delete
 * would be one-way — and the sheet's confirm says it can be restored here.
 */
export function DeletedExercises() {
  const rows = useLiveQuery(async () => {
    const ids = await readDeletedExercises();
    const found = await db.exercise.bulkGet(ids);
    return ids
      .map((id, i) => ({ id, name: found[i]?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  return (
    <Card
      title="Deleted exercises"
      collapsible
      summary={rows === undefined ? '--' : rows.length === 0 ? 'none' : `${rows.length} deleted`}
    >
      {rows !== undefined && rows.length === 0 && <Label>none</Label>}
      {rows?.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-3 py-1.5">
          <span className="truncate text-[14px] font-medium">{row.name}</span>
          <button
            type="button"
            onClick={() => void setExerciseDeleted(row.id, false)}
            aria-label={`Restore ${row.name}`}
            className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
          >
            Restore
          </button>
        </div>
      ))}
      <p className="mt-2 text-[12px] font-medium text-text-dim">
        Deleted exercises are never offered again, but sets already logged against them stay in
        History.
      </p>
    </Card>
  );
}
