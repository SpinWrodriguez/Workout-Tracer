import { Suspense, lazy } from 'react';
import type { DatedPoint, Trend } from '../lib/stats';
import type { ExerciseMetric, ExercisePoint } from './Charts';

/* -------------------------------------------------------------------------- */
/*  Recharts is the spec's chart library (§3) but it roughly doubles the        */
/*  bundle, and the design system asks for almost no chart chrome. Splitting    */
/*  it into its own chunk keeps the logging screen — the one used mid-set —     */
/*  small, while the service worker still precaches the chunk so charts work    */
/*  offline in the garage.                                                     */
/* -------------------------------------------------------------------------- */

const BodyWeight = lazy(() =>
  import('./Charts').then((m) => ({ default: m.BodyWeightChart })),
);
const Exercise = lazy(() => import('./Charts').then((m) => ({ default: m.ExerciseChart })));

function Placeholder({ height }: { height: number }) {
  return <div style={{ height }} className="rounded-xl bg-surface-2" />;
}

export function BodyWeightChart(props: {
  points: DatedPoint[];
  average: DatedPoint[];
  trend: Trend;
  height?: number;
}) {
  return (
    <Suspense fallback={<Placeholder height={props.height ?? 150} />}>
      <BodyWeight {...props} />
    </Suspense>
  );
}

export function ExerciseChart(props: {
  points: ExercisePoint[];
  metric: ExerciseMetric;
  height?: number;
}) {
  return (
    <Suspense fallback={<Placeholder height={props.height ?? 150} />}>
      <Exercise {...props} />
    </Suspense>
  );
}
