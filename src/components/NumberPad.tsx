import { useMemo, useState } from 'react';
import { kg } from '../lib/format';
import { atCeiling, isLoadable, nextRung, prevRung, snapToLadder } from '../lib/loadable';

/* -------------------------------------------------------------------------- */
/*  Custom in-app numeric keypad — spec §4.                                   */
/*                                                                            */
/*  The iOS keyboard is not an option: it covers the set table and it is slow  */
/*  in a garage with chalky hands. Every editable cell is a button, never an   */
/*  <input>, so the system keyboard can never appear.                          */
/* -------------------------------------------------------------------------- */

export type PadKind = 'weight' | 'reps';

export interface PadTarget {
  label: string;
  kind: PadKind;
  value: number | undefined;
  /** Increment for the ± keys when there is no ladder to step along. */
  step: number;
  /** Unit shown beside the running value: 'kg', 'reps' or 's'. */
  unit?: string;
  /**
   * Loadable rungs for this exercise (Phase 2). When present the ± keys step
   * rung to rung, the top rung is a hard stop, and a typed value snaps to the
   * nearest rung on commit — so 27 kg can be typed but never saved.
   */
  ladder?: number[];
}

const DIGITS_TOP = ['1', '2', '3'];
const DIGITS_MID = ['4', '5', '6'];
const DIGITS_LOW = ['7', '8', '9'];

function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-auto size-5" fill="none" aria-hidden="true">
      <path
        d="M9 5h11v14H9L3 12 9 5Zm3.5 4.5 5 5m0-5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NumberPad({
  target,
  onCommit,
  onClose,
  onNext,
  hint,
}: {
  target: PadTarget;
  onCommit: (value: number | undefined) => void;
  onClose: () => void;
  onNext?: () => void;
  hint?: string;
}) {
  // A fresh cell starts blank so the first tap overwrites rather than appends.
  // The caller keys this component per cell, so mounting is the reset.
  const [buffer, setBuffer] = useState<string>('');

  const shown = useMemo(() => {
    if (buffer !== '') return buffer;
    return target.value === undefined ? '' : String(target.value);
  }, [buffer, target.value]);

  const toValue = (text: string): number | undefined => {
    if (text === '' || text === '.') return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  };

  const parsed = toValue(shown);

  /**
   * Every keystroke writes straight through to the draft. Buffering until a
   * Done tap loses the entry the moment a thumb lands on another cell, which
   * is exactly what happens mid-set.
   */
  const write = (next: string) => {
    setBuffer(next);
    onCommit(toValue(next));
  };

  const push = (key: string) => {
    const base = buffer === '' && target.value !== undefined ? '' : buffer;
    if (key === '.') {
      if (target.kind === 'reps' || base.includes('.')) return;
      write(base === '' ? '0.' : `${base}.`);
      return;
    }
    if (base === '0') {
      write(key);
      return;
    }
    const next = `${base}${key}`;
    if (next.length <= 6) write(next);
  };

  const backspace = () => {
    const base = buffer === '' && target.value !== undefined ? String(target.value) : buffer;
    write(base.slice(0, -1));
  };

  const ladder = target.kind === 'weight' ? (target.ladder ?? []) : [];
  const hasLadder = ladder.length > 0;

  const bump = (delta: number) => {
    if (hasLadder) {
      const from = parsed ?? snapToLadder(0, ladder) ?? 0;
      // Stepping from an off-ladder number lands on the ladder first.
      const anchor = isLoadable(from, ladder) ? from : (snapToLadder(from, ladder) ?? from);
      const moved =
        anchor !== from ? anchor : delta > 0 ? nextRung(from, ladder) : prevRung(from, ladder);
      if (moved === undefined) return; // ceiling and floor are hard stops
      write(String(moved));
      return;
    }
    const next = Math.max(0, Math.round(((parsed ?? 0) + delta) * 100) / 100);
    write(String(next));
  };

  /** Snapped value, or the raw one when the exercise has no ladder. */
  const resolved =
    hasLadder && parsed !== undefined ? snapToLadder(parsed, ladder) : parsed;

  const snapNote =
    hasLadder && parsed !== undefined && resolved !== undefined && resolved !== parsed
      ? `not loadable — saves as ${kg(resolved)} kg`
      : undefined;

  const ceilingNote =
    hasLadder && resolved !== undefined && atCeiling(resolved, ladder)
      ? `${kg(resolved)} kg is the heaviest you can load`
      : undefined;

  const commit = (then: 'close' | 'next') => {
    onCommit(resolved);
    if (then === 'next' && onNext) onNext();
    else onClose();
  };

  const atTop =
    hasLadder && resolved !== undefined && nextRung(resolved, ladder) === undefined;
  const atFloor =
    hasLadder && resolved !== undefined && prevRung(resolved, ladder) === undefined;

  const keyClass =
    'h-12 rounded-xl bg-surface-2 text-lg font-semibold active:bg-border';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+10px)]">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="label truncate">{target.label}</div>
          <div className="stat-sm mt-0.5">
            {shown === '' ? <span className="text-text-faint">--</span> : shown}
            <span className="ml-1.5 text-sm font-medium text-text-dim">
              {target.unit ?? (target.kind === 'weight' ? 'kg' : 'reps')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => bump(-target.step)}
            disabled={atFloor}
            className="h-10 w-12 rounded-xl bg-surface-2 text-lg font-semibold disabled:text-text-faint"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => bump(target.step)}
            disabled={atTop}
            className="h-10 w-12 rounded-xl bg-surface-2 text-lg font-semibold disabled:text-text-faint"
          >
            +
          </button>
        </div>
      </div>

      {snapNote && (
        <p className="mb-2 px-1 text-xs font-medium" style={{ color: 'var(--color-warn)' }}>
          {snapNote}
        </p>
      )}
      {!snapNote && ceilingNote && (
        <p className="mb-2 px-1 text-xs font-medium text-text-dim">{ceilingNote}</p>
      )}
      {hint && <p className="mb-3 px-1 text-xs text-text-dim">{hint}</p>}

      {/* Four columns, four rows, every cell filled: 1-9 and . 0 on the left,
          backspace top-right, and a full-height Next down the right edge so the
          most-used key is the easiest one to hit with a thumb. */}
      <div className="grid grid-cols-4 gap-2">
        {DIGITS_TOP.map((key) => (
          <button key={key} type="button" className={keyClass} onClick={() => push(key)}>
            {key}
          </button>
        ))}
        <button type="button" className={keyClass} onClick={backspace} aria-label="Backspace">
          <BackspaceIcon />
        </button>

        {DIGITS_MID.map((key) => (
          <button key={key} type="button" className={keyClass} onClick={() => push(key)}>
            {key}
          </button>
        ))}
        <button
          type="button"
          className="row-span-3 rounded-xl bg-surface-2 text-sm font-semibold active:bg-border"
          onClick={() => commit(onNext ? 'next' : 'close')}
        >
          {onNext ? 'Next' : 'Done'}
        </button>

        {DIGITS_LOW.map((key) => (
          <button key={key} type="button" className={keyClass} onClick={() => push(key)}>
            {key}
          </button>
        ))}

        <button
          type="button"
          className={keyClass}
          onClick={() => push('.')}
          disabled={target.kind === 'reps'}
        >
          <span className={target.kind === 'reps' ? 'text-text-faint' : ''}>.</span>
        </button>
        <button type="button" className={keyClass} onClick={() => push('0')}>
          0
        </button>
        <button
          type="button"
          className="h-12 rounded-xl text-sm font-medium text-text-dim"
          onClick={() => commit('close')}
        >
          Close
        </button>
      </div>
    </div>
  );
}
