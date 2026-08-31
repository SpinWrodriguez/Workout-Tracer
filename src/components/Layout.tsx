import type { ReactNode } from 'react';

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
  pad?: 'nav' | 'cta' | 'none';
}) {
  const padding =
    pad === 'cta'
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

export function Card({
  title,
  trailing,
  children,
  className = '',
}: {
  title?: string;
  trailing?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
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
