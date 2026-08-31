import type { ReactNode } from 'react';

/**
 * Full-height sheet used for the exercise picker and the RIR/RPE selector.
 * Full-height rather than a partial overlay so there is never a second scroll
 * area behind a scrolling one (spec §4: no nested scroll areas).
 */
export function Sheet({
  title,
  onClose,
  header,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="screen-title text-[22px]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-dim"
          >
            Close
          </button>
        </div>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">{children}</div>
      {footer && (
        <div className="bg-bg px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">{footer}</div>
      )}
    </div>
  );
}
