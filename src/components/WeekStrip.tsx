import { WEEKDAY_LABEL, type WeekDay } from '../lib/golf';
import { fromIsoDate } from '../lib/format';

/* -------------------------------------------------------------------------- */
/*  Weekly view — spec Phase 3: gym days, golf days, rest days, and rule       */
/*  violations, in one glance.                                                */
/*                                                                            */
/*  Tap a day to cycle its golf status. The calendar lives here rather than    */
/*  buried in Settings because marking a round is something you do while       */
/*  looking at the week it breaks.                                            */
/* -------------------------------------------------------------------------- */

const KIND_LABEL: Record<WeekDay['kind'], string> = {
  gym: 'gym',
  golf: 'golf',
  gym_and_golf: 'both',
  rest: 'rest',
};

function kindColor(day: WeekDay): string | undefined {
  if (day.violation) return 'var(--color-rir-1)';
  switch (day.kind) {
    case 'gym':
      return 'var(--color-volume)';
    case 'golf':
      return 'var(--color-muscle)';
    case 'gym_and_golf':
      return 'var(--color-strength)';
    default:
      return undefined;
  }
}

export function WeekStrip({
  week,
  onToggleGolf,
}: {
  week: WeekDay[];
  onToggleGolf: (date: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {week.map((day) => {
        const color = kindColor(day);
        return (
          <button
            key={day.date}
            type="button"
            onClick={() => onToggleGolf(day.date)}
            className="flex-1 rounded-xl bg-surface-2 px-1 py-2"
            aria-label={`${WEEKDAY_LABEL[day.weekday]} ${day.date} — ${KIND_LABEL[day.kind]}${
              day.violation ? ', rule violation' : ''
            }`}
          >
            <span className="block text-[10px] font-medium text-text-dim">
              {WEEKDAY_LABEL[day.weekday]}
            </span>
            <span className="mt-0.5 block text-[15px] font-semibold">
              {fromIsoDate(day.date).getDate()}
            </span>
            <span
              className="mx-auto mt-1.5 block size-1.5 rounded-full"
              style={{ background: color ?? 'var(--color-border)' }}
            />
            <span
              className={`mt-1 block text-[9px] font-semibold uppercase ${
                color ? '' : 'text-text-faint'
              }`}
              style={color ? { color } : undefined}
            >
              {KIND_LABEL[day.kind]}
            </span>
            {/* Grip-safe days are the only ones that can carry lat and forearm work. */}
            <span
              className={`mt-1 block text-[9px] font-medium ${
                day.gripSafe ? 'text-text-dim' : 'text-text-faint'
              }`}
            >
              {day.gripSafe ? 'grip ok' : 'no grip'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
