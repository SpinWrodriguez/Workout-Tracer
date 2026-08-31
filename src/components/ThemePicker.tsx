import { THEME_CHOICES, type ThemeChoice } from '../lib/theme';
import { useTheme } from '../lib/useTheme';
import { Card, Label, SegmentedToggle } from './Layout';

const LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function ThemePicker() {
  const [choice, resolved, set] = useTheme();

  return (
    <Card title="Appearance">
      <p className="text-[13px] text-text-dim">
        Dark is the design the app was built to. Light keeps the same palette with the neutrals
        inverted and the accents darkened so small text stays readable on white.
      </p>
      <div className="mt-3">
        <SegmentedToggle options={THEME_CHOICES} value={choice} onChange={set} labels={LABELS} />
      </div>
      <Label className="mt-2 block">
        {choice === 'system' ? `following the system — currently ${resolved}` : `always ${resolved}`}
        . Stored on this device only, so it is not part of a backup.
      </Label>
    </Card>
  );
}

/** Sun/moon toggle for the Dashboard header — one tap between light and dark. */
export function ThemeToggleButton() {
  const [, resolved, set] = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => set(next)}
      aria-label={`Switch to ${next} theme`}
      className="mb-1 flex size-9 items-center justify-center rounded-full bg-surface-2"
    >
      <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
        {resolved === 'dark' ? (
          <path
            d="M12 5.5a6.5 6.5 0 1 0 6.5 6.5A5 5 0 0 1 12 5.5Z"
            stroke="var(--color-text-dim)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <g stroke="var(--color-text-dim)" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4M7 17l-1.4 1.4" />
          </g>
        )}
      </svg>
    </button>
  );
}
