/* -------------------------------------------------------------------------- */
/*  Bottom nav — spec §4: 5 slots, fixed, --bg with a top hairline. The centre */
/*  slot is a white circular FAB (+) that floats above the bar.                */
/* -------------------------------------------------------------------------- */

export type Tab = 'dashboard' | 'levels' | 'program' | 'history' | 'settings';

const ICONS: Record<Tab, string> = {
  dashboard: 'M3 11.5 12 4l9 7.5M6 10v10h12V10',
  levels: 'M12 3c2.5 2 4 4 4 6a4 4 0 0 1-8 0c0-2 1.5-4 4-6ZM8 13v8m8-8v8',
  program: 'M4 6h16M4 12h16M4 18h10',
  history: 'M12 8v5l3.5 2M4 12a8 8 0 1 0 2.4-5.7M4 4v3.5h3.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 12h2m12 0h2M12 4v2m0 12v2',
};

const LABELS: Record<Tab, string> = {
  dashboard: 'Home',
  levels: 'Levels',
  program: 'Program',
  history: 'History',
  settings: 'Settings',
};

/* Five slots, one of them the FAB — so four tabs. Settings is the one that
   moves to a gear on the Dashboard: it is the screen you open least. */
const LEFT: Tab[] = ['dashboard', 'levels'];
const RIGHT: Tab[] = ['program', 'history'];

function NavButton({
  tab,
  active,
  onClick,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-1 py-2"
      aria-current={active ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" className="size-5.5" fill="none" aria-hidden="true">
        <path
          d={ICONS[tab]}
          stroke={active ? 'var(--color-text)' : 'var(--color-text-dim)'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`text-[10px] font-medium ${active ? 'text-text' : 'text-text-dim'}`}
      >
        {LABELS[tab]}
      </span>
    </button>
  );
}

export function BottomNav({
  tab,
  onTab,
  onNewSession,
}: {
  tab: Tab;
  onTab: (next: Tab) => void;
  onNewSession: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 bg-bg pb-[env(safe-area-inset-bottom)]">
      <div className="h-px bg-border" />
      <div className="relative flex items-stretch">
        {LEFT.map((t) => (
          <NavButton key={t} tab={t} active={tab === t} onClick={() => onTab(t)} />
        ))}

        {/* Centre slot: keeps the grid at five, the FAB floats above the bar. */}
        <div className="w-16 shrink-0" aria-hidden="true" />
        <button
          type="button"
          onClick={onNewSession}
          aria-label="Start a session"
          className="absolute -top-6 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-cta text-3xl leading-none font-light text-bg"
        >
          +
        </button>

        {RIGHT.map((t) => (
          <NavButton key={t} tab={t} active={tab === t} onClick={() => onTab(t)} />
        ))}
      </div>
    </nav>
  );
}
