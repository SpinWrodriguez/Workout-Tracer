import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import { kg } from '../lib/format';
import type { DatedPoint, Trend } from '../lib/stats';

/* -------------------------------------------------------------------------- */
/*  Charts — spec §4: "no axis chrome beyond a single dashed gridline and      */
/*  endpoint labels". So axes are hidden, there is one dashed horizontal       */
/*  gridline, and the first and last values are printed beside the plot        */
/*  instead of along an axis.                                                 */
/* -------------------------------------------------------------------------- */

const AXIS = { hide: true } as const;

function Endpoints({
  first,
  last,
  unit,
}: {
  first?: number;
  last?: number;
  unit: string;
}) {
  return (
    <div className="mt-1 flex justify-between">
      <span className="text-[11px] font-medium text-text-faint">
        {first === undefined ? '--' : `${kg(first)} ${unit}`}
      </span>
      <span className="text-[11px] font-medium text-text-faint">
        {last === undefined ? '--' : `${kg(last)} ${unit}`}
      </span>
    </div>
  );
}

/** Body weight: daily points, 7-day average, and the fitted trend line. */
export function BodyWeightChart({
  points,
  average,
  trend,
  height = 150,
}: {
  points: DatedPoint[];
  average: DatedPoint[];
  trend: Trend;
  height?: number;
}) {
  const data = points.map((point, i) => ({
    date: point.date,
    weight: point.value,
    avg: average[i]?.value,
    trend:
      trend.first && trend.last && points.length > 1
        ? trend.first.value +
          ((trend.last.value - trend.first.value) * i) / (points.length - 1)
        : undefined,
  }));

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = Math.round(((min + max) / 2) * 10) / 10;

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 2, bottom: 0, left: 2 }}>
            <XAxis dataKey="date" {...AXIS} />
            <YAxis domain={[min - 0.6, max + 0.6]} {...AXIS} />
            {/* Exactly one gridline — Recharts' CartesianGrid draws one per tick. */}
            <ReferenceLine y={mid} stroke="var(--color-border)" strokeDasharray="3 4" />
            <Line
              type="monotone"
              dataKey="weight"
              stroke="var(--color-bodyweight)"
              strokeOpacity={0.35}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="avg"
              stroke="var(--color-bodyweight)"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="trend"
              stroke="var(--color-text-dim)"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Endpoints first={points[0]?.value} last={points.at(-1)?.value} unit="kg" />
    </div>
  );
}

export interface ExercisePoint {
  date: string;
  topSetKg?: number;
  oneRm?: number;
  volumeKg: number;
}

export type ExerciseMetric = 'topSetKg' | 'oneRm' | 'volumeKg';

const METRIC_COLOR: Record<ExerciseMetric, string> = {
  topSetKg: 'var(--color-strength)',
  oneRm: 'var(--color-strength)',
  volumeKg: 'var(--color-volume)',
};

/** Per-exercise history. One metric at a time; the toggle picks which. */
export function ExerciseChart({
  points,
  metric,
  height = 150,
}: {
  points: ExercisePoint[];
  metric: ExerciseMetric;
  height?: number;
}) {
  const values = points.map((p) => p[metric] ?? 0);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const mid = Math.round(((min + max) / 2) * 10) / 10;

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <ReferenceLine y={mid} stroke="var(--color-border)" strokeDasharray="3 4" />
            <XAxis dataKey="date" {...AXIS} />
            <YAxis dataKey={metric} domain={[min, max * 1.08]} {...AXIS} />
            <Scatter
              dataKey={metric}
              fill={METRIC_COLOR[metric]}
              line={{ stroke: METRIC_COLOR[metric], strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <Endpoints
        first={points[0]?.[metric] ?? undefined}
        last={points.at(-1)?.[metric] ?? undefined}
        unit="kg"
      />
    </div>
  );
}
