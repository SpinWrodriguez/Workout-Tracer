import { rirFromRpe, rirToken, rpeFromRir } from '../lib/load';

const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
const RPE_OPTIONS = [6, 7, 8, 9, 10] as const;

/**
 * RIR and RPE are two views of the same number, so setting one fills the other
 * in. Both are stored (spec §5 keeps them as separate optional fields).
 */
export function EffortPicker({
  rir,
  rpe,
  onChange,
  onClose,
}: {
  rir?: number;
  rpe?: number;
  onChange: (next: { rir?: number; rpe?: number }) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim" />
      <div
        className="relative rounded-t-3xl bg-surface px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="card-title">Effort</h3>

        <p className="label mt-3 mb-2">Reps in reserve</p>
        <div className="flex gap-1.5">
          {RIR_OPTIONS.map((value) => {
            const active = rir === value;
            const token = rirToken(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ rir: value, rpe: rpeFromRir(value) })}
                aria-label={`RIR ${value}`}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-xl bg-surface-2 py-2.5"
                style={active ? { outline: `2px solid ${token}` } : undefined}
              >
                <span className="size-3.5 rounded-full" style={{ background: token }} />
                <span className={`text-[13px] font-semibold ${active ? '' : 'text-text-dim'}`}>
                  {value}
                </span>
              </button>
            );
          })}
        </div>

        <p className="label mt-4 mb-2">RPE</p>
        <div className="flex gap-1.5">
          {RPE_OPTIONS.map((value) => {
            const active = rpe === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ rpe: value, rir: rirFromRpe(value) })}
                aria-label={`RPE ${value}`}
                className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold ${
                  active ? 'bg-cta text-bg' : 'bg-surface-2 text-text-dim'
                }`}
              >
                {value}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ rir: undefined, rpe: undefined })}
            className="flex-1 rounded-full bg-surface-2 py-3 text-sm font-medium text-text-dim"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-cta flex-1 rounded-full bg-cta font-semibold text-bg"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
