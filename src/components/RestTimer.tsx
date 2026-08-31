import { clock } from '../lib/format';
import { REST_PRESETS, type RestTimer } from '../lib/restTimer';

/** Countdown plus progress bar, pinned in the session header. */
export function RestTimerBar({
  timer,
  onPresetChange,
}: {
  timer: RestTimer;
  onPresetChange: (sec: number) => void;
}) {
  const { running, remainingSec, durationSec, elapsedFraction } = timer;
  return (
    <div className="mt-3 rounded-2xl bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="stat-sm" style={{ color: running ? 'var(--color-volume)' : undefined }}>
            {running ? clock(remainingSec) : clock(durationSec)}
          </span>
          <span className="label whitespace-nowrap">{running ? 'rest' : 'target'}</span>
        </div>
        <div className="flex gap-1">
          {REST_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => onPresetChange(sec)}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium ${
                durationSec === sec ? 'bg-surface-2 text-text' : 'text-text-dim'
              }`}
            >
              {sec}s
            </button>
          ))}
          <button
            type="button"
            onClick={() => (running ? timer.stop() : timer.start())}
            className="ml-1 rounded-lg bg-surface-2 px-2.5 py-1 text-[11px] font-semibold"
          >
            {running ? 'Skip' : 'Start'}
          </button>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${Math.min(100, Math.max(0, elapsedFraction * 100))}%`,
            background: running ? 'var(--color-volume)' : 'var(--color-border)',
          }}
        />
      </div>
    </div>
  );
}
