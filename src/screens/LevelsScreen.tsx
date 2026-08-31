import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { friendlyDate, shiftIso, todayIso, weekStart } from '../lib/format';
import {
  VOLUME_HIGH,
  VOLUME_LOW,
  setsPerMuscle,
  volumeRows,
  type MuscleVolumeRow,
} from '../lib/volume';
import { Card, Empty, Label, Screen, SegmentedToggle } from '../components/Layout';
import { Silhouette } from '../components/Silhouette';

const REGIONS = ['all', 'upper', 'lower', 'core'] as const;
type Region = (typeof REGIONS)[number];

function statusColor(status: MuscleVolumeRow['status']): string | undefined {
  switch (status) {
    case 'low':
      return 'var(--color-warn)';
    case 'high':
      return 'var(--color-rir-1)';
    case 'ok':
      return 'var(--color-muscle)';
    default:
      return undefined;
  }
}

export function LevelsScreen({ exercises }: { exercises: Exercise[] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [region, setRegion] = useState<Region>('all');

  const from = shiftIso(weekStart(todayIso()), weekOffset * 7);
  const to = shiftIso(from, 7);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  const volume = useLiveQuery(async () => {
    const sessions = await db.session.where('date').between(from, to, true, false).toArray();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLog.toArray()).filter((l) => ids.has(l.sessionId));
    return { volume: setsPerMuscle(logs, byId), sessionCount: sessions.length, setCount: logs.length };
  }, [from, to, byId]);

  const rows = volume ? volumeRows(volume.volume) : [];
  const shown = rows.filter((row) => region === 'all' || row.region === region);
  /* Only flag muscles that were actually trained. After a light week every
     untrained muscle is technically "under 8", which drowns out the signal —
     and the full list below already shows them as `--`. */
  const flagged = rows.filter(
    (row) => row.status === 'high' || (row.status === 'low' && row.sets > 0),
  );
  const untouched = rows.filter((row) => row.sets === 0);
  const trained = rows.filter((row) => row.sets > 0);

  return (
    <Screen
      title="Levels"
      trailing={
        <span className="flex gap-1 pb-1">
          <button
            type="button"
            onClick={() => setWeekOffset((prev) => prev - 1)}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim"
          >
            {weekOffset === 0 ? 'This week' : friendlyDate(from)}
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((prev) => Math.min(0, prev + 1))}
            disabled={weekOffset === 0}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-dim disabled:text-text-faint"
            aria-label="Next week"
          >
            ›
          </button>
        </span>
      }
    >
      <Card>
        <Silhouette volume={volume?.volume ?? ({} as never)} />
        <p className="mt-2 text-center text-[12px] font-medium text-text-dim">
          {volume && volume.setCount > 0
            ? `${volume.setCount} sets over ${volume.sessionCount} session${
                volume.sessionCount === 1 ? '' : 's'
              } · ${trained.length} muscles trained`
            : '--- sets'}
        </p>
      </Card>

      {(flagged.length > 0 || untouched.length > 0) && (
        <Card title="Worth a look" className="mt-3">
          {flagged.slice(0, 6).map((row) => (
            <div key={row.muscleId} className="flex items-baseline justify-between gap-3 py-1">
              <span className="text-[14px] font-medium">{row.name}</span>
              <Label className="text-right">
                {row.sets} {row.sets === 1 ? 'set' : 'sets'} —{' '}
                {row.status === 'low' ? `under ${VOLUME_LOW}` : `over ${VOLUME_HIGH}`}
              </Label>
            </div>
          ))}
          {flagged.length > 6 && (
            <Label className="mt-1 block">+{flagged.length - 6} more under {VOLUME_LOW}</Label>
          )}
          {untouched.length > 0 && (
            <p className="mt-2 text-[13px] font-medium text-text-dim">
              Untrained this week: {untouched.map((row) => row.name).join(', ')}.
            </p>
          )}
          <p className="mt-2 text-[12px] font-medium text-text-dim">
            Counted as 1 set per primary muscle and 0.5 per secondary. Two sessions a week will
            leave plenty of these low; the flags are a prompt, not a verdict.
          </p>
        </Card>
      )}

      <Card title="Weekly sets per muscle" className="mt-3">
        <div className="mb-3">
          <SegmentedToggle
            options={REGIONS}
            value={region}
            onChange={setRegion}
            labels={{ all: 'All', upper: 'Upper', lower: 'Lower', core: 'Core' }}
          />
        </div>

        {shown.length === 0 && <Empty>--- sets</Empty>}

        {shown.map((row) => {
          const color = statusColor(row.status);
          const width = Math.min(100, (row.sets / VOLUME_HIGH) * 100);
          return (
            <div key={row.muscleId} className="py-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[14px] font-medium ${row.sets > 0 ? '' : 'text-text-faint'}`}>
                  {row.name}
                </span>
                <span
                  className="text-[14px] font-semibold"
                  style={color ? { color } : { color: 'var(--color-text-faint)' }}
                >
                  {row.sets > 0 ? row.sets : '--'}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${width}%`,
                    background: color ?? 'var(--color-border)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </Card>
    </Screen>
  );
}
