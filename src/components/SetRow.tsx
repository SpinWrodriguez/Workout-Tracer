import type { Exercise } from '../db/types';
import { effectiveKg, hasLoadTranslation, rirToken } from '../lib/load';
import type { DraftSet } from '../lib/sessions';
import { kg } from '../lib/format';
import { repUnitShort } from '../lib/repUnit';

/* -------------------------------------------------------------------------- */
/*  Set row — spec §4.                                                        */
/*  set no. (circle) · target · kg · reps · checkbox, with the RIR badge       */
/*  right-aligned. Completed rows drop to --text-faint.                        */
/*  Thumb-reach beats density: every tappable cell is at least 44px tall.      */
/* -------------------------------------------------------------------------- */

/** Small filled circle, coloured by --rir-*. */
export function RirBadge({
  rir,
  rpe,
  onClick,
}: {
  rir?: number;
  rpe?: number;
  onClick?: () => void;
}) {
  const token = rirToken(rir);
  const empty = token === undefined;
  const caption = rir !== undefined ? `RIR ${rir}` : rpe !== undefined ? `RPE ${rpe}` : 'RIR';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-14 shrink-0 flex-col items-center gap-1"
      aria-label={caption}
    >
      <span
        className={`size-3.5 rounded-full ${empty ? 'border border-border' : ''}`}
        style={empty ? undefined : { background: token }}
      />
      <span className="text-[10px] font-medium text-text-dim">{caption}</span>
    </button>
  );
}

export type CellField = 'weight' | 'reps';

export function SetRow({
  exercise,
  set,
  target,
  activeField,
  rowKey,
  onCell,
  onToggleDone,
  onRir,
  onRemove,
}: {
  exercise: Exercise;
  set: DraftSet;
  target?: string;
  activeField?: CellField;
  /** Lets the session screen scroll this row clear of the keypad. */
  rowKey: string;
  onCell: (field: CellField) => void;
  onToggleDone: () => void;
  onRir: () => void;
  onRemove?: () => void;
}) {
  const done = set.done;
  const dim = done ? 'text-text-faint' : 'text-text';
  const weightless = exercise.loadMode !== 'weight';
  const eff = effectiveKg(exercise, set.weightKg);
  const showEffective = hasLoadTranslation(exercise);

  const cell = (
    field: CellField,
    value: string,
    unit: string,
    opts: { disabled?: boolean; sub?: string } = {},
  ) => {
    const active = activeField === field;
    const { disabled = false, sub } = opts;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onCell(field)}
        aria-label={`Set ${set.setNo} ${field === 'weight' ? 'weight' : 'reps'}`}
        className={`flex h-11 flex-1 flex-col items-center justify-center rounded-xl px-1 ${
          active ? 'bg-cta text-bg' : 'bg-surface-2'
        } ${disabled ? 'opacity-40' : ''}`}
      >
        <span className="flex items-baseline gap-1 leading-none whitespace-nowrap">
          <span className={`text-[17px] font-semibold ${active ? '' : dim}`}>{value}</span>
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
    <div className="flex items-center gap-2 py-1.5 scroll-mt-24" data-set-row={rowKey}>
      <button
        type="button"
        onClick={onRemove}
        disabled={!onRemove}
        className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold ${dim}`}
        aria-label={`Set ${set.setNo}`}
      >
        {set.setNo}
      </button>

      <div className="w-14 shrink-0">
        <div className="text-[11px] font-medium text-text-dim tabular-nums">{target ?? '--'}</div>
      </div>

      {weightless
        ? cell('weight', exercise.loadMode === 'bodyweight' ? 'BW' : '--', '', { disabled: true })
        : cell('weight', set.weightKg === undefined ? '--' : kg(set.weightKg), 'kg', {
            sub:
              showEffective && eff !== undefined ? `= ${kg(eff)} kg` : undefined,
          })}
      {cell('reps', set.reps === undefined ? '--' : String(set.reps), repUnitShort(exercise))}

      <RirBadge rir={set.rir} rpe={set.rpe} onClick={onRir} />

      <button
        type="button"
        onClick={onToggleDone}
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          done ? 'bg-cta text-bg' : 'bg-surface-2 text-text-faint'
        }`}
        aria-label={done ? 'Mark set incomplete' : 'Mark set complete'}
      >
        {done ? '✓' : ''}
      </button>

    </div>
  );
}
