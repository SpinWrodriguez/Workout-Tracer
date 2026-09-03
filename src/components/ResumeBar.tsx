/* -------------------------------------------------------------------------- */
/*  A workout is still running.                                              */
/*                                                                           */
/*  Sits above the nav on every tab while a draft exists. Without it, leaving */
/*  the session screen mid-workout is a leap of faith: the sets are safe on   */
/*  disk, but nothing on screen says so.                                     */
/* -------------------------------------------------------------------------- */

import { HapticTick } from './HapticTick';

export function ResumeBar({
  label,
  onResume,
}: {
  /** What the workout is called, when it belongs to one. */
  label?: string;
  onResume: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onResume}
      /* Clear of the nav and the FAB that floats above it. */
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-30 flex items-center justify-between gap-3 rounded-full bg-cta px-4 py-2.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold tracking-wide text-bg/70 uppercase">
          Workout in progress
        </span>
        <span className="block truncate text-[14px] font-semibold text-bg">
          {label ?? 'Tap to carry on'}
        </span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold text-bg">Resume</span>
      <HapticTick />
    </button>
  );
}
