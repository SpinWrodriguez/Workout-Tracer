import { useState, type ReactNode } from 'react';

/**
 * Screen shell. One screen = one job: a single scroll area, chrome pinned
 * outside it. Bottom padding clears the nav and, when present, the CTA.
 */
export function Screen({
  title,
  trailing,
  header,
  children,
  pad = 'nav',
}: {
  title: string;
  trailing?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  pad?: 'nav' | 'cta' | 'keypad' | 'none';
}) {
  /* 'keypad' clears the in-app number pad, which is far taller than the CTA:
     without it the rows in the bottom third of the list cannot be scrolled out
     from under the pad, and taps meant for them land on the keys instead. */
  const padding =
    pad === 'keypad'
      ? 'pb-[calc(env(safe-area-inset-bottom)+400px)]'
      : pad === 'cta'
        ? 'pb-[calc(env(safe-area-inset-bottom)+180px)]'
        : pad === 'nav'
          ? 'pb-[calc(env(safe-area-inset-bottom)+96px)]'
          : 'pb-6';

  return (
    <div className="min-h-dvh bg-bg">
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+20px)]">
        <div className="flex items-end justify-between gap-3">
          <h1 className="screen-title">{title}</h1>
          {trailing}
        </div>
        {header}
      </div>
      <div className={`px-4 pt-4 ${padding}`}>{children}</div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-text-dim transition-transform"
      style={{ transform: open ? 'rotate(180deg)' : undefined }}
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  title,
  trailing,
  children,
  className = '',
  collapsible = false,
  defaultOpen = false,
  summary,
}: {
  title?: string;
  trailing?: ReactNode;
  children?: ReactNode;
  className?: string;
  /**
   * Turns the header into a toggle. Settings is the reason: ten cards of
   * controls, nine of which are set once and never touched again, is a screen
   * you scroll past rather than read.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** One line worth seeing while shut — what the section currently says. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section className={`card ${className}`}>
        {(title || trailing) && (
          <header className="mb-3 flex items-center justify-between gap-3">
            {title && <h2 className="card-title">{title}</h2>}
            {trailing}
          </header>
        )}
        {children}
      </section>
    );
  }

  return (
    <section className={`card ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-my-1 flex w-full items-center gap-3 py-1 text-left"
      >
        <span className="min-w-0 flex-1">
          {title && <h2 className="card-title">{title}</h2>}
          {!open && summary !== undefined && (
            <span className="mt-0.5 block truncate text-[12px] font-medium text-text-dim">
              {summary}
            </span>
          )}
        </span>
        <Chevron open={open} />
      </button>
      {/*
        Hidden rather than unmounted. These sections hold half-typed text and
        their own live queries, and throwing that away on a collapse would make
        the toggle destructive — a section you closed by accident would lose
        what you were writing in it.
      */}
      <div className={open ? 'mt-3' : 'hidden'}>{children}</div>
    </section>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`label ${className}`}>{children}</span>;
}

/** Spec §4: `-- kg` / `--- sets`, never "No data available". */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-text-dim">{children}</p>;
}

/** Primary CTA: full-width white pill, black text, 52px, fixed to the bottom. */
export function PrimaryCTA({
  children,
  onClick,
  disabled,
  secondary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: ReactNode;
}) {
  return (
    // Solid fill, not a fade: the spec allows no gradients outside the silhouette.
    <div className="fixed inset-x-0 bottom-0 z-30 bg-bg px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      {secondary && <div className="mb-3">{secondary}</div>}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="h-cta w-full rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
      >
        {children}
      </button>
    </div>
  );
}

/** Pill container in surface-2; the active segment is solid white on black. */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex gap-1 rounded-full bg-surface-2 p-1">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              active ? 'bg-cta text-bg' : 'text-text-dim'
            }`}
          >
            {labels?.[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}

/** Muscle chip: surface-2, radius 8, 12px, dim; active gets the muscle blue. */
export function Chip({
  children,
  active,
  onClick,
  tone = 'muscle',
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  tone?: 'muscle' | 'volume' | 'plain';
}) {
  const activeColor =
    tone === 'muscle' ? 'text-muscle' : tone === 'volume' ? 'text-volume' : 'text-text';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`shrink-0 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium ${
        active ? activeColor : 'text-text-dim'
      }`}
    >
      {children}
    </button>
  );
}

export function Hairline() {
  return <div className="h-px bg-border" />;
}
