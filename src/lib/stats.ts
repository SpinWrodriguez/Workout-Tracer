/* -------------------------------------------------------------------------- */
/*  Chart maths — spec Phase 4.                                               */
/*                                                                            */
/*  Every strength figure is computed from effectiveKg, never the loaded       */
/*  number, so a cable row and a barbell squat sit on the same axis.           */
/* -------------------------------------------------------------------------- */

export interface DatedPoint {
  date: string;
  value: number;
}

/**
 * Epley. Above about 12 reps any 1-RM formula is guesswork, so the caller
 * should treat high-rep estimates as indicative only.
 */
export function estimate1RM(effectiveKg: number, reps: number): number {
  if (!(effectiveKg > 0) || !(reps > 0)) return 0;
  if (reps === 1) return round2(effectiveKg);
  return round2(effectiveKg * (1 + reps / 30));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Trailing average over `window` days. Points are assumed sorted ascending and
 * are averaged by position, which is what a daily weigh-in series wants.
 */
export function rollingAverage(points: DatedPoint[], window = 7): DatedPoint[] {
  return points.map((point, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = points.slice(from, i + 1);
    const sum = slice.reduce((total, p) => total + p.value, 0);
    return { date: point.date, value: round2(sum / slice.length) };
  });
}

export interface Trend {
  /** Change per day, in the series' own units. */
  slopePerDay: number;
  /** The figure that matters for a cut: kg per week. */
  perWeek: number;
  intercept: number;
  /** Fitted value at the first and last point, for drawing the line. */
  first?: DatedPoint;
  last?: DatedPoint;
  /** Coefficient of determination, 0..1. */
  r2: number;
}

const DAY_MS = 86_400_000;

function dayIndex(iso: string, originMs: number): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime() - originMs) / DAY_MS;
}

/**
 * Ordinary least squares against elapsed days, not point index — a gap in the
 * weigh-ins must not stretch the trend.
 */
export function linearTrend(points: DatedPoint[]): Trend {
  if (points.length < 2) {
    return { slopePerDay: 0, perWeek: 0, intercept: points[0]?.value ?? 0, r2: 0 };
  }

  const originIso = points[0]?.date as string;
  const [oy, om, od] = originIso.split('-').map(Number);
  const originMs = new Date(oy ?? 1970, (om ?? 1) - 1, od ?? 1).getTime();

  const xs = points.map((p) => dayIndex(p.date, originMs));
  const ys = points.map((p) => p.value);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX;
    const dy = (ys[i] as number) - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  const slopePerDay = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  const at = (x: number) => round2(intercept + slopePerDay * x);
  return {
    slopePerDay,
    perWeek: round2(slopePerDay * 7),
    intercept,
    first: { date: originIso, value: at(xs[0] as number) },
    last: { date: points[n - 1]?.date as string, value: at(xs[n - 1] as number) },
    r2: round2(r2),
  };
}

/** Timeframe toggle from spec §4. */
export const TIMEFRAMES = ['1W', '1M', '3M', '6M', '1Y', 'All'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const TIMEFRAME_DAYS: Record<Timeframe, number | undefined> = {
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '6M': 183,
  '1Y': 365,
  All: undefined,
};

export function timeframeCutoff(timeframe: Timeframe, todayIso: string): string | undefined {
  const days = TIMEFRAME_DAYS[timeframe];
  if (days === undefined) return undefined;
  const [y, m, d] = todayIso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
