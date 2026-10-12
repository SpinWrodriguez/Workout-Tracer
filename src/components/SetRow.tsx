import type { Exercise } from '../db/types';
import { effectiveKg, hasLoadTranslation, rirToken } from '../lib/load';
import type { DraftSet } from '../lib/sessions';
import { kg } from '../lib/format';
import { repUnitShort } from '../lib/repUnit';
import { tap } from '../lib/haptics';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  Set row.                                                                   */
/*  set no. · kg · reps · reps-in-reserve dots · tick.                         */
/*                                                                            */
/*  A set that went to plan is one tap: the row shows what it expects (last   */
/*  time plus the step) in faint type, and the tick logs exactly that. The    */
/*  numbers are only tapped when the set went differently. The row in hand    */
/*  is outlined; a done row goes quiet. Every tappable cell is 44px tall.     */
/* -------------------------------------------------------------------------- */

/** Four dots, filled to the reps left in the tank. Colour is the RIR scale. */
export function RirDots({
  rir,
  rpe,
  onClick,
  dim = false,
}: {
  rir?: number;
  rpe?: number;
  onClick?: () => void;
  dim?: boolean;
}) {
  const value = rir ?? (rpe !== undefined ? Math.max(0, Math.round(10 - rpe)) : undefined);
  const token = rirToken(value);
  const caption = rir !== undefined ? `RIR ${rir}` : rpe !== undefined ? `RPE ${rpe}` : 'Reps in reserve, not set';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex h-11 w-12 shrink-0 items-center justify-center gap-[3px]"
      aria-label={caption}
    >
      {[1, 2, 3, 4].map((n) => {
        const on = value !== undefined && n <= value;
        return (
          <span
            key={n}
            className="block size-[9px] rounded-full"
            style={{
              background: on ? token : 'transparent',
              border: on ? undefined : `1.5px solid var(--color-${dim ? 'border' : 'text-faint'})`,
              opacity: dim ? 0.7 : 1,
            }}
          />
        );
      })}
    </button>
  );
}

export type CellField = 'weight' | 'reps';

/** What the row would log on a bare tick: last time plus the step. */
export interface Ghost {
  weightKg?: number;
  reps?: number;
}

export function SetRow({
  exercise,
  set,
  ghost,
  current = false,
  activeField,
  rowKey,
  onCell,
  onToggleDone,
  onRir,
  onRemove,
}: {
  exercise: Exercise;
  set: DraftSet;
  ghost?: Ghost;
  /** The next set to do: outlined, so the eye lands on it. */
  current?: boolean;
  activeField?: CellField;
  /** Lets the session screen scroll this row clear of the keypad. */
  rowKey: string;
  onCell: (field: CellField) => void;
  onToggleDone: () => void;
  onRir: () => void;
  onRemove?: () => void;
}) {
  const done = set.done;
  /* Bands take a weight now — the rating printed on the band — so only true
     no-load work keeps the cell shut. */
  const weightless = exercise.loadMode === 'bodyweight' || exercise.loadMode === 'rpe_only';
  const eff = effectiveKg(exercise, set.weightKg);
  const showEffective = hasLoadTranslation(exercise);

  const cell = (
    field: CellField,
    value: string | undefined,
    unit: string,
    opts: { disabled?: boolean; sub?: string; ghost?: string } = {},
  ) => {
    const active = activeField === field;
    const { disabled = false, sub } = opts;
    const shown = value ?? opts.ghost;
    const faint = value === undefined;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onCell(field)}
        aria-label={`Set ${set.setNo} ${field === 'weight' ? 'weight' : 'reps'}`}
        className={`flex h-11 flex-1 flex-col items-center justify-center rounded-xl px-1 ${
          active
            ? 'bg-cta text-bg'
            : done
              ? 'border border-border bg-transparent'
              : current
                ? 'bg-surface'
                : 'bg-surface-2'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <span className="flex items-baseline gap-1 leading-none whitespace-nowrap">
          <span
            className={`text-[18px] font-semibold ${
              active ? '' : faint && !disabled ? 'text-text-faint' : done ? 'text-text-dim' : 'text-text'
            }`}
          >
            {shown ?? '--'}
          </span>
          <span className={`text-[11px] font-medium ${active ? 'text-bg/70' : 'text-text-dim'}`}>
            {unit}
          </span>
        </span>
        {/* Spec §5 rule 2: show what was loaded AND what it actually lifts. */}
        {sub && (
          <span
            className={`mt-0.5 text-[10px] leading-none font-medium ${
              active ? 'text-bg/70' : 'text-strength'
            }`}
          >
            {sub}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl px-1.5 py-1 scroll-mt-24 ${
        current ? 'outline-[1.5px] outline-volume' : ''
      }`}
      style={current ? { background: 'color-mix(in oklab, var(--color-volume) 9%, transparent)' } : undefined}
      data-set-row={rowKey}
    >
      <button
        type="button"
        onClick={onRemove}
        disabled={!onRemove}
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
          current ? 'text-volume' : done ? 'text-text-faint' : 'text-text-dim'
        }`}
        aria-label={`Set ${set.setNo}`}
      >
        {set.setNo}
      </button>

      {weightless
        ? cell('weight', exercise.loadMode === 'bodyweight' ? 'BW' : '--', '', { disabled: true })
        : cell('weight', set.weightKg === undefined ? undefined : kg(set.weightKg), 'kg', {
            sub: showEffective && eff !== undefined ? `= ${kg(eff)} kg` : undefined,
            ghost: ghost?.weightKg === undefined ? undefined : kg(ghost.weightKg),
          })}
      {cell('reps', set.reps === undefined ? undefined : String(set.reps), repUnitShort(exercise), {
        ghost: ghost?.reps === undefined ? undefined : String(ghost.reps),
      })}

      <RirDots rir={set.rir} rpe={set.rpe} onClick={onRir} dim={done} />

      <button
        type="button"
        onClick={() => {
          /* Synchronous, before anything else: on iOS the tick only fires
             inside the real gesture. */
          tap();
          onToggleDone();
        }}
        className={`relative flex size-10 shrink-0 items-center justify-center rounded-full ${
          done ? 'bg-cta text-bg' : current ? 'bg-surface text-text' : 'bg-surface-2 text-text-faint'
        }`}
        aria-label={done ? 'Mark set incomplete' : 'Mark set complete'}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <HapticTick radius={10} />
      </button>
    </div>
  );
}
