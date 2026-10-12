import { clock } from '../lib/format';
import { type RestTimer } from '../lib/restTimer';
import { tap } from '../lib/haptics';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  The rest timer, two forms.                                                */
/*                                                                            */
/*  Resting: a bar at the bottom of the screen, under the thumb, with the     */
/*  countdown, thirty seconds more and skip. Gone when it hits zero, so the   */
/*  top of the screen is the exercise and never a clock.                      */
/*                                                                            */
/*  Not resting: a row of chips to pick the next rest from, opened from the   */
/*  "rest 3:00" on the exercise. The exercise's own rest is always one of     */
/*  them.                                                                     */
/* -------------------------------------------------------------------------- */

const RING = 2 * Math.PI * 23;

export function RestBar({ timer, caption }: { timer: RestTimer; caption?: string }) {
  const { running, remainingSec, elapsedFraction } = timer;
  if (!running) return null;
  return (
    <div
      role="timer"
      aria-label={`Resting, ${clock(remainingSec)} left`}
      className="fixed inset-x-4 z-40 grid grid-cols-[54px_1fr_auto_auto] items-center gap-3 rounded-[20px] bg-cta px-3.5 py-3 text-bg shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
    >
      <svg viewBox="0 0 54 54" className="size-[54px]" aria-hidden="true">
        <circle cx="27" cy="27" r="23" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
        <circle
          cx="27"
          cy="27"
          r="23"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * Math.min(1, Math.max(0, elapsedFraction))}
          transform="rotate(-90 27 27)"
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <div className="min-w-0">
        <div className="font-display text-[26px] leading-none font-extrabold tracking-tight tabular-nums">
          {clock(remainingSec)}
        </div>
        <div className="mt-0.5 truncate text-[12px] font-semibold opacity-70">{caption ?? 'rest'}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          tap();
          timer.extend(30);
        }}
        className="relative h-9 rounded-full bg-bg/15 px-3 text-[13px] font-bold"
      >
        +30s
        <HapticTick />
      </button>
      <button
        type="button"
        onClick={() => {
          tap();
          timer.stop();
        }}
        className="relative h-9 rounded-full bg-bg/15 px-3 text-[13px] font-bold"
      >
        Skip
        <HapticTick />
      </button>
    </div>
  );
}

export function RestChips({
  timer,
  presets,
  onPresetChange,
}: {
  timer: RestTimer;
  /** The durations to offer, which include the exercise's own rest. */
  presets: number[];
  onPresetChange: (sec: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {presets.map((sec) => (
        <button
          key={sec}
          type="button"
          onClick={() => onPresetChange(sec)}
          className={`h-8 rounded-full px-3 text-[12px] font-semibold ${
            timer.durationSec === sec ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
          }`}
        >
          {sec}s
        </button>
      ))}
      <button
        type="button"
        onClick={() => timer.start()}
        className="ml-auto h-8 rounded-full bg-surface-2 px-3 text-[12px] font-semibold text-text-dim"
      >
        Start
      </button>
    </div>
  );
}
