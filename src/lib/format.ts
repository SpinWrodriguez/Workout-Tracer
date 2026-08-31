/** Spec §4: empty states read `-- kg` / `--- sets`, never "No data available". */
export const EM_WEIGHT = '-- kg';
export const EM_SETS = '--- sets';
export const EM_DASH = '--';

/** Weights land on 0.5 kg at worst; never show trailing noise like 24.50. */
export function kg(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return EM_DASH;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A weekly rate needs two decimals: −0.35 and −0.3 kg/week are a 17% different
 * plan, and `kg()` would round the distinction away.
 */
export function rate(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return EM_DASH;
  const shown = Math.abs(value) < 0.005 ? 0 : value;
  return `${shown > 0 ? '+' : ''}${shown.toFixed(2)}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(d: Date): string {
  // Local calendar date, not UTC — a 9pm garage session must not land tomorrow.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const DAY_MS = 86_400_000;

export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((fromIsoDate(bIso).getTime() - fromIsoDate(aIso).getTime()) / DAY_MS);
}

export function shiftIso(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** 'Today', 'Yesterday', else 'Mon 25 Aug'. */
export function friendlyDate(iso: string): string {
  const delta = daysBetween(iso, todayIso());
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  const d = fromIsoDate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function longDate(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Monday-start week containing `iso`. */
export function weekStart(iso: string): string {
  const d = fromIsoDate(iso);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - dow);
  return toIsoDate(d);
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
