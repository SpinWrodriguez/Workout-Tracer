import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { MUSCLES } from '../db/seed/muscles';
import type { Exercise } from '../db/types';
import { friendlyDate, shiftIso, todayIso, weekStart } from '../lib/format';
import {
  VOLUME_HIGH,
  VOLUME_LOW,
  perWeek,
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

/*
 * The windows, in whole weeks.
 *
 * Whole weeks because the floor and the ceiling are weekly numbers and the
 * longer windows are shown as a weekly average: 4 and 13 divide cleanly, where
 * "30 days" and "91 days" would put a part-week in the divisor and make every
 * average slightly wrong in a way nobody could see.
 */
const SPANS = ['1W', '1M', '3M'] as const;
type Span = (typeof SPANS)[number];
const SPAN_WEEKS: Record<Span, number> = { '1W': 1, '1M': 4, '3M': 13 };
const SPAN_LABEL: Record<Span, string> = { '1W': 'Week', '1M': 'Month', '3M': '3 months' };

export function LevelsScreen({ exercises }: { exercises: Exercise[] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [region, setRegion] = useState<Region>('all');
  const [span, setSpan] = useState<Span>('1W');

  const weeks = SPAN_WEEKS[span];
  /* The window ends with the week being viewed and runs back from there, so
     the arrows keep working on every span — a month back from four weeks ago
     is a question worth being able to ask. */
  const to = shiftIso(weekStart(todayIso()), (weekOffset + 1) * 7);
  const from = shiftIso(to, -7 * weeks);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  const volume = useLiveQuery(async () => {
    const sessions = await db.session.where('date').between(from, to, true, false).toArray();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLog.toArray()).filter((l) => ids.has(l.sessionId));
    const raw = setsPerMuscle(logs, byId);
    return {
      /* Averaged before it is judged: the thresholds below are per week. */
      volume: perWeek(raw, weeks),
      /* And kept unaveraged, because "did I train this at all in the window"
         is a different question. Over thirteen weeks a muscle with three
         weighted sets averages to 0.1 and rounds to nothing — reporting it as
         untrained would be the average lying about the log. */
      touched: MUSCLES.filter((muscle) => (raw[muscle.id] ?? 0) > 0).map((muscle) => muscle.id),
      sessionCount: sessions.length,
      setCount: logs.length,
    };
  }, [from, to, byId, weeks]);

  const rows = volume ? volumeRows(volume.volume) : [];
  const shown = rows.filter((row) => region === 'all' || row.region === region);
  /* Only flag muscles that were actually trained. After a light week every
     untrained muscle is technically "under 8", which drowns out the signal —
     and the full list below already shows them as `--`. */
  const wasTouched = new Set(volume?.touched ?? []);
  /*
   * Under the floor by the number shown, not by its status: over 13 weeks a
   * muscle with three weighted sets averages to 0.1 and rounds to zero, whose
   * status is "none" rather than "low". It was touched, so it is not in the
   * untrained list either — and it fell out of both, vanishing from the one
   * card that exists to point at neglected muscles.
   */
  const flagged = rows.filter(
    (row) =>
      row.status === 'high' || (wasTouched.has(row.muscleId) && row.sets < VOLUME_LOW),
  );
  const untouched = rows.filter((row) => !wasTouched.has(row.muscleId));
  const trained = rows.filter((row) => wasTouched.has(row.muscleId));

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
            {weekOffset === 0 && weeks === 1 ? 'This week' : friendlyDate(from)}
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
              }${weeks > 1 ? ` in ${weeks} weeks` : ''} · ${trained.length} muscles trained`
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
              {weeks === 1 ? 'Untrained this week' : `Untrained in ${SPAN_LABEL[span].toLowerCase()}`}
              : {untouched.map((row) => row.name).join(', ')}.
            </p>
          )}
          <p className="mt-2 text-[12px] font-medium text-text-dim">
            Counted as 1 set per primary muscle and 0.5 per secondary. Two sessions a week will
            leave plenty of these low; the flags are a prompt, not a verdict.
          </p>
        </Card>
      )}

      <Card
        title="Weekly sets per muscle"
        className="mt-3"
        trailing={
          weeks > 1 ? <Label>average over {weeks} weeks</Label> : undefined
        }
      >
        <div className="mb-3">
          <SegmentedToggle options={SPANS} value={span} onChange={setSpan} labels={SPAN_LABEL} />
        </div>
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
